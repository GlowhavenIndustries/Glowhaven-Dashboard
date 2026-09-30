import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';
import { appendAudit, loadSecrets, loadState, saveSecrets, saveState, readAudit, readLastAuditHash, verifyAuditChain, DATA_DIR } from './server/storage.js';
import { auditHash, decryptSecret, encryptSecret, ensureMasterKey, hashPassword, hashToken, randomToken, requestJson, securityHeaders, validateRemoteUrl } from './server/security.js';
import { clearSessionCookie, csrfToken, login, logout, requireCsrf, requirePermission, revokeUserSessions, sanitizeUser, sessionUser, setupOwner } from './server/auth.js';
import { finishOidc, isOidcConfigured, startOidc } from './server/oidc.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const MAX_BODY = 1024 * 1024;
const SESSION_MAX_AGE = 8 * 60 * 60;
const secureCookies = process.env.NODE_ENV === 'production';
await ensureMasterKey(DATA_DIR);
let state = await loadState();
let secrets = await loadSecrets();
state.users = Array.isArray(state.users) ? state.users : [];
state.sessions = Object.assign(Object.create(null), state.sessions && typeof state.sessions === 'object' ? state.sessions : {});
state.integrations = Object.assign(Object.create(null), state.integrations && typeof state.integrations === 'object' ? state.integrations : {});
state.organization = state.organization && typeof state.organization === 'object' ? state.organization : { name: '', timezone: 'UTC' };
state.apiKeys = Array.isArray(state.apiKeys) ? state.apiKeys : [];
state.securityPolicy = state.securityPolicy && typeof state.securityPolicy === 'object' ? state.securityPolicy : { enforceSso: false, ssoDomains: [], minPasswordLength: 12 };
await saveState(state);

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { ...securityHeaders(), 'Cache-Control': 'no-store', 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(body);
}
function fail(message, statusCode = 400) { const e = new Error(message); e.statusCode = statusCode; return e; }
function cookie(token) { return 'gh_session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_MAX_AGE + (secureCookies ? '; Secure' : ''); }
function oidcStateCookie(state) { return 'gh_oidc_state=' + encodeURIComponent(state) + '; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=600' + (secureCookies ? '; Secure' : ''); }
function readCookie(req, name) { const value = req.headers.cookie || ''; const item = value.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '=')); return item ? decodeURIComponent(item.slice(name.length + 1)) : ''; }

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw fail('Request body is too large', 413); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Request body must be valid JSON'); }
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
async function persist() { await saveState(state); await saveSecrets(secrets); }
async function audit(user, action, details = {}) {
  const previousHash = await readLastAuditHash();
  const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), actorId: user?.id || 'system', actorEmail: user?.email || 'system', action, details, previousHash };
  entry.hash = auditHash(entry, previousHash);
  await appendAudit(entry);
  state.lastAuditHash = entry.hash;
  await saveState(state);
}

export function checkIntegrationAccess(integration, user, req) {
  if (!integration || !user || user.role === 'owner' || user.role === 'admin') return true;

  if (integration.workspaceId) {
    const userWorkspace = user.workspaceId || user.workspace || req?.headers?.['x-workspace-id'];
    if (!userWorkspace || userWorkspace !== integration.workspaceId) {
      throw fail('Access to integration secrets is restricted to workspace: ' + integration.workspaceId, 403);
    }
  }

  if (Array.isArray(integration.executionGroups) && integration.executionGroups.length > 0) {
    const headerGroup = req?.headers?.['x-execution-group'];
    const userGroups = Array.isArray(user.executionGroups) ? user.executionGroups : (Array.isArray(user.groups) ? user.groups : []);
    const allUserGroups = headerGroup ? [...userGroups, headerGroup] : userGroups;
    const hasMatch = integration.executionGroups.some((group) => allUserGroups.includes(group));
    if (!hasMatch) {
      throw fail('Access to integration secrets is restricted to execution groups: ' + integration.executionGroups.join(', '), 403);
    }
  }

  return true;
}

function safeIntegration(item, includeConfig = false) {
  const base = {
    id: item.id,
    kind: item.kind,
    name: item.name,
    authType: item.authType || 'none',
    configured: Boolean(item.endpoint || item.settings),
    updatedAt: item.updatedAt || null,
    workspaceId: item.workspaceId || '',
    executionGroups: Array.isArray(item.executionGroups) ? item.executionGroups : [],
  };
  return includeConfig ? { ...base, endpoint: item.endpoint || '', settings: item.settings || {} } : base;
}

