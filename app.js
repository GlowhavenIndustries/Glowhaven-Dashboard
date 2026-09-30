import { fetchTelemetrySnapshot } from './dataSources.js';

export class Widget {
  constructor(config, dashboard) {
    this.config = config;
    this.dashboard = dashboard;
    this.element = null;
    this.cleanups = [];
    this.intervals = [];
  }

  render() {
    const card = document.createElement('article');
    card.className = 'widget-card';
    card.dataset.widgetId = this.config.id;
    card.style.gridColumn = `${this.config.position?.x || 1} / span ${this.config.position?.w || 4}`;
    card.style.gridRow = `${this.config.position?.y || 1} / span ${this.config.position?.h || 2}`;

    const header = document.createElement('header');
    header.className = 'widget-header';
    const title = document.createElement('div');
    title.innerHTML = '<span class="eyebrow"></span><h3></h3>';
    title.querySelector('.eyebrow').textContent = this.config.type;
    title.querySelector('h3').textContent = this.config.title || 'Module';

    const actions = document.createElement('div');
    actions.className = 'widget-actions';
    const badge = document.createElement('span');
    badge.className = 'widget-badge';
    badge.textContent = this.config.role || 'viewer';
    actions.appendChild(badge);

    if (this.dashboard.canEdit) {
      const remove = document.createElement('button');
      remove.className = 'icon-button';
      remove.type = 'button';
      remove.title = 'Remove widget';
      remove.textContent = '×';
      remove.addEventListener('click', () => this.dashboard.removeWidget(this.config.id));
      actions.appendChild(remove);
    }

    header.append(title, actions);
    const body = document.createElement('div');
    body.className = 'widget-body';
    body.appendChild(this.renderContent());
    card.append(header, body);
    if (this.dashboard.canEdit) this.enableDrag(card);
    this.element = card;
    return card;
  }

  renderContent() {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Loading…';
    return p;
  }

  every(fn, ms) {
    const timer = setInterval(fn, ms);
    this.intervals.push(timer);
    return timer;
  }

  enableDrag(card) {
    card.setAttribute('draggable', 'true');
    const onDragStart = (event) => {
      card.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', this.config.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    };
    const onDragEnd = () => card.classList.remove('is-dragging');
    const onDragOver = (event) => { event.preventDefault(); card.classList.add('drop-target'); };
    const onDragLeave = () => card.classList.remove('drop-target');
    const onDrop = (event) => {
      event.preventDefault();
      card.classList.remove('drop-target');
      const sourceId = event.dataTransfer?.getData('text/plain');
      if (sourceId) this.dashboard.moveWidget(sourceId, this.config.id);
    };
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
    card.addEventListener('dragover', onDragOver);
    card.addEventListener('dragleave', onDragLeave);
    card.addEventListener('drop', onDrop);
    this.cleanups.push(() => {
      card.removeEventListener('dragstart', onDragStart);
      card.removeEventListener('dragend', onDragEnd);
      card.removeEventListener('dragover', onDragOver);
      card.removeEventListener('dragleave', onDragLeave);
      card.removeEventListener('drop', onDrop);
    });
  }

  destroy() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    this.unsubscribe?.();
  }
}

