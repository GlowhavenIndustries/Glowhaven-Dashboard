import { fetchActivity, fetchAutomations, fetchBusinessKpis, fetchCalendarEvents, fetchGithubProjects, fetchIncidents, fetchServerStatus, fetchTelemetrySnapshot, fetchWeather } from './dataSources.js';

const LOCAL_KEY = 'glowhaven-ui-v1';
const $ = (id) => document.getElementById(id);
const state = { user: null, csrf: '', organization: { name: 'Company Workspace', timezone: 'UTC' }, integrations: [], theme: 'dark', visual: 'neon', consoleMode: false, dashboard: 'operations', role: 'viewer', view: 'Overview' };

const layouts = {
  operations: { label: 'Operations Center', widgets: [
    { id: 'kpi', type: 'kpi', title: 'Business KPIs', x: 1, y: 1, w: 4, h: 2 },
    { id: 'incidents', type: 'incidents', title: 'Incident Center', x: 5, y: 1, w: 4, h: 2 },
    { id: 'automations', type: 'automations', title: 'Automation Queue', x: 9, y: 1, w: 4, h: 2 },
    { id: 'github', type: 'githubProjects', title: 'Release Pipelines', x: 1, y: 3, w: 6, h: 3 },
    { id: 'services', type: 'serverStatus', title: 'Service Health', x: 7, y: 3, w: 6, h: 3 },
  ] },
  team: { label: 'Team Collaboration', widgets: [
    { id: 'activity', type: 'activity', title: 'Team Activity', x: 1, y: 1, w: 6, h: 3 },
    { id: 'calendar', type: 'calendar', title: 'Calendar', x: 7, y: 1, w: 6, h: 3 },
    { id: 'weather', type: 'weather', title: 'Local Conditions', x: 1, y: 4, w: 4, h: 2 },
    { id: 'team-kpi', type: 'kpi', title: 'Team KPIs', x: 5, y: 4, w: 8, h: 2 },
  ] },
  devops: { label: 'DevOps & Infrastructure', widgets: [
    { id: 'services', type: 'serverStatus', title: 'Service Health', x: 1, y: 1, w: 6, h: 3 },
    { id: 'github', type: 'githubProjects', title: 'Release Pipelines', x: 7, y: 1, w: 6, h: 3 },
    { id: 'automations', type: 'automations', title: 'Automation Queue', x: 1, y: 4, w: 6, h: 2 },
    { id: 'kpi', type: 'kpi', title: 'Infrastructure KPIs', x: 7, y: 4, w: 6, h: 2 },
  ] },
  security: { label: 'Security & Compliance', widgets: [
    { id: 'incidents', type: 'incidents', title: 'Incident Center', x: 1, y: 1, w: 6, h: 3 },
    { id: 'automations', type: 'automations', title: 'Automated Remediation', x: 7, y: 1, w: 6, h: 3 },
    { id: 'activity', type: 'activity', title: 'Audit Activity', x: 1, y: 4, w: 6, h: 3 },
    { id: 'services', type: 'serverStatus', title: 'Service Security', x: 7, y: 4, w: 6, h: 3 },
  ] },
};

const widgetClasses = {};