function getIntegration(kind, allowUnconfigured = false, user = null, req = null) {
  if (!/^[a-z][a-z0-9_-]{1,31}$/i.test(kind)) throw fail('Invalid integration type');
  const integration = state.integrations[kind];
  if (!integration && allowUnconfigured) return { id: kind, kind, name: kind, settings: {}, workspaceId: '', executionGroups: [] };
  if (!integration) throw fail(kind + ' integration is not configured', 404);
  if (user) checkIntegrationAccess(integration, user, req);
  return integration;
}

function getSecret(kind, user = null, req = null) {
  const integration = state.integrations[kind];
  if (integration && user) checkIntegrationAccess(integration, user, req);
  const record = secrets[kind];
  return record ? decryptSecret(record) : '';
}

function authHeaders(integration, user = null, req = null) {
  const secret = getSecret(integration.kind, user, req);
  if (!secret) return {};
  if (integration.authType === 'apiKey') return { 'X-API-Key': secret };
  if (integration.authType === 'bearer') return { Authorization: 'Bearer ' + secret };
  return {};
}

async function remoteJson(inputUrl, options = {}) {
  return requestJson(inputUrl, options);
}

async function upsertIntegration(user, kind, input, req = null) {
  if (!/^[a-z][a-z0-9_-]{1,31}$/i.test(kind)) throw fail('Invalid integration type');
  const old = state.integrations[kind] || { id: kind, kind };
  if (old.workspaceId || (Array.isArray(old.executionGroups) && old.executionGroups.length > 0)) {
    checkIntegrationAccess(old, user, req);
  }
  const endpoint = Object.prototype.hasOwnProperty.call(input, 'endpoint')
    ? (input.endpoint ? await validateRemoteUrl(input.endpoint) : '')
    : (old.endpoint || '');
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : (old.settings || {});
  const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId.trim() : (old.workspaceId || '');
  const executionGroups = Array.isArray(input.executionGroups) ? input.executionGroups.map((g) => String(g).trim()).filter(Boolean) : (old.executionGroups || []);
  const item = {
    id: kind,
    kind,
    name: String(input.name || old.name || kind).trim().slice(0, 120),
    endpoint,
    authType: ['none', 'bearer', 'apiKey'].includes(input.authType) ? input.authType : (old.authType || 'none'),
    settings,
    workspaceId,
    executionGroups,
    updatedAt: new Date().toISOString(),
  };
  state.integrations[kind] = item;
  if (input.secret !== undefined && input.secret !== '') secrets[kind] = encryptSecret(input.secret);
  if (input.clearSecret) delete secrets[kind];
  await persist();
  await audit(user, 'integration.updated', { kind, endpointConfigured: Boolean(endpoint), secretChanged: input.secret !== undefined || Boolean(input.clearSecret), workspaceId, executionGroups });
  return safeIntegration(item, true);
}

