import { fetchActivity, fetchAutomations, fetchBusinessKpis, fetchCalendarEvents, fetchGithubProjects, fetchIncidents, fetchServerStatus, fetchTelemetrySnapshot, fetchWeather } from './dataSources.js';

const LOCAL_KEY = 'glowhaven-ui-v1';
const $ = (id) => document.getElementById(id);
const state = { user: null, csrf: '', organization: { name: 'Company Workspace', timezone: 'UTC' }, integrations: [], theme: 'dark', visual: 'neon', consoleMode: false, dashboard: 'operations', role: 'viewer', view: 'Overview' };

const layouts = {
  operations: { label: 'Operations', widgets: [
    { id: 'kpi', type: 'kpi', title: 'Business KPIs', x: 1, y: 1, w: 4, h: 2 },
    { id: 'incidents', type: 'incidents', title: 'Incident Center', x: 5, y: 1, w: 4, h: 2 },
    { id: 'automations', type: 'automations', title: 'Automation Queue', x: 9, y: 1, w: 4, h: 2 },
    { id: 'github', type: 'githubProjects', title: 'Release Pipelines', x: 1, y: 3, w: 6, h: 3 },
    { id: 'services', type: 'serverStatus', title: 'Service Health', x: 7, y: 3, w: 6, h: 3 },
  ] },
  team: { label: 'Team', widgets: [
    { id: 'activity', type: 'activity', title: 'Team Activity', x: 1, y: 1, w: 6, h: 3 },
    { id: 'calendar', type: 'calendar', title: 'Calendar', x: 7, y: 1, w: 6, h: 3 },
    { id: 'weather', type: 'weather', title: 'Local Conditions', x: 1, y: 4, w: 4, h: 2 },
    { id: 'team-kpi', type: 'kpi', title: 'Team KPIs', x: 5, y: 4, w: 8, h: 2 },
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
    const actions = document.createElement('div'); actions.className = 'widget-actions'; const role = document.createElement('span'); role.className = 'widget-badge'; role.textContent = this.dashboard.state.role; actions.append(role);
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
    const layout = this.currentLayout(); $('statusDashboard').textContent = layout.label; $('dashboardSelect').value = state.dashboard;
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
function viewFilter(view, type) { const map = { Overview: null, Automations: ['automations'], Workflow: ['activity', 'githubProjects', 'calendar'], Devices: ['serverStatus', 'weather'], Analytics: ['kpi', 'activity'], Settings: [] }; return !map[view] || map[view].includes(type); }

async function api(path, options = {}) {
  const method = options.method || 'GET'; const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD'].includes(method) && state.csrf) headers.set('X-Glowhaven-CSRF', state.csrf);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' }); let data = {}; try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
}

function notify(message) { const toast = $('systemToast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 2800); }
function integration(kind) { return state.integrations.find((item) => item.kind === kind) || { kind, settings: {} }; }
function setValue(id, value) { const element = $(id); if (element) element.value = value ?? ''; }

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
async function saveSettings() {
  const repos = $('settingsRepos').value.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => { const parts = x.split('/'); return { owner: parts.shift(), repo: parts.join('/') }; }).filter((x) => x.owner && x.repo);
  await api('/api/config', { method: 'PUT', body: JSON.stringify({ organization: { name: $('settingsOrg').value.trim(), timezone: $('settingsTimezone').value.trim() } }) });
  await saveIntegration('weather', { settings: { units: $('settingsWeatherUnits').value, location: { city: $('settingsCity').value.trim(), lat: Number($('settingsLat').value), lon: Number($('settingsLon').value) } } });
  await saveIntegration('services', { settings: { endpoints: $('settingsServices').value.split('\n').map((x) => x.trim()).filter(Boolean).map((url) => ({ url })) } });
  const githubToken = $('settingsGithubToken').value; await saveIntegration('github', { settings: { repositories: repos }, authType: 'bearer', ...(githubToken ? { secret: githubToken } : {}) });
  await saveIntegration('kpi', { endpoint: $('settingsKpi').value.trim() }); await saveIntegration('incidents', { endpoint: $('settingsIncidents').value.trim() }); await saveIntegration('automations', { endpoint: $('settingsAutomations').value.trim() }); await saveIntegration('activity', { endpoint: $('settingsActivity').value.trim(), settings: { provider: $('settingsActivity').value.trim() ? 'http' : 'none' } });
  const calendarSecret = $('settingsCalendarSecret').value; await saveIntegration('calendar', { endpoint: $('settingsCalendarEndpoint').value.trim(), settings: { provider: $('settingsCalendarProvider').value, org: $('settingsCalendarGithubOrg').value.trim(), calendarId: $('settingsCalendarId').value.trim() }, ...(calendarSecret ? { secret: calendarSecret, authType: 'bearer' } : {}) });
  const config = await api('/api/config'); state.organization = config.organization; state.integrations = config.integrations; $('companyName').textContent = state.organization.name || 'Company Workspace'; $('settingsGithubToken').value = ''; $('settingsCalendarSecret').value = ''; $('settingsDialog').close(); await dashboard.render(); await refreshWorkspace(); notify('Company settings saved');
}

async function loadUsers() { if (!['owner', 'admin'].includes(state.role)) { document.querySelectorAll('.admin-only').forEach((x) => { x.hidden = true; }); return; } document.querySelectorAll('.admin-only').forEach((x) => { x.hidden = false; }); const users = await api('/api/users'); const list = $('userList'); list.replaceChildren(...users.map((user) => { const row = document.createElement('li'); const a = document.createElement('span'); const b = document.createElement('span'); a.textContent = user.email; b.textContent = user.role; row.append(a, b); return row; })); }
async function createUser() { await api('/api/users', { method: 'POST', body: JSON.stringify({ email: $('newUserEmail').value.trim(), password: $('newUserPassword').value, role: $('newUserRole').value }) }); $('newUserEmail').value = ''; $('newUserPassword').value = ''; await loadUsers(); notify('User account created'); }
async function loadAudit() { if (!['owner', 'admin'].includes(state.role)) return; const rows = await api('/api/audit?limit=100'); const list = $('auditList'); list.replaceChildren(...rows.map((entry) => { const row = document.createElement('li'); const a = document.createElement('span'); const b = document.createElement('span'); a.textContent = entry.action; b.textContent = new Date(entry.timestamp).toLocaleString(); row.append(a, b); return row; })); }

function bindEvents() {
  $('loginForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }) }); state.csrf = data.csrf; globalThis.__glowhavenCsrf = state.csrf; await authenticated(); } catch (error) { notify(error.message); } });
  $('setupForm').addEventListener('submit', async (e) => { e.preventDefault(); try { if ($('setupPassword').value !== $('setupPasswordConfirm').value) throw new Error('Passwords do not match'); const data = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ email: $('setupEmail').value, password: $('setupPassword').value }) }); state.csrf = data.csrf; globalThis.__glowhavenCsrf = state.csrf; await authenticated(); } catch (error) { notify(error.message); } });
  $('ssoButton').addEventListener('click', () => { window.location.href = '/api/auth/oidc/start'; }); $('logoutButton').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { location.reload(); } });
  $('settingsButton').addEventListener('click', async () => { loadSettings(); await Promise.allSettled([loadUsers(), loadAudit()]); $('settingsDialog').showModal(); }); $('settingsCancel').addEventListener('click', () => $('settingsDialog').close()); $('settingsSave').addEventListener('click', () => saveSettings().catch((e) => notify(e.message))); $('userCreate').addEventListener('click', () => createUser().catch((e) => notify(e.message)));
  $('dashboardSelect').addEventListener('change', async (e) => { state.dashboard = e.target.value; dashboard.saveLocal(); await dashboard.render(); }); $('themeToggle').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.theme; dashboard.saveLocal(); });
  $('neonToggle').addEventListener('click', () => { state.visual = state.visual === 'neon' ? 'minimal' : 'neon'; document.documentElement.dataset.visual = state.visual; dashboard.saveLocal(); }); $('consoleToggle').addEventListener('click', () => { state.consoleMode = !state.consoleMode; document.body.classList.toggle('console-mode', state.consoleMode); dashboard.saveLocal(); }); $('refreshAll').addEventListener('click', () => refreshWorkspace().then(() => notify('Workspace refreshed')).catch((e) => notify(e.message))); $('addWidget').addEventListener('click', () => dashboard.addWidget($('widgetType').value));
  $('searchInput').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); dashboard.widgets.forEach((w) => { w.element.hidden = Boolean(q) && !(w.config.title + ' ' + w.config.type).toLowerCase().includes(q); }); });
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
  const local = dashboard.storage; state.theme = local.theme || 'dark'; state.visual = local.visual || 'neon'; state.consoleMode = Boolean(local.consoleMode); state.dashboard = local.dashboard || 'operations'; document.documentElement.dataset.theme = state.theme; document.documentElement.dataset.visual = state.visual; document.body.classList.toggle('console-mode', state.consoleMode);
  bindEvents(); const session = await api('/api/auth/session'); if (session.authenticated) { state.csrf = session.csrf; globalThis.__glowhavenCsrf = state.csrf; await authenticated(); return; } $('authScreen').hidden = false; $('appShell').hidden = true; $('loginForm').hidden = session.setupRequired; $('setupForm').hidden = !session.setupRequired; $('ssoButton').hidden = !session.oidcEnabled;
}

boot().catch((error) => { console.error(error); notify(error.message || 'Glowhaven could not start'); });