export class Widget {
  constructor(config, dashboard) { this.config = config; this.dashboard = dashboard; this.element = null; this.cleanups = []; this.intervals = []; }
  render() {
    const card = document.createElement('article'); card.className = 'widget-card'; card.dataset.widgetId = this.config.id;
    card.style.gridColumn = this.config.x + ' / span ' + this.config.w; card.style.gridRow = this.config.y + ' / span ' + this.config.h;
    const header = document.createElement('header'); header.className = 'widget-header';
    const heading = document.createElement('div'); const type = document.createElement('span'); type.className = 'eyebrow'; type.textContent = this.config.type;
    const title = document.createElement('h3'); title.textContent = this.config.title; heading.append(type, title);
    const actions = document.createElement('div'); actions.className = 'widget-actions'; const role = document.createElement('span'); role.className = 'widget-badge'; role.textContent = state.role; actions.append(role);
    if (this.dashboard.canManageWorkspace) { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button'; remove.setAttribute('aria-label', 'Remove module'); remove.textContent = '×'; remove.addEventListener('click', () => this.dashboard.removeWidget(this.config.id)); actions.append(remove); }
    header.append(heading, actions); const body = document.createElement('div'); body.className = 'widget-body'; body.append(this.renderContent()); card.append(header, body);
    if (this.dashboard.canManageWorkspace) this.enableDrag(card); this.element = card; return card;
  }
  renderContent() { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No data'; return p; }
  every(fn, ms) { const timer = setInterval(fn, ms); this.intervals.push(timer); return timer; }
  enableDrag(card) {
    card.draggable = true;
    const onStart = (event) => { event.dataTransfer?.setData('text/plain', this.config.id); card.classList.add('is-dragging'); };
    const onEnd = () => card.classList.remove('is-dragging'); const onOver = (event) => { event.preventDefault(); card.classList.add('drop-target'); };
    const onLeave = () => card.classList.remove('drop-target'); const onDrop = (event) => { event.preventDefault(); card.classList.remove('drop-target'); const source = event.dataTransfer?.getData('text/plain'); if (source) this.dashboard.moveWidget(source, this.config.id); };
    card.addEventListener('dragstart', onStart); card.addEventListener('dragend', onEnd); card.addEventListener('dragover', onOver); card.addEventListener('dragleave', onLeave); card.addEventListener('drop', onDrop);
    this.cleanups.push(() => { card.removeEventListener('dragstart', onStart); card.removeEventListener('dragend', onEnd); card.removeEventListener('dragover', onOver); card.removeEventListener('dragleave', onLeave); card.removeEventListener('drop', onDrop); });
  }
  destroy() { this.cleanups.forEach((fn) => fn()); this.intervals.forEach(clearInterval); this.cleanups = []; this.intervals = []; }
}

class Dashboard {
  constructor() { this.widgets = []; this.storage = this.loadLocal(); }
  get canManageWorkspace() { return ['owner', 'admin'].includes(state.role) && state.dashboard === 'operations'; }
  loadLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; } }
  saveLocal() { localStorage.setItem(LOCAL_KEY, JSON.stringify({ theme: state.theme, visual: state.visual, consoleMode: state.consoleMode, dashboard: state.dashboard, layouts: this.storage.layouts || {} })); }
  currentLayout() { const base = structuredClone(layouts[state.dashboard] || layouts.operations); const saved = this.storage.layouts?.[state.dashboard]; if (Array.isArray(saved)) base.widgets = saved; return base; }
  async render() {
    this.widgets.forEach((widget) => widget.destroy()); this.widgets = []; const grid = $('widgetGrid'); grid.replaceChildren();
    const layout = this.currentLayout(); if ($('statusDashboard')) $('statusDashboard').textContent = layout.label; $('dashboardSelect').value = state.dashboard;
    layout.widgets.filter((item) => viewFilter(state.view, item.type)).forEach((config) => { const Type = widgetClasses[config.type]; if (!Type) return; const widget = new Type(config, this); this.widgets.push(widget); grid.append(widget.render()); });
    $('statusEdit').textContent = this.canManageWorkspace ? 'Workspace controls enabled' : 'View only'; $('statusRole').textContent = state.role; $('statusOrg').textContent = state.organization.name || 'Company Workspace'; $('metricMode').textContent = state.consoleMode ? 'CONSOLE' : 'GLOW';
  }
  moveWidget(sourceId, targetId) {
    if (!this.canManageWorkspace || sourceId === targetId) return; const layout = this.currentLayout(); const source = layout.widgets.findIndex((x) => x.id === sourceId); const target = layout.widgets.findIndex((x) => x.id === targetId);
    if (source < 0 || target < 0) return; const item = layout.widgets.splice(source, 1)[0]; layout.widgets.splice(target, 0, item); this.storage.layouts ||= {}; this.storage.layouts[state.dashboard] = layout.widgets; this.saveLocal(); this.render(); notify('Workspace layout saved');
  }
  addWidget(type) {
    if (!this.canManageWorkspace) return; const titles = { kpi: 'Business KPIs', incidents: 'Incident Center', automations: 'Automation Queue', activity: 'Team Activity', calendar: 'Calendar', weather: 'Local Conditions', serverStatus: 'Service Health', githubProjects: 'Release Pipelines' };
    const layout = this.currentLayout(); const y = Math.max(...layout.widgets.map((item) => item.y + item.h), 0) + 1; layout.widgets.push({ id: type + '-' + Date.now(), type, title: titles[type] || type, x: 1, y, w: 4, h: 2 }); this.storage.layouts ||= {}; this.storage.layouts[state.dashboard] = layout.widgets; this.saveLocal(); this.render();
  }
  removeWidget(id) { if (!this.canManageWorkspace) return; const layout = this.currentLayout(); layout.widgets = layout.widgets.filter((item) => item.id !== id); this.storage.layouts ||= {}; this.storage.layouts[state.dashboard] = layout.widgets; this.saveLocal(); this.render(); }
}