async function openMeteo(settings = {}) {
  const location = settings.location || {};
  const lat = Number(location.lat);
  const lon = Number(location.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { configured: false };
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,uv_index');
  url.searchParams.set('timezone', 'auto');
  if ((settings.units || 'imperial') === 'imperial') {
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
  }
  return remoteJson(url.toString());
}

async function integrationData(kind, user = null, req = null) {
  const integration = getIntegration(kind, true, user, req);

  if (kind === 'weather') {
    const data = await openMeteo(integration.settings);
    if (!data.configured) return { configured: false };
    const current = data.current || {};
    const labels = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Heavy rain showers', 82: 'Violent rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };
    const aqiUrl = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    aqiUrl.searchParams.set('latitude', String(integration.settings.location.lat));
    aqiUrl.searchParams.set('longitude', String(integration.settings.location.lon));
    aqiUrl.searchParams.set('current', 'us_aqi');
    let aqi = 'N/A';
    try { const air = await remoteJson(aqiUrl.toString()); aqi = String(air.current?.us_aqi ?? 'N/A'); } catch {}
    const imperial = (integration.settings.units || 'imperial') === 'imperial';
    return {
      temp: Number.isFinite(Number(current.temperature_2m)) ? Math.round(Number(current.temperature_2m)) + '°' : 'N/A',
      conditions: (labels[current.weather_code] || 'Cloudy') + ' · ' + (current.relative_humidity_2m ?? 'N/A') + '% humidity',
      wind: Number.isFinite(Number(current.wind_speed_10m)) ? Math.round(Number(current.wind_speed_10m)) + ' ' + (imperial ? 'mph' : 'km/h') : 'N/A',
      aqi,
      uv: String(current.uv_index ?? 'N/A'),
      city: integration.settings.location.city || '',
    };
  }

  if (kind === 'calendar') {
    const settings = integration.settings || {};
    if (settings.provider === 'google' && settings.calendarId && getSecret(kind, user, req)) {
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(settings.calendarId) + '/events');
      url.searchParams.set('timeMin', new Date().toISOString());
      url.searchParams.set('maxResults', '5');
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      const data = await remoteJson(url.toString(), { headers: authHeaders(integration, user, req) });
      return { events: (data.items || []).map((event) => ({ title: event.summary || 'Untitled', time: event.start?.dateTime || event.start?.date || '' })) };
    }
    if (settings.provider === 'outlook' && integration.endpoint) {
      const data = await remoteJson(integration.endpoint, { headers: { ...authHeaders(integration, user, req) } });
      return { events: (data.value || []).slice(0, 5).map((event) => ({ title: event.subject || 'Untitled', time: event.start?.dateTime || '' })) };
    }
    if (settings.provider === 'github' && settings.org) {
      const items = await remoteJson('https://api.github.com/orgs/' + encodeURIComponent(settings.org) + '/events?per_page=5', { headers: { 'X-GitHub-Api-Version': '2022-11-28' } });
      return { events: (Array.isArray(items) ? items : []).map((event) => ({ title: (event.type || 'Activity').replace(/Event$/, '') + ' · ' + (event.repo?.name || settings.org), time: event.created_at || '' })) };
    }
    return { events: [] };
  }

  if (kind === 'activity') {
    const settings = integration.settings || {};
    if (settings.provider === 'github' && settings.org) {
      const items = await remoteJson('https://api.github.com/orgs/' + encodeURIComponent(settings.org) + '/events?per_page=8', { headers: { 'X-GitHub-Api-Version': '2022-11-28' } });
      return { items: (Array.isArray(items) ? items : []).map((event) => ({ title: (event.type || 'Activity').replace(/Event$/, ''), detail: event.repo?.name || settings.org, time: event.created_at || null })) };
    }
    if (integration.endpoint) return remoteJson(integration.endpoint, { headers: authHeaders(integration, user, req) });
    return { items: [] };
  }

  if (kind === 'github') {
    const repos = Array.isArray(integration.settings?.repositories) ? integration.settings.repositories : [];
    if (!repos.length) return { summary: 'No repositories configured', items: [], lastSync: new Date().toISOString() };
    const headers = { ...authHeaders(integration, user, req), 'X-GitHub-Api-Version': '2022-11-28' };
    const items = await Promise.all(repos.slice(0, 20).map(async (repo) => {
      const owner = String(repo.owner || '').trim();
      const name = String(repo.repo || '').trim();
      if (!owner || !name) return null;
      try {
        const data = await remoteJson('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name) + '/actions/runs?per_page=1', { headers });
        const run = data.workflow_runs?.[0];
        return { name: owner + '/' + name, status: run?.conclusion || run?.status || 'No runs', updatedAt: run?.updated_at || null };
      } catch {
        return { name: owner + '/' + name, status: 'Unavailable', updatedAt: null };
      }
    }));
    return { summary: repos.length + ' repositories', items: items.filter(Boolean), lastSync: new Date().toISOString() };
  }

  if (kind === 'services') {
    const endpoints = Array.isArray(integration.settings?.endpoints) ? integration.settings.endpoints : [];
    const results = await Promise.all(endpoints.slice(0, 50).map(async (entry) => {
      const target = typeof entry === 'string' ? entry : entry?.url;
      const name = typeof entry === 'object' ? entry?.name : '';
      const started = Date.now();
      try {
        await remoteJson(target, { headers: typeof entry === 'object' ? { ...authHeaders(integration, user, req), ...(entry.headers || {}) } : authHeaders(integration, user, req) });
        return { name: name || new URL(target).hostname, ok: true, latency: Date.now() - started };
      } catch {
        return { name: name || target, ok: false, latency: Date.now() - started };
      }
    }));
    const failures = results.filter((x) => !x.ok).length;
    const healthy = results.length - failures;
    return { uptime: results.length ? ((healthy / results.length) * 100).toFixed(2) + '%' : 'Not configured', incidents: failures + ' incidents', failures, services: results.map((x) => ({ name: x.name, status: x.ok ? 'Stable' : 'Offline', latency: x.latency })), latencyAvg: results.length ? Math.round(results.reduce((s, x) => s + x.latency, 0) / results.length) : 0 };
  }

  if (!integration.endpoint) return integration.settings?.items ? { items: integration.settings.items } : { items: [] };
  return remoteJson(integration.endpoint, { headers: authHeaders(integration, user, req) });
}