const DEFAULT_CONFIG = {
  version: 4,
  theme: 'dark',
  visual: 'neon',
  consoleMode: false,
  activeDashboardId: 'operations',
  activeRole: 'admin',
  organization: { name: 'Your Company', timezone: 'local' },
  dataSources: {
    calendar: { provider: 'none', refreshMs: 300000, github: { org: '' } },
    weather: { provider: 'openMeteo', refreshMs: 60000, openMeteo: { units: 'imperial', location: { city: '', lat: null, lon: null } } },
    serverStatus: { refreshMs: 15000, endpoints: [] },
    github: { refreshMs: 60000, token: '', repositories: [] },
    kpi: { refreshMs: 60000, endpoint: '', token: '', metrics: [] },
    incidents: { refreshMs: 30000, endpoint: '', token: '', incidents: [] },
    automations: { refreshMs: 30000, endpoint: '', token: '', automations: [] },
    activity: { refreshMs: 30000, provider: 'none', github: { org: '' }, endpoint: '', token: '' }
  },
  realtime: { enabled: true, refreshMs: 5000 },
  dashboards: {
    operations: {
      id: 'operations', label: 'Operations', role: 'admin',
      widgets: [
        { id: 'kpi-1', type: 'kpi', title: 'Business Pulse', position: { x: 1, y: 1, w: 4, h: 2 }, role: 'viewer' },
        { id: 'incident-1', type: 'incidents', title: 'Incident Center', position: { x: 5, y: 1, w: 4, h: 2 }, role: 'admin' },
        { id: 'automation-1', type: 'automations', title: 'Automation Queue', position: { x: 9, y: 1, w: 4, h: 2 }, role: 'admin' },
        { id: 'github-1', type: 'githubProjects', title: 'Release Pipelines', position: { x: 1, y: 3, w: 6, h: 3 }, role: 'viewer' },
        { id: 'server-1', type: 'serverStatus', title: 'Service Health', position: { x: 7, y: 3, w: 6, h: 3 }, role: 'viewer' }
      ]
    },
    team: {
      id: 'team', label: 'Team', role: 'viewer',
      widgets: [
        { id: 'activity-team', type: 'activity', title: 'Team Activity', position: { x: 1, y: 1, w: 6, h: 3 }, role: 'viewer' },
        { id: 'calendar-team', type: 'calendar', title: 'Team Calendar', position: { x: 7, y: 1, w: 6, h: 3 }, role: 'viewer' },
        { id: 'weather-team', type: 'weather', title: 'Local Conditions', position: { x: 1, y: 4, w: 4, h: 2 }, role: 'viewer' },
        { id: 'kpi-team', type: 'kpi', title: 'Team Pulse', position: { x: 5, y: 4, w: 8, h: 2 }, role: 'viewer' }
      ]
    }
  }
};

const STORAGE_KEY = 'glowhaven-dashboard-v4';
const registry = {};
const $ = (id) => document.getElementById(id);
const clone = (value) => structuredClone(value);

function mergeConfig(base, patch = {}) {
  return {
    ...base, ...patch,
    organization: { ...base.organization, ...patch.organization },
    dataSources: Object.fromEntries(Object.keys(base.dataSources).map((key) => [
      key,
      { ...(base.dataSources[key] || {}), ...(patch.dataSources?.[key] || {}) }
    ])),
    realtime: { ...base.realtime, ...patch.realtime },
    dashboards: patch.dashboards || base.dashboards
  };
}

class Storage {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? mergeConfig(clone(DEFAULT_CONFIG), JSON.parse(raw)) : clone(DEFAULT_CONFIG);
    } catch {
      return clone(DEFAULT_CONFIG);
    }
  }
  save(config) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); return true; } catch { return false; }
  }
}