const dashboard = new Dashboard();
function viewFilter(view, type) {
  const map = {
    Overview: null,
    Automations: ['automations'],
    Workflow: ['activity', 'githubProjects', 'calendar'],
    DevOps: ['serverStatus', 'githubProjects', 'automations'],
    Security: ['incidents', 'automations', 'activity', 'serverStatus'],
    Analytics: ['kpi', 'activity'],
    Settings: [],
  };
  return !map[view] || map[view].includes(type);
}

function exportLayout() {
  const layout = dashboard.currentLayout();
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(layout, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute('href', dataStr);
  dlAnchorElem.setAttribute('download', `glowhaven-layout-${state.dashboard}.json`);
  dlAnchorElem.click();
  notify('Workspace layout exported');
}

function importLayout(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || !Array.isArray(parsed.widgets)) throw new Error('Invalid layout file format');
      dashboard.storage.layouts ||= {};
      dashboard.storage.layouts[state.dashboard] = parsed.widgets;
      dashboard.saveLocal();
      dashboard.render();
      notify('Workspace layout imported successfully');
    } catch (err) {
      notify(err.message || 'Failed to import layout');
    }
  };
  reader.readAsText(file);
}

async function api(path, options = {}) {
  const method = options.method || 'GET'; const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD'].includes(method) && state.csrf) headers.set('X-Glowhaven-CSRF', state.csrf);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' }); let data = {}; try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'Request failed'); return data; }