async function runAutomation(user, payload, req = null) {
  const integration = getIntegration('automations', false, user, req);
  if (!integration.endpoint) throw fail('Automation execution endpoint is not configured', 409);
  const result = await remoteJson(integration.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(integration, user, req) }, body: JSON.stringify(payload || {}) });
  await audit(user, 'automation.executed', { automationId: payload?.id || null });
  return result;
}

async function api(req, res, url) {
  if (url.pathname === '/api/health') return send(res, 200, { status: 'ok', service: 'glowhaven', time: new Date().toISOString() });
  if (url.pathname === '/api/auth/session' && req.method === 'GET') { const user = await sessionUser(state, req); return send(res, 200, { authenticated: Boolean(user), setupRequired: state.users.length === 0, oidcEnabled: isOidcConfigured(), user: sanitizeUser(user), csrf: user ? await csrfToken(state, req) : '' }); }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') { const input = await readBody(req); try { const result = await login(state, req, input.email, input.password); await persist(); await audit(result.user, 'auth.login', { method: 'password' }); return send(res, 200, { user: sanitizeUser(result.user), csrf: result.csrf }, { 'Set-Cookie': cookie(result.token) }); } catch (e) { e.statusCode = 401; throw e; } }
  if (url.pathname === '/api/auth/setup' && req.method === 'POST') { const input = await readBody(req); const result = await setupOwner(state, req, input.email, input.password); await persist(); await audit(result.user, 'auth.setup', { method: 'password' }); return send(res, 200, { user: sanitizeUser(result.user), csrf: result.csrf }, { 'Set-Cookie': cookie(result.token) }); }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') { const user = await sessionUser(state, req); await requireCsrf(state, req); await logout(state, req); await persist(); if (user) await audit(user, 'auth.logout'); return send(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(secureCookies) }); }
  if (url.pathname === '/api/auth/oidc/start' && req.method === 'GET') { if (!isOidcConfigured()) throw fail('SSO is not configured', 404); const flow = await startOidc(); res.writeHead(302, { ...securityHeaders(), Location: flow.url, 'Set-Cookie': oidcStateCookie(flow.state) }); return res.end(); }
  if (url.pathname === '/api/auth/oidc/callback' && req.method === 'GET') { const result = await finishOidc(url.searchParams.get('state') || '', url.searchParams.get('code') || '', state, readCookie(req, 'gh_oidc_state')); await persist(); await audit(result.user, 'auth.login', { method: 'oidc' }); res.writeHead(302, { ...securityHeaders(), Location: '/', 'Set-Cookie': [cookie(result.token), 'gh_oidc_state=; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=0' + (secureCookies ? '; Secure' : '')] }); return res.end(); }
  const user = await sessionUser(state, req); if (!user) throw fail('Authentication required', 401);
  if (url.pathname === '/api/integrations' && req.method === 'GET') {
    await requirePermission(state, req, 'view');
    return send(res, 200, Object.values(state.integrations).map((item) => safeIntegration(item, user.role === 'owner' || user.role === 'admin')));
  }
  if (url.pathname.startsWith('/api/integrations/') && url.pathname.endsWith('/data') && req.method === 'GET') {
    await requirePermission(state, req, 'view');
    return send(res, 200, await integrationData(url.pathname.split('/')[3], user, req));
  }
  if (url.pathname.startsWith('/api/integrations/') && req.method === 'PUT') {
    const actor = await requirePermission(state, req, 'manage');
    await requireCsrf(state, req);
    return send(res, 200, await upsertIntegration(actor, url.pathname.split('/')[3], await readBody(req), req));
  }
  if (url.pathname.startsWith('/api/integrations/') && req.method === 'DELETE') {
    const actor = await requirePermission(state, req, 'manage');
    await requireCsrf(state, req);
    const kind = url.pathname.split('/')[3];
    const old = state.integrations[kind];
    if (old) checkIntegrationAccess(old, actor, req);
    delete state.integrations[kind];
    delete secrets[kind];
    await persist();
    await audit(actor, 'integration.deleted', { kind });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/automations/run' && req.method === 'POST') {
    const actor = await requirePermission(state, req, 'operate');
    await requireCsrf(state, req);
    return send(res, 200, await runAutomation(actor, await readBody(req), req));
  }
  if (url.pathname === '/api/audit' && req.method === 'GET') {
    await requirePermission(state, req, 'audit');
    const verification = await verifyAuditChain(auditHash);
    if (!verification.valid) throw fail('Audit log integrity verification failed', 503);
    let records = await readAudit(url.searchParams.get('limit') || 200);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const actionFilter = (url.searchParams.get('action') || '').trim().toLowerCase();
    const actorFilter = (url.searchParams.get('actor') || '').trim().toLowerCase();
    if (q) {
      records = records.filter((entry) => {
        const text = ((entry.actorEmail || '') + ' ' + (entry.action || '') + ' ' + JSON.stringify(entry.details || {})).toLowerCase();
        return text.includes(q);
      });
    }
    if (actionFilter) {
      records = records.filter((entry) => String(entry.action || '').toLowerCase().includes(actionFilter));
    }
    if (actorFilter) {
      records = records.filter((entry) => String(entry.actorEmail || '').toLowerCase().includes(actorFilter));
    }
    return send(res, 200, records);
  }
  if (url.pathname === '/api/audit/export' && req.method === 'GET') {
    await requirePermission(state, req, 'audit');
    const verification = await verifyAuditChain(auditHash);
    if (!verification.valid) throw fail('Audit log integrity verification failed', 503);
    let records = await readAudit(url.searchParams.get('limit') || 500);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (q) {
      records = records.filter((entry) => {
        const text = ((entry.actorEmail || '') + ' ' + (entry.action || '') + ' ' + JSON.stringify(entry.details || {})).toLowerCase();
        return text.includes(q);
      });
    }
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    if (format === 'csv') {
      const escapeCsv = (val) => '"' + String(val ?? '').replace(/"/g, '""') + '"';
      const header = ['id', 'timestamp', 'actorEmail', 'action', 'details', 'hash'].map(escapeCsv).join(',');
      const rows = records.map((r) => [
        r.id,
        r.timestamp,
        r.actorEmail,
        r.action,
        JSON.stringify(r.details || {}),
        r.hash,
      ].map(escapeCsv).join(','));
      const csv = [header, ...rows].join('\n');
      res.writeHead(200, {
        ...securityHeaders(),
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="glowhaven-audit-log.csv"',
        'Cache-Control': 'no-store',
      });
      return res.end(csv);
    }
    return send(res, 200, records);
  }
  if (url.pathname === '/api/audit/verify' && req.method === 'POST') { const actor = await requirePermission(state, req, 'audit'); await requireCsrf(state, req); const verification = await verifyAuditChain(auditHash); await audit(actor, 'audit.verified', { valid: verification.valid, count: verification.count }); return send(res, 200, verification); }
  if (url.pathname === '/api/security/policy' && req.method === 'GET') {
    await requirePermission(state, req, 'manage');
    return send(res, 200, state.securityPolicy);
  }
  if (url.pathname === '/api/security/policy' && req.method === 'PUT') {
    const actor = await requirePermission(state, req, 'manage');
    await requireCsrf(state, req);
    const input = await readBody(req);
    const enforceSso = Boolean(input.enforceSso);
    const ssoDomains = Array.isArray(input.ssoDomains)
      ? input.ssoDomains.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
      : String(input.ssoDomains || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    const minPasswordLength = Math.max(12, Math.min(Number(input.minPasswordLength) || 12, 128));
    state.securityPolicy = { enforceSso, ssoDomains, minPasswordLength };
    await persist();
    await audit(actor, 'security.policy_updated', { enforceSso, ssoDomains, minPasswordLength });
    return send(res, 200, state.securityPolicy);
  }
  if (url.pathname === '/api/incidents/action' && req.method === 'POST') { const actor = await requirePermission(state, req, 'operate'); await requireCsrf(state, req); const body = await readBody(req); const incidentId = String(body.id || '').trim(); const action = String(body.action || 'acknowledge').trim(); if (!incidentId) throw fail('Incident ID is required'); await audit(actor, 'incident.action', { incidentId, action }); return send(res, 200, { ok: true, incidentId, action, timestamp: new Date().toISOString() }); }
  if (url.pathname === '/api/config' && req.method === 'GET') { await requirePermission(state, req, 'view'); return send(res, 200, { organization: state.organization, integrations: Object.values(state.integrations).map((item) => safeIntegration(item, user.role === 'owner' || user.role === 'admin')), role: user.role }); }
  if (url.pathname === '/api/config' && req.method === 'PUT') { const actor = await requirePermission(state, req, 'manage'); await requireCsrf(state, req); const input = await readBody(req); if (typeof input.organization?.name === 'string') state.organization.name = input.organization.name.trim().slice(0, 120); if (typeof input.organization?.timezone === 'string') state.organization.timezone = input.organization.timezone.trim().slice(0, 80); await persist(); await audit(actor, 'organization.updated', { name: state.organization.name }); return send(res, 200, { organization: state.organization }); }
  if (url.pathname === '/api/users' && req.method === 'GET') { await requirePermission(state, req, 'users'); return send(res, 200, state.users.map(sanitizeUser)); }
  if (url.pathname === '/api/users' && req.method === 'POST') { const actor = await requirePermission(state, req, 'users'); await requireCsrf(state, req); const input = await readBody(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || ''); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Valid email is required'); if (state.users.some((u) => u.email === email)) throw fail('A user with that email already exists', 409); if (password.length < 12) throw fail('Password must be at least 12 characters'); const user = { id: crypto.randomUUID(), email, role: ['admin', 'operator', 'viewer'].includes(input.role) ? input.role : 'viewer', password: hashPassword(password), createdAt: new Date().toISOString(), status: 'active', auth: 'password' }; state.users.push(user); await persist(); await audit(actor, 'user.created', { userId: user.id, role: user.role }); return send(res, 201, sanitizeUser(user)); }
  if (url.pathname.startsWith('/api/users/') && req.method === 'PUT') {
    const actor = await requirePermission(state, req, 'users');
    await requireCsrf(state, req);
    const targetId = url.pathname.slice('/api/users/'.length);
    const targetUser = state.users.find((u) => u.id === targetId);
    if (!targetUser) throw fail('User not found', 404);
    const input = await readBody(req);
    const updates = {};
    if (input.role && ['admin', 'operator', 'viewer'].includes(input.role)) {
      if (targetUser.role === 'owner' && input.role !== 'owner') {
        const activeOwners = state.users.filter((u) => u.role === 'owner' && u.status === 'active');
        if (activeOwners.length <= 1) throw fail('Cannot demote primary owner', 400);
      }
      targetUser.role = input.role;
      updates.role = input.role;
    }
    if (input.status && ['active', 'disabled'].includes(input.status)) {
      if (targetUser.role === 'owner' && input.status === 'disabled') {
        const activeOwners = state.users.filter((u) => u.role === 'owner' && u.status === 'active');
        if (activeOwners.length <= 1) throw fail('Cannot disable primary owner', 400);
      }
      targetUser.status = input.status;
      updates.status = input.status;
      if (input.status === 'disabled') await revokeUserSessions(state, targetUser.id);
    }
    if (typeof input.password === 'string' && input.password) {
      if (input.password.length < 12) throw fail('Password must be at least 12 characters', 400);
      targetUser.password = hashPassword(input.password);
      updates.passwordChanged = true;
      await revokeUserSessions(state, targetUser.id);
    }
    await persist();
    await audit(actor, 'user.updated', { userId: targetUser.id, ...updates });
    return send(res, 200, sanitizeUser(targetUser));
  }
  if (url.pathname.startsWith('/api/users/') && req.method === 'DELETE') {
    const actor = await requirePermission(state, req, 'users');
    await requireCsrf(state, req);
    const targetId = url.pathname.slice('/api/users/'.length);
    if (actor.id === targetId) throw fail('Cannot delete your own account', 400);
    const index = state.users.findIndex((u) => u.id === targetId);
    if (index < 0) throw fail('User not found', 404);
    const targetUser = state.users[index];
    if (targetUser.role === 'owner') {
      const activeOwners = state.users.filter((u) => u.role === 'owner' && u.status === 'active');
      if (activeOwners.length <= 1) throw fail('Cannot delete primary owner', 400);
    }
    state.users.splice(index, 1);
    await revokeUserSessions(state, targetId);
    await persist();
    await audit(actor, 'user.deleted', { userId: targetId, email: targetUser.email });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/apikeys' && req.method === 'GET') {
    await requirePermission(state, req, 'manage');
    return send(res, 200, state.apiKeys.map((k) => ({
      id: k.id,
      name: k.name,
      role: k.role,
      prefix: k.prefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt || null,
      createdBy: k.createdBy,
    })));
  }
  if (url.pathname === '/api/apikeys' && req.method === 'POST') {
    const actor = await requirePermission(state, req, 'manage');
    await requireCsrf(state, req);
    const input = await readBody(req);
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw fail('API Key name is required', 400);
    const role = ['admin', 'operator', 'viewer'].includes(input.role) ? input.role : 'viewer';
    const rawToken = 'gh_ak_' + randomToken(32);
    const keyHash = hashToken(rawToken);
    const prefix = rawToken.slice(0, 12) + '...';
    const keyRecord = {
      id: crypto.randomUUID(),
      name,
      role,
      keyHash,
      prefix,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      createdBy: actor.email,
    };
    state.apiKeys.push(keyRecord);
    await persist();
    await audit(actor, 'apikey.created', { apiKeyId: keyRecord.id, name, role });
    return send(res, 201, {
      id: keyRecord.id,
      name,
      role,
      token: rawToken,
      prefix,
      createdAt: keyRecord.createdAt,
    });
  }
  if (url.pathname.startsWith('/api/apikeys/') && req.method === 'DELETE') {
    const actor = await requirePermission(state, req, 'manage');
    await requireCsrf(state, req);
    const targetId = url.pathname.slice('/api/apikeys/'.length);
    const index = state.apiKeys.findIndex((k) => k.id === targetId);
    if (index < 0) throw fail('API Key not found', 404);
    const deleted = state.apiKeys.splice(index, 1)[0];
    await persist();
    await audit(actor, 'apikey.deleted', { apiKeyId: targetId, name: deleted.name });
    return send(res, 200, { ok: true });
  }
  throw fail('Not found', 404);
}

function contentType(file) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' })[path.extname(file).toLowerCase()] || 'application/octet-stream'; }
async function staticFile(res, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  const normalizedPath = path.normalize(requestPath).replace(/\\/g, '/');
  if (normalizedPath.split('/').includes('..')) return send(res, 403, 'Forbidden');
  const publicPath = normalizedPath.replace(/^\/+/, '');
  const publicAllowed = publicPath === 'index.html' || publicPath === 'app.js' || publicPath === 'dataSources.js' || publicPath === 'styles.css' || publicPath.startsWith('widgets/') || publicPath.startsWith('assets/');
  if (!publicAllowed) return send(res, 404, 'Not found');
  const file = path.resolve(ROOT, '.' + normalizedPath);
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative === '..') return send(res, 403, 'Forbidden');
  try { const stat = await fs.stat(file); if (!stat.isFile()) throw new Error('not file'); const content = await fs.readFile(file); res.writeHead(200, { ...securityHeaders(), 'Cache-Control': 'no-store', 'Content-Type': contentType(file) }); res.end(content); } catch { send(res, 404, 'Not found'); }
}

const server = http.createServer(async (req, res) => {
  try { if (!sameOrigin(req)) throw fail('Origin validation failed', 403); const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); if (url.pathname.startsWith('/api/')) await api(req, res, url); else if (req.method === 'GET' || req.method === 'HEAD') await staticFile(res, url.pathname); else throw fail('Method not allowed', 405); }
  catch (error) { send(res, error.statusCode || 500, { error: error.message || 'Request failed' }); }
});
server.listen(PORT, () => console.log('Glowhaven server listening on port ' + PORT));