class Telemetry {
  constructor(config) { this.config = config; this.listeners = new Set(); this.timer = null; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  start() {
    if (!this.config?.enabled || this.timer) return;
    const poll = async () => {
      try {
        const data = await fetchTelemetrySnapshot(this.config);
        this.listeners.forEach((fn) => fn(data));
      } catch {}
    };
    poll();
    this.timer = setInterval(poll, Math.max(3000, this.config.refreshMs || 5000));
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

class Dashboard {
  constructor(config, storage, telemetry) {
    this.config = config;
    this.storage = storage;
    this.telemetry = telemetry;
    this.grid = $('widgetGrid');
    this.widgets = [];
  }

  get activeDashboard() { return this.config.dashboards[this.config.activeDashboardId] || this.config.dashboards.operations; }
  get canEdit() { return this.config.activeRole === 'admin' && this.activeDashboard.role === 'admin'; }

  get viewTypes() {
    return {
      Overview: null,
      Automations: ['automations'],
      Workflow: ['activity', 'githubProjects', 'calendar'],
      Devices: ['serverStatus', 'weather'],
      Analytics: ['kpi', 'activity'],
      Settings: []
    }[this.view || 'Overview'];
  }

  setView(view) {
    this.view = view;
    this.render();
  }

  moveWidget(sourceId, targetId) {
    if (!this.canEdit || sourceId === targetId) return;
    const widgets = this.activeDashboard.widgets;
    const source = widgets.findIndex((w) => w.id === sourceId);
    const target = widgets.findIndex((w) => w.id === targetId);
    if (source < 0 || target < 0) return;
    [widgets[source].position, widgets[target].position] = [widgets[target].position, widgets[source].position];
    [widgets[source], widgets[target]] = [widgets[target], widgets[source]];
    this.render();
    this.persist();
  }

  persist() { this.storage.save(this.config); updateStatus(this); }

  render() {
    this.widgets.forEach((widget) => widget.destroy());
    this.widgets = [];
    this.grid.replaceChildren();

    this.activeDashboard.widgets
      .filter((cfg) => cfg.role !== 'admin' || this.config.activeRole === 'admin')
      .filter((cfg) => !this.viewTypes || this.viewTypes.includes(cfg.type))
      .forEach((cfg) => {
        const Type = registry[cfg.type];
        if (!Type) return;
        const widget = new Type(cfg, this);
        this.widgets.push(widget);
        this.grid.appendChild(widget.render());
      });

    updateStatus(this);
  }

  setDashboard(id) {
    if (!this.config.dashboards[id]) return;
    this.config.activeDashboardId = id;
    this.render();
    this.persist();
  }

  setRole(role) {
    this.config.activeRole = role;
    this.render();
    this.persist();
  }

  removeWidget(id) {
    this.activeDashboard.widgets = this.activeDashboard.widgets.filter((w) => w.id !== id);
    this.render();
    this.persist();
  }

  addWidget(type) {
    const titles = {
      kpi: 'Business Pulse', incidents: 'Incident Center', automations: 'Automation Queue',
      activity: 'Team Activity', calendar: 'Calendar', weather: 'Weather',
      serverStatus: 'Service Health', githubProjects: 'Release Pipelines'
    };
    const n = this.activeDashboard.widgets.length;
    this.activeDashboard.widgets.push({
      id: `${type}-${Date.now()}`, type, title: titles[type] || 'New Module',
      position: { x: 1, y: 7 + n, w: 4, h: 2 }, role: 'viewer'
    });
    this.render();
    this.persist();
  }
}

function updateStatus(dashboard) {
  const dash = dashboard.activeDashboard;
  $('dashboardSelect').value = dashboard.config.activeDashboardId;
  $('roleSelect').value = dashboard.config.activeRole;
  $('statusDashboard').textContent = dash.label;
  $('statusRole').textContent = dashboard.config.activeRole;
  $('statusEdit').textContent = dashboard.canEdit ? 'Admin controls active' : 'View only';
  $('statusOrg').textContent = dashboard.config.organization?.name || 'Your Company';
  $('metricMode').textContent = dashboard.config.consoleMode ? 'CONSOLE' : 'GLOW';
}

function notify(message) {
  const toast = $('systemToast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function downloadConfig(config) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `glowhaven-dashboard-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const modules = await Promise.all([
    import('./widgets/calendar.js'), import('./widgets/weather.js'),
    import('./widgets/serverStatus.js'), import('./widgets/githubProjects.js'),
    import('./widgets/operations.js')
  ]);

  Object.assign(registry, {
    calendar: modules[0].default, weather: modules[1].default,
    serverStatus: modules[2].default, githubProjects: modules[3].default,
    kpi: modules[4].KpiWidget, incidents: modules[4].IncidentWidget,
    automations: modules[4].AutomationWidget, activity: modules[4].ActivityWidget
  });

  const storage = new Storage();
  const config = storage.load();
  const telemetry = new Telemetry(config.realtime);
  const dashboard = new Dashboard(config, storage, telemetry);
  dashboard.view = 'Overview';

  document.documentElement.dataset.theme = config.theme;
  document.documentElement.dataset.visual = config.visual;
  document.body.classList.toggle('console-mode', config.consoleMode);

  dashboard.render();
  telemetry.subscribe((data) => {
    if (data?.metrics) {
      $('metricAvailability').textContent = data.metrics.availability || 'N/A';
      $('metricLatency').textContent = data.metrics.latency || 'N/A';
      $('metricAlerts').textContent = data.metrics.alerts || 'N/A';
    }
  });
  telemetry.start();

  $('dashboardSelect').addEventListener('change', (e) => dashboard.setDashboard(e.target.value));
  $('roleSelect').addEventListener('change', (e) => dashboard.setRole(e.target.value));
  $('themeToggle').addEventListener('click', () => {
    config.theme = config.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = config.theme; dashboard.persist();
  });
  $('neonToggle').addEventListener('click', () => {
    config.visual = config.visual === 'neon' ? 'minimal' : 'neon';
    document.documentElement.dataset.visual = config.visual; dashboard.persist();
  });
  $('consoleToggle').addEventListener('click', () => {
    config.consoleMode = !config.consoleMode;
    document.body.classList.toggle('console-mode', config.consoleMode); dashboard.persist();
  });
  $('exportConfig').addEventListener('click', () => { downloadConfig(config); notify('Configuration exported'); });
  $('importConfig').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const imported = JSON.parse(await file.text());
      Object.assign(config, mergeConfig(clone(DEFAULT_CONFIG), imported));
      dashboard.render(); dashboard.persist(); notify('Configuration imported');
    } catch { notify('That configuration file is invalid'); }
    e.target.value = '';
  });
  function populateSettings() {
    $('settingsOrg').value = config.organization?.name || '';
    const location = config.dataSources.weather?.openMeteo?.location || {};
    $('settingsCity').value = location.city || '';
    $('settingsLat').value = location.lat ?? '';
    $('settingsLon').value = location.lon ?? '';
    $('settingsServices').value = (config.dataSources.serverStatus?.endpoints || []).map((entry) => typeof entry === 'string' ? entry : entry.url).filter(Boolean).join('\\n');
    $('settingsRepos').value = (config.dataSources.github?.repositories || []).map((entry) => `${entry.owner}/${entry.repo}`).join('\\n');
    $('settingsGithubToken').value = config.dataSources.github?.token || '';
    $('settingsKpi').value = config.dataSources.kpi?.endpoint || '';
    $('settingsIncidents').value = config.dataSources.incidents?.endpoint || '';
    $('settingsAutomations').value = config.dataSources.automations?.endpoint || '';
    $('settingsActivity').value = config.dataSources.activity?.endpoint || '';
  }

  function saveSettings() {
    const services = $('settingsServices').value.split(/\\n/).map((url) => url.trim()).filter(Boolean).map((url) => ({ url }));
    const repositories = $('settingsRepos').value.split(/\\n/).map((line) => line.trim()).filter(Boolean).map((value) => {
      const [owner, ...rest] = value.split('/');
      return { owner, repo: rest.join('/') };
    }).filter((entry) => entry.owner && entry.repo);

    config.organization.name = $('settingsOrg').value.trim() || 'Your Company';
    config.dataSources.serverStatus.endpoints = services;
    config.dataSources.github.repositories = repositories;
    config.dataSources.github.token = $('settingsGithubToken').value.trim();

    const weather = config.dataSources.weather.openMeteo;
    const lat = Number($('settingsLat').value);
    const lon = Number($('settingsLon').value);
    weather.location = {
      city: $('settingsCity').value.trim(),
      lat: Number.isFinite(lat) ? lat : weather.location.lat,
      lon: Number.isFinite(lon) ? lon : weather.location.lon
    };

    config.dataSources.kpi.endpoint = $('settingsKpi').value.trim();
    config.dataSources.incidents.endpoint = $('settingsIncidents').value.trim();
    config.dataSources.automations.endpoint = $('settingsAutomations').value.trim();
    config.dataSources.activity.endpoint = $('settingsActivity').value.trim();
    if (config.dataSources.activity.endpoint) config.dataSources.activity.provider = 'http';

    dashboard.render();
    dashboard.persist();
    $('settingsDialog').close();
    notify('Company settings saved');
  }

  $('settingsButton').addEventListener('click', () => {
    populateSettings();
    $('settingsDialog').showModal();
  });
  $('settingsCancel').addEventListener('click', () => $('settingsDialog').close());
  $('settingsSave').addEventListener('click', saveSettings);
    $('addWidget').addEventListener('click', () => dashboard.addWidget($('widgetType').value));
  $('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    dashboard.widgets.forEach((w) => {
      w.element.hidden = !!q && !`${w.config.title} ${w.config.type}`.toLowerCase().includes(q);
    });
  });
  $('refreshAll').addEventListener('click', async () => {
    await Promise.all(dashboard.widgets.map((w) => w.updateData?.()));
    notify('All modules refreshed');
  });
  document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
    btn.classList.add('active');
    dashboard.setView(btn.dataset.view || btn.textContent);
    notify(`${btn.dataset.view || btn.textContent} view selected`);
  }));
  $('launchButton').addEventListener('click', () => notify('Directive queued locally · ready for execution'));
}

init().catch((error) => {
  console.error(error);
  notify('Glowhaven failed to initialize');
});