function notify(message) { const toast = $('systemToast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 2800); }
function integration(kind) { return state.integrations.find((item) => item.kind === kind) || { kind, settings: {} }; }
function setValue(id, value) { const element = $(id); if (element) element.value = value ?? ''; }
function updateToggleStates() {
  $('themeToggle')?.setAttribute('aria-pressed', state.theme === 'light' ? 'true' : 'false');
  $('neonToggle')?.setAttribute('aria-pressed', state.visual === 'neon' ? 'true' : 'false');
  $('consoleToggle')?.setAttribute('aria-pressed', state.consoleMode ? 'true' : 'false');
}

async function refreshWorkspace() {
  try { const telemetry = await fetchTelemetrySnapshot(); $('metricAvailability').textContent = telemetry.metrics.availability; $('metricLatency').textContent = telemetry.metrics.latency; $('metricAlerts').textContent = telemetry.metrics.alerts; } catch {}
  await Promise.allSettled(dashboard.widgets.map((widget) => widget.updateData?.()));
}

function loadSettings() {
  setValue('settingsOrg', state.organization.name); setValue('settingsTimezone', state.organization.timezone); const weather = integration('weather').settings?.location || {}; setValue('settingsCity', weather.city); setValue('settingsLat', weather.lat); setValue('settingsLon', weather.lon); setValue('settingsWeatherUnits', integration('weather').settings?.units || 'imperial');
  setValue('settingsServices', (integration('services').settings?.endpoints || []).map((x) => typeof x === 'string' ? x : x.url).filter(Boolean).join('\n'));
  setValue('settingsRepos', (integration('github').settings?.repositories || []).map((x) => x.owner + '/' + x.repo).join('\n')); setValue('settingsKpi', integration('kpi').endpoint); setValue('settingsIncidents', integration('incidents').endpoint); setValue('settingsAutomations', integration('automations').endpoint); setValue('settingsActivity', integration('activity').endpoint);
  setValue('settingsCalendarProvider', integration('calendar').settings?.provider || 'none'); setValue('settingsCalendarGithubOrg', integration('calendar').settings?.org); setValue('settingsCalendarId', integration('calendar').settings?.calendarId); setValue('settingsCalendarEndpoint', integration('calendar').endpoint);
}

async function saveIntegration(kind, payload) { return api('/api/integrations/' + kind, { method: 'PUT', body: JSON.stringify(payload) }); }
async function loadSecurityPolicy() {
  if (!['owner', 'admin'].includes(state.role)) return;
  try {
    const policy = await api('/api/security/policy');
    setValue('settingsSsoDomains', (policy.ssoDomains || []).join(', '));
    if ($('settingsEnforceSso')) $('settingsEnforceSso').checked = Boolean(policy.enforceSso);
  } catch {}
}

async function saveSecurityPolicy() {
  if (!['owner', 'admin'].includes(state.role)) return;
  const ssoDomains = ($('settingsSsoDomains')?.value || '').split(',').map((x) => x.trim()).filter(Boolean);
  const enforceSso = Boolean($('settingsEnforceSso')?.checked);
  await api('/api/security/policy', { method: 'PUT', body: JSON.stringify({ enforceSso, ssoDomains }) });
}

async function saveSettings() {
  const repos = $('settingsRepos').value.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => { const parts = x.split('/'); return { owner: parts.shift(), repo: parts.join('/') }; }).filter((x) => x.owner && x.repo);
  await api('/api/config', { method: 'PUT', body: JSON.stringify({ organization: { name: $('settingsOrg').value.trim(), timezone: $('settingsTimezone').value.trim() } }) });
  await saveIntegration('weather', { settings: { units: $('settingsWeatherUnits').value, location: { city: $('settingsCity').value.trim(), lat: Number($('settingsLat').value), lon: Number($('settingsLon').value) } } });
  await saveIntegration('services', { settings: { endpoints: $('settingsServices').value.split('\n').map((x) => x.trim()).filter(Boolean).map((url) => ({ url })) } });
  const githubToken = $('settingsGithubToken').value; await saveIntegration('github', { settings: { repositories: repos }, authType: 'bearer', ...(githubToken ? { secret: githubToken } : {}) });
  await saveIntegration('kpi', { endpoint: $('settingsKpi').value.trim() }); await saveIntegration('incidents', { endpoint: $('settingsIncidents').value.trim() }); await saveIntegration('automations', { endpoint: $('settingsAutomations').value.trim() }); await saveIntegration('activity', { endpoint: $('settingsActivity').value.trim(), settings: { provider: $('settingsActivity').value.trim() ? 'http' : 'none' } });
  const calendarSecret = $('settingsCalendarSecret').value; await saveIntegration('calendar', { endpoint: $('settingsCalendarEndpoint').value.trim(), settings: { provider: $('settingsCalendarProvider').value, org: $('settingsCalendarGithubOrg').value.trim(), calendarId: $('settingsCalendarId').value.trim() }, ...(calendarSecret ? { secret: calendarSecret, authType: 'bearer' } : {}) });
  await saveSecurityPolicy();
  const config = await api('/api/config'); state.organization = config.organization; state.integrations = config.integrations; $('companyName').textContent = state.organization.name || 'Company Workspace'; $('settingsGithubToken').value = ''; $('settingsCalendarSecret').value = ''; $('settingsDialog').close(); await dashboard.render(); await refreshWorkspace(); notify('Company settings saved');
}

async function loadUsers() {
  if (!['owner', 'admin'].includes(state.role)) {
    document.querySelectorAll('.admin-only').forEach((x) => { x.hidden = true; });
    return;
  }
  document.querySelectorAll('.admin-only').forEach((x) => { x.hidden = false; });
  const users = await api('/api/users');
  const list = $('userList');
  if (!list) return;
  list.replaceChildren(...users.map((user) => {
    const row = document.createElement('li');
    const userMeta = document.createElement('span');
    userMeta.textContent = `${user.email} (${user.role})`;

    const actions = document.createElement('div');
    actions.className = 'user-actions';

    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge ${user.status || 'active'}`;
    statusBadge.textContent = user.status || 'active';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'mini-button';
    toggleBtn.type = 'button';
    toggleBtn.textContent = user.status === 'disabled' ? 'Enable' : 'Disable';
    toggleBtn.addEventListener('click', async () => {
      try {
        const nextStatus = user.status === 'disabled' ? 'active' : 'disabled';
        await api(`/api/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ status: nextStatus }) });
        notify(`User ${user.email} ${nextStatus}`);
        await loadUsers();
      } catch (e) {
        notify(e.message);
      }
    });

    const resetBtn = document.createElement('button');
    resetBtn.className = 'mini-button';
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset Pass';
    resetBtn.addEventListener('click', async () => {
      const newPassword = prompt(`Enter new password for ${user.email} (min 12 chars):`);
      if (!newPassword) return;
      try {
        await api(`/api/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ password: newPassword }) });
        notify(`Password updated for ${user.email}`);
      } catch (e) {
        notify(e.message);
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mini-button';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete user ${user.email}?`)) return;
      try {
        await api(`/api/users/${user.id}`, { method: 'DELETE' });
        notify(`User ${user.email} deleted`);
        await loadUsers();
      } catch (e) {
        notify(e.message);
      }
    });

    actions.append(statusBadge, toggleBtn, resetBtn, deleteBtn);
    row.append(userMeta, actions);
    return row;
  }));
}

async function createUser() { await api('/api/users', { method: 'POST', body: JSON.stringify({ email: $('newUserEmail').value.trim(), password: $('newUserPassword').value, role: $('newUserRole').value }) }); $('newUserEmail').value = ''; $('newUserPassword').value = ''; await loadUsers(); notify('User account created'); }

async function loadApiKeys() {
  if (!['owner', 'admin'].includes(state.role)) return;
  const list = $('keyList');
  if (!list) return;
  try {
    const keys = await api('/api/apikeys');
    list.replaceChildren(...keys.map((key) => {
      const row = document.createElement('li');
      const meta = document.createElement('span');
      meta.textContent = `${key.name} (${key.role}) · ${key.prefix}`;
      const actions = document.createElement('div');
      actions.className = 'user-actions';
      const revokeBtn = document.createElement('button');
      revokeBtn.className = 'mini-button';
      revokeBtn.type = 'button';
      revokeBtn.textContent = 'Revoke';
      revokeBtn.addEventListener('click', async () => {
        try {
          await api(`/api/apikeys/${key.id}`, { method: 'DELETE' });
          notify(`API key ${key.name} revoked`);
          await loadApiKeys();
        } catch (e) {
          notify(e.message);
        }
      });
      actions.append(revokeBtn);
      row.append(meta, actions);
      return row;
    }));
  } catch {}
}

async function createApiKey() {
  const name = $('newKeyName')?.value.trim();
  const role = $('newKeyRole')?.value || 'viewer';
  if (!name) return notify('API key name is required');
  try {
    const res = await api('/api/apikeys', { method: 'POST', body: JSON.stringify({ name, role }) });
    if ($('newKeyName')) $('newKeyName').value = '';
    const banner = $('newKeyBanner');
    if (banner) {
      banner.hidden = false;
      banner.textContent = `New API Key created for ${res.name}: ${res.token} (Copy now, it won't be shown again!)`;
    }
    await loadApiKeys();
    notify('API Key created');
  } catch (e) {
    notify(e.message);
  }
}

async function loadAudit(query = '') {
  if (!['owner', 'admin'].includes(state.role)) return;
  const q = encodeURIComponent(query.trim());
  const rows = await api('/api/audit?limit=100' + (q ? '&q=' + q : ''));
  const list = $('auditList');
  if (!list) return;
  list.replaceChildren(...rows.map((entry) => {
    const row = document.createElement('li');
    const a = document.createElement('span');
    const b = document.createElement('span');
    a.textContent = `${entry.actorEmail || 'system'}: ${entry.action}`;
    b.textContent = new Date(entry.timestamp).toLocaleString();
    row.append(a, b);
    return row;
  }));
}

function exportAuditCsv() {
  const q = encodeURIComponent(($('auditSearchInput')?.value || '').trim());
  window.open('/api/audit/export?format=csv' + (q ? '&q=' + q : ''), '_blank');
  notify('Exporting audit log CSV...');
}

async function verifyAudit() {
  try {
    const res = await api('/api/audit/verify', { method: 'POST', body: '{}' });
    if (res.valid) {
      notify(`Audit chain verified: ${res.count} records intact.`);
      const pill = $('auditStatusPill');
      if (pill) pill.textContent = `Audit Chain Verified (${res.count} entries)`;
    } else {
      notify('Audit verification alert: Chain mismatch detected!');
    }
  } catch (error) {
    notify(error.message);
  }
}

const commandList = [
  { name: 'View: Overview', action: () => switchView('Overview') },
  { name: 'View: Automations', action: () => switchView('Automations') },
  { name: 'View: Workflow', action: () => switchView('Workflow') },
  { name: 'View: DevOps', action: () => switchView('DevOps') },
  { name: 'View: Security & Compliance', action: () => switchView('Security') },
  { name: 'View: Analytics', action: () => switchView('Analytics') },
  { name: 'Action: Refresh Workspace', action: () => refreshWorkspace().then(() => notify('Workspace refreshed')) },
  { name: 'Action: Export Workspace Layout', action: () => exportLayout() },
  { name: 'Action: Verify Audit Chain', action: () => verifyAudit() },
  { name: 'Action: Open Company Settings', action: () => $('settingsButton')?.click() },
  { name: 'Toggle: Color Theme', action: () => $('themeToggle')?.click() },
  { name: 'Toggle: Visual Mode', action: () => $('neonToggle')?.click() },
  { name: 'Toggle: Console Mode', action: () => $('consoleToggle')?.click() },
];

async function switchView(viewName) {
  state.view = viewName;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });
  await dashboard.render();
  notify(`Switched to ${viewName} view`);
}

function renderCmdResults(filter = '') {
  const list = $('cmdResultsList');
  if (!list) return;
  const q = filter.trim().toLowerCase();
  const matched = commandList.filter((cmd) => cmd.name.toLowerCase().includes(q));
  list.replaceChildren(...matched.map((cmd) => {
    const li = document.createElement('li');
    li.className = 'cmd-item';
    li.textContent = cmd.name;
    li.addEventListener('click', () => {
      $('cmdDialog')?.close();
      cmd.action();
    });
    return li;
  }));
}

function bindEvents() {
  $('loginForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }) }); state.csrf = data.csrf; globalThis.__glowhavenCsrf = state.csrf; await authenticated(); } catch (error) { notify(error.message); } });
  $('setupForm').addEventListener('submit', async (e) => { e.preventDefault(); try { if ($('setupPassword').value !== $('setupPasswordConfirm').value) throw new Error('Passwords do not match'); const data = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ email: $('setupEmail').value, password: $('setupPassword').value }) }); state.csrf = data.csrf; globalThis.__glowhavenCsrf = state.csrf; await authenticated(); } catch (error) { notify(error.message); } });
  $('ssoButton').addEventListener('click', () => { window.location.href = '/api/auth/oidc/start'; }); $('logoutButton').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { location.reload(); } });
  $('settingsButton').addEventListener('click', async () => { loadSettings(); await Promise.allSettled([loadUsers(), loadAudit(), loadSecurityPolicy(), loadApiKeys()]); $('settingsDialog').showModal(); }); $('settingsCancel').addEventListener('click', () => $('settingsDialog').close()); $('settingsSave').addEventListener('click', () => saveSettings().catch((e) => notify(e.message))); $('userCreate').addEventListener('click', () => createUser().catch((e) => notify(e.message)));
  $('auditVerifyBtn')?.addEventListener('click', () => verifyAudit());
  $('auditExportCsvBtn')?.addEventListener('click', () => exportAuditCsv());
  $('auditSearchInput')?.addEventListener('input', (e) => loadAudit(e.target.value));
  $('keyCreateBtn')?.addEventListener('click', () => createApiKey());
  $('exportLayoutBtn')?.addEventListener('click', () => exportLayout());
  $('importLayoutFile')?.addEventListener('change', (e) => importLayout(e));
  $('cmdTriggerBtn')?.addEventListener('click', () => {
    renderCmdResults('');
    $('cmdSearchInput').value = '';
    $('cmdDialog').showModal();
    setTimeout(() => $('cmdSearchInput')?.focus(), 50);
  });
  $('cmdSearchInput')?.addEventListener('input', (e) => renderCmdResults(e.target.value));

  $('dashboardSelect').addEventListener('change', async (e) => { state.dashboard = e.target.value; dashboard.saveLocal(); await dashboard.render(); }); $('themeToggle').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.theme; updateToggleStates(); dashboard.saveLocal(); });
  $('neonToggle').addEventListener('click', () => { state.visual = state.visual === 'neon' ? 'minimal' : 'neon'; document.documentElement.dataset.visual = state.visual; updateToggleStates(); dashboard.saveLocal(); }); $('consoleToggle').addEventListener('click', () => { state.consoleMode = !state.consoleMode; document.body.classList.toggle('console-mode', state.consoleMode); updateToggleStates(); dashboard.saveLocal(); }); $('refreshAll').addEventListener('click', () => refreshWorkspace().then(() => notify('Workspace refreshed')).catch((e) => notify(e.message))); $('addWidget').addEventListener('click', () => dashboard.addWidget($('widgetType').value));
  $('searchInput').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); dashboard.widgets.forEach((w) => { w.element.hidden = Boolean(q) && !(w.config.title + ' ' + w.config.type).toLowerCase().includes(q); }); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      renderCmdResults('');
      $('cmdSearchInput').value = '';
      if ($('cmdDialog')?.open) {
        $('cmdDialog').close();
      } else {
        $('cmdDialog')?.showModal();
        setTimeout(() => $('cmdSearchInput')?.focus(), 50);
      }
      return;
    }
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
      e.preventDefault();
      $('searchInput')?.focus();
    }
  });
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', async () => { document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active')); button.classList.add('active'); state.view = button.dataset.view; await dashboard.render(); }));
}

async function loadWidgets() {
  const modules = await Promise.all([import('./widgets/calendar.js'), import('./widgets/weather.js'), import('./widgets/serverStatus.js'), import('./widgets/githubProjects.js'), import('./widgets/operations.js')]);
  widgetClasses.calendar = modules[0].default; widgetClasses.weather = modules[1].default; widgetClasses.serverStatus = modules[2].default; widgetClasses.githubProjects = modules[3].default; widgetClasses.kpi = modules[4].KpiWidget; widgetClasses.incidents = modules[4].IncidentWidget; widgetClasses.automations = modules[4].AutomationWidget; widgetClasses.activity = modules[4].ActivityWidget;
}

async function authenticated() {
  const session = await api('/api/auth/session'); state.user = session.user; state.role = session.user.role; state.csrf = session.csrf;
  const config = await api('/api/config'); state.organization = config.organization || state.organization; state.integrations = config.integrations || []; $('companyName').textContent = state.organization.name || 'Company Workspace'; $('statusOrg').textContent = state.organization.name || 'Company Workspace'; $('userEmail').textContent = state.user.email; $('userRole').textContent = state.role;
  $('appShell').hidden = false; $('authScreen').hidden = true; await loadWidgets(); await dashboard.render(); await refreshWorkspace();
}

async function boot() {
  const local = dashboard.storage; state.theme = local.theme || 'dark'; state.visual = local.visual || 'neon'; state.consoleMode = Boolean(local.consoleMode); state.dashboard = local.dashboard || 'operations'; document.documentElement.dataset.theme = state.theme; document.documentElement.dataset.visual = state.visual; document.body.classList.toggle('console-mode', state.consoleMode); updateToggleStates();
  bindEvents(); const session = await api('/api/auth/session'); if (session.authenticated) { state.csrf = session.csrf; globalThis.__glowhavenCsrf = state.csrf; await authenticated(); return; } $('authScreen').hidden = false; $('appShell').hidden = true; $('loginForm').hidden = session.setupRequired; $('setupForm').hidden = !session.setupRequired; $('ssoButton').hidden = !session.oidcEnabled;
}

boot().catch((error) => { console.error(error); notify(error.message || 'Glowhaven could not start'); });
