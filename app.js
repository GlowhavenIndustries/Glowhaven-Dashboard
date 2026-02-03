import { fetchTelemetrySnapshot } from './dataSources.js';

const app = document.querySelector('.app');
const themeToggle = document.getElementById('themeToggle');
const neonToggle = document.getElementById('neonToggle');
const consoleToggle = document.getElementById('consoleToggle');
const dashboardSelect = document.getElementById('dashboardSelect');
const roleSelect = document.getElementById('roleSelect');
const encryptionToggle = document.getElementById('encryptionToggle');
const soundToggle = document.getElementById('soundToggle');
const exportButton = document.getElementById('exportConfig');
const importButton = document.getElementById('importConfig');
const importInput = document.getElementById('importInput');
const statusDashboard = document.getElementById('statusDashboard');
const statusRole = document.getElementById('statusRole');
const statusEdit = document.getElementById('statusEdit');
const statusSecurity = document.getElementById('statusSecurity');
const runtimeStatus = document.getElementById('runtimeStatus');

const STORAGE_KEY = 'glowhaven-dashboard-config';
const KEY_STORAGE = 'glowhaven-dashboard-key';

const widgetRegistry = {};
const dataSourceRegistry = {};

const defaultConfig = {
  encryptionEnabled: true,
  dataSources: {
    calendar: {
      provider: 'github',
      refreshMs: 300000,
      github: {
        org: 'github',
      },
      google: {
        apiKey: '',
        calendarId: '',
      },
      outlook: {
        endpoint: '',
        token: '',
      },
    },
    weather: {
      provider: 'openMeteo',
      refreshMs: 60000,
      openMeteo: {
        units: 'imperial',
        location: {
          city: 'San Francisco',
          lat: 37.7749,
          lon: -122.4194,
        },
      },
      openWeather: {
        apiKey: '',
        units: 'imperial',
        location: {
          city: 'San Francisco',
          lat: '',
          lon: '',
        },
      },
    },
    serverStatus: {
      refreshMs: 15000,
      endpoints: [],
    },
    github: {
      refreshMs: 60000,
      token: '',
      repositories: [
        { owner: 'github', repo: 'docs' },
        { owner: 'vercel', repo: 'next.js' },
      ],
    },
  },
  realtime: {
    enabled: true,
    sseUrl: '',
    websocketUrl: '',
    refreshMs: 5000,
  },
  remoteBackup: {
    enabled: false,
    endpoint: '',
  },
  dashboards: {
    personal: {
      id: 'personal',
      label: 'Personal',
      role: 'admin',
      widgets: [
        {
          id: 'calendar-1',
          type: 'calendar',
          title: 'Command Calendar',
          position: { x: 1, y: 1, w: 4, h: 2 },
          role: 'admin',
        },
        {
          id: 'weather-1',
          type: 'weather',
          title: 'Climate Intelligence',
          position: { x: 5, y: 1, w: 4, h: 2 },
          role: 'viewer',
        },
        {
          id: 'server-1',
          type: 'serverStatus',
          title: 'Global Systems Monitor',
          position: { x: 9, y: 1, w: 4, h: 2 },
          role: 'admin',
          priority: 'high',
        },
        {
          id: 'github-1',
          type: 'githubProjects',
          title: 'Pipeline Oversight',
          position: { x: 1, y: 3, w: 6, h: 3 },
          role: 'viewer',
        },
      ],
    },
    team: {
      id: 'team',
      label: 'Team',
      role: 'viewer',
      widgets: [
        {
          id: 'calendar-team',
          type: 'calendar',
          title: 'Global Sync Calendar',
          position: { x: 1, y: 1, w: 5, h: 2 },
          role: 'viewer',
        },
        {
          id: 'server-team',
          type: 'serverStatus',
          title: 'Fleet Telemetry',
          position: { x: 6, y: 1, w: 7, h: 2 },
          role: 'admin',
          priority: 'high',
        },
        {
          id: 'github-team',
          type: 'githubProjects',
          title: 'Release Pipelines',
          position: { x: 1, y: 3, w: 7, h: 3 },
          role: 'viewer',
        },
        {
          id: 'weather-team',
          type: 'weather',
          title: 'Ops Weather',
          position: { x: 8, y: 3, w: 5, h: 3 },
          role: 'viewer',
        },
      ],
    },
  },
};

class CryptoManager {
  static async getKey() {
    const storedKey = localStorage.getItem(KEY_STORAGE);
    if (storedKey) {
      const raw = Uint8Array.from(atob(storedKey), (c) => c.charCodeAt(0));
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    const raw = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(KEY_STORAGE, btoa(String.fromCharCode(...raw)));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  static async encrypt(payload) {
    const key = await CryptoManager.getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(payload);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
      iv: btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(cipher))),
    };
  }

  static async decrypt({ iv, data }) {
    const key = await CryptoManager.getKey();
    const decodedIv = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
    const decoded = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodedIv },
      key,
      decoded,
    );
    return new TextDecoder().decode(plainBuffer);
  }
}

class StorageManager {
  constructor() {
    this.encryptionEnabled = defaultConfig.encryptionEnabled;
  }

  async load() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return structuredClone(defaultConfig);
    }
    const parsed = JSON.parse(stored);
    if (parsed.encrypted) {
      const decrypted = await CryptoManager.decrypt(parsed.payload);
      return JSON.parse(decrypted);
    }
    return parsed;
  }

  async save(config) {
    if (config.encryptionEnabled) {
      const payload = await CryptoManager.encrypt(JSON.stringify(config));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ encrypted: true, payload }));
      await this.persistRemoteBackup(config, payload);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    await this.persistRemoteBackup(config, config);
  }

  async persistRemoteBackup(config, payload) {
    if (!config.remoteBackup?.enabled || !config.remoteBackup?.endpoint) {
      return;
    }
    try {
      await fetch(config.remoteBackup.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encrypted: config.encryptionEnabled,
          payload,
          updatedAt: new Date().toISOString(),
        }),
      });
    } catch (error) {
      // silently ignore backup failures
    }
  }
}

class Widget {
  constructor(config, dashboard) {
    this.config = config;
    this.dashboard = dashboard;
    this.telemetry = dashboard.telemetry;
    this.element = null;
  }

  render() {
    const card = document.createElement('article');
    card.className = 'widget-card';
    card.dataset.widgetId = this.config.id;
    if (this.config.priority === 'high') {
      card.classList.add('priority-high');
    }

    const header = document.createElement('div');
    header.className = 'widget-header';

    const title = document.createElement('h4');
    title.className = 'widget-title';
    title.textContent = this.config.title;

    const meta = document.createElement('div');
    meta.className = 'widget-meta';

    const roleBadge = document.createElement('span');
    roleBadge.className = 'widget-badge';
    roleBadge.textContent = this.config.role;

    const handle = document.createElement('button');
    handle.className = 'widget-handle';
    handle.type = 'button';
    handle.textContent = 'Drag';

    meta.append(roleBadge, handle);
    header.append(title, meta);

    const body = document.createElement('div');
    body.className = 'widget-body';
    body.appendChild(this.renderContent());

    card.append(header, body);

    if (this.dashboard.canEdit) {
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'widget-resize';
      card.appendChild(resizeHandle);
      this.attachDrag(handle);
      this.attachResize(resizeHandle);
    } else {
      handle.style.display = 'none';
    }

    this.element = card;
    this.updatePosition();
    return card;
  }

  renderContent() {
    const placeholder = document.createElement('p');
    placeholder.textContent = 'Widget content';
    return placeholder;
  }

  updatePosition() {
    if (!this.element) return;
    const { x, y, w, h } = this.config.position;
    this.element.style.gridColumn = `${x} / span ${w}`;
    this.element.style.gridRow = `${y} / span ${h}`;
  }

  move(nextPosition) {
    this.config.position = { ...this.config.position, ...nextPosition };
    this.updatePosition();
    this.dashboard.persist();
  }

  resize(nextSize) {
    this.config.position = { ...this.config.position, ...nextSize };
    this.updatePosition();
    this.dashboard.persist();
  }

  updateData() {}

  attachDrag(handle) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const grid = this.dashboard.grid;
      const gridRect = grid.getBoundingClientRect();
      const columnWidth = gridRect.width / this.dashboard.columns;
      const rowHeight = this.dashboard.rowHeight + this.dashboard.gap;

      const onMove = (moveEvent) => {
        const offsetX = moveEvent.clientX - gridRect.left;
        const offsetY = moveEvent.clientY - gridRect.top;
        const nextX = Math.min(
          this.dashboard.columns,
          Math.max(1, Math.round(offsetX / columnWidth)),
        );
        const nextY = Math.max(1, Math.round(offsetY / rowHeight));
        this.move({ x: nextX, y: nextY });
      };

      const onUp = () => {
        handle.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  attachResize(resizeHandle) {
    resizeHandle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      resizeHandle.setPointerCapture(event.pointerId);
      const grid = this.dashboard.grid;
      const gridRect = grid.getBoundingClientRect();
      const columnWidth = gridRect.width / this.dashboard.columns;
      const rowHeight = this.dashboard.rowHeight + this.dashboard.gap;
      const startPosition = { ...this.config.position };

      const onMove = (moveEvent) => {
        const offsetX = moveEvent.clientX - gridRect.left;
        const offsetY = moveEvent.clientY - gridRect.top;
        const endColumn = Math.min(
          this.dashboard.columns + 1,
          Math.max(1, Math.round(offsetX / columnWidth) + 1),
        );
        const endRow = Math.max(1, Math.round(offsetY / rowHeight) + 1);
        const nextW = Math.max(2, endColumn - startPosition.x);
        const nextH = Math.max(1, endRow - startPosition.y);
        this.resize({ w: nextW, h: nextH });
      };

      const onUp = () => {
        resizeHandle.releasePointerCapture(event.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
}

class Dashboard {
  constructor(config, storage, telemetry) {
    this.config = config;
    this.storage = storage;
    this.telemetry = telemetry;
    this.grid = document.getElementById('widgetGrid');
    this.columns = 12;
    this.rowHeight = 110;
    this.gap = 16;
    this.widgets = [];
  }

  get activeDashboard() {
    return this.config.dashboards[this.config.activeDashboardId];
  }

  get canEdit() {
    return this.activeDashboard.role === 'admin' && this.config.activeRole === 'admin';
  }

  async persist() {
    await this.storage.save(this.config);
  }

  setDashboard(id) {
    this.config.activeDashboardId = id;
    this.render();
    this.persist();
  }

  setRole(role) {
    this.config.activeRole = role;
    this.render();
    this.persist();
  }

  setEncryption(enabled) {
    this.config.encryptionEnabled = enabled;
    this.persist();
  }

  render() {
    this.grid.innerHTML = '';
    this.widgets = [];
    this.activeDashboard.widgets.forEach((widgetConfig) => {
      if (widgetConfig.role === 'admin' && this.config.activeRole !== 'admin') {
        return;
      }
      const WidgetType = widgetRegistry[widgetConfig.type];
      if (!WidgetType) return;
      const widgetInstance = new WidgetType(widgetConfig, this);
      this.widgets.push(widgetInstance);
      this.grid.appendChild(widgetInstance.render());
    });
    this.syncControls();
  }

  syncControls() {
    dashboardSelect.value = this.config.activeDashboardId;
    roleSelect.value = this.config.activeRole;
    encryptionToggle.textContent = this.config.encryptionEnabled ? 'Enforced' : 'Disabled';
    encryptionToggle.disabled = this.config.encryptionEnabled;
    updateOnboardingStatus(this);
  }
}

class TelemetryStream {
  constructor(config) {
    this.config = config;
    this.listeners = new Set();
    this.pollInterval = null;
    this.eventSource = null;
    this.socket = null;
    this.start();
  }

  subscribe(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  emit(payload) {
    this.listeners.forEach((handler) => handler(payload));
  }

  startPolling() {
    if (this.pollInterval) return;
    const refreshMs = this.config?.refreshMs || 5000;
    const poll = async () => {
      try {
        const payload = await fetchTelemetrySnapshot({
          endpoints: this.config?.endpoints,
        });
        this.emit(payload);
      } catch (error) {
        this.emit({
          type: 'telemetry',
          metrics: {},
          server: { uptime: '—', incidents: '—', services: [] },
        });
      }
    };
    poll();
    this.pollInterval = window.setInterval(poll, refreshMs);
  }

  start() {
    if (!this.config?.enabled) return;
    if (this.config.websocketUrl) {
      try {
        this.socket = new WebSocket(this.config.websocketUrl);
        this.socket.onmessage = (event) => {
          try {
            this.emit(JSON.parse(event.data));
          } catch (error) {
            this.emit({ type: 'raw', data: event.data });
          }
        };
        this.socket.onerror = () => {
          this.socket?.close();
          this.startPolling();
        };
        return;
      } catch (error) {
        this.startPolling();
        return;
      }
    }
    if (this.config.sseUrl) {
      try {
        this.eventSource = new EventSource(this.config.sseUrl);
        this.eventSource.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            this.emit(payload);
          } catch (error) {
            this.emit({ type: 'raw', data: event.data });
          }
        };
        this.eventSource.onerror = () => {
          this.eventSource.close();
          this.startPolling();
        };
        return;
      } catch (error) {
        this.startPolling();
        return;
      }
    }
    this.startPolling();
  }
}

function createPluginAPI(dashboard) {
  return {
    registerWidget: (type, widgetClass) => {
      if (!type || typeof widgetClass !== 'function') return;
      widgetRegistry[type] = widgetClass;
    },
    registerDataSource: (name, handler) => {
      if (!name || typeof handler !== 'function') return;
      dataSourceRegistry[name] = handler;
    },
    getConfig: () => dashboard.config,
    getActiveRole: () => dashboard.config.activeRole,
    onTelemetry: (handler) => dashboard.telemetry?.subscribe(handler),
  };
}

async function loadPlugins(dashboard) {
  const manifestResponse = await fetch('./plugins/manifest.json').catch(() => null);
  if (!manifestResponse || !manifestResponse.ok) return;
  const manifest = await manifestResponse.json();
  if (!Array.isArray(manifest.plugins)) return;
  const api = createPluginAPI(dashboard);
  await Promise.all(
    manifest.plugins.map((plugin) => {
      const pluginPath = typeof plugin === 'string' ? plugin : plugin.path;
      const options = typeof plugin === 'object' ? plugin.options : undefined;
      const roles =
        typeof plugin === 'object' && Array.isArray(plugin.roles)
          ? plugin.roles
          : ['admin', 'viewer'];
      if (!roles.includes(dashboard.config.activeRole)) {
        return Promise.resolve();
      }
      if (!pluginPath) return Promise.resolve();
      return import(pluginPath).then((module) => {
        const meta = module.meta || {};
        if (meta.apiVersion && meta.apiVersion !== '1.0') {
          console.warn(`Plugin ${meta.name || pluginPath} incompatible API version.`);
          return;
        }
        if (module.init) {
          module.init(api, options);
        }
      });
    }),
  );
}

function syncHeroMetrics(metrics = {}) {
  const availability = document.getElementById('metricAvailability');
  const latency = document.getElementById('metricLatency');
  const alerts = document.getElementById('metricAlerts');
  if (availability && metrics.availability) availability.textContent = metrics.availability;
  if (latency && metrics.latency) latency.textContent = metrics.latency;
  if (alerts && metrics.alerts) alerts.textContent = metrics.alerts;
}

function setStatusPill(element, text, variant) {
  if (!element) return;
  element.textContent = text;
  element.classList.remove('positive', 'warning', 'neutral');
  element.classList.add(variant);
}

function syncRuntimeStatus() {
  if (!runtimeStatus) return;
  if (window.location.protocol === 'file:') {
    setStatusPill(runtimeStatus, 'Local file mode', 'warning');
  } else {
    setStatusPill(runtimeStatus, 'Secure runtime', 'positive');
  }
}

function updateOnboardingStatus(dashboard) {
  if (!dashboard) return;
  const activeDashboard = dashboard.activeDashboard;
  setStatusPill(
    statusDashboard,
    `${activeDashboard?.label || 'Personal'} dashboard`,
    'neutral',
  );
  setStatusPill(statusRole, `${dashboard.config.activeRole} role`, 'neutral');
  setStatusPill(
    statusEdit,
    dashboard.canEdit ? 'Edit mode enabled' : 'View-only mode',
    dashboard.canEdit ? 'positive' : 'warning',
  );
  setStatusPill(
    statusSecurity,
    dashboard.config.encryptionEnabled ? 'Encryption enforced' : 'Encryption off',
    dashboard.config.encryptionEnabled ? 'positive' : 'warning',
  );
  syncRuntimeStatus();
}

async function init() {
  const widgetModules = await Promise.all([
    import('./widgets/calendar.js'),
    import('./widgets/weather.js'),
    import('./widgets/serverStatus.js'),
    import('./widgets/githubProjects.js'),
  ]);
  widgetRegistry.calendar = widgetModules[0].default;
  widgetRegistry.weather = widgetModules[1].default;
  widgetRegistry.serverStatus = widgetModules[2].default;
  widgetRegistry.githubProjects = widgetModules[3].default;

  const storage = new StorageManager();
  const storedConfig = await storage.load();
  const config = {
    ...defaultConfig,
    ...storedConfig,
    dataSources: {
      ...defaultConfig.dataSources,
      ...storedConfig.dataSources,
    },
    realtime: {
      ...defaultConfig.realtime,
      ...storedConfig.realtime,
    },
    remoteBackup: {
      ...defaultConfig.remoteBackup,
      ...storedConfig.remoteBackup,
    },
    dashboards: storedConfig.dashboards || defaultConfig.dashboards,
    activeDashboardId: storedConfig.activeDashboardId || 'personal',
    activeRole:
      storedConfig.activeRole || storedConfig.dashboards?.personal?.role || 'admin',
  };

  const telemetry = new TelemetryStream(config.realtime);
  telemetry.subscribe((payload) => {
    if (payload.type === 'telemetry' && payload.metrics) {
      syncHeroMetrics(payload.metrics);
    }
  });

  const dashboard = new Dashboard(config, storage, telemetry);
  dashboard.render();
  syncRuntimeStatus();

  themeToggle.addEventListener('click', () => {
    const nextTheme = app.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    app.setAttribute('data-theme', nextTheme);
  });

  neonToggle.addEventListener('click', () => {
    const nextVisual = app.getAttribute('data-visual') === 'neon' ? 'standard' : 'neon';
    app.setAttribute('data-visual', nextVisual);
  });

  consoleToggle.addEventListener('click', () => {
    app.classList.toggle('console-mode');
  });

  dashboardSelect.addEventListener('change', (event) => {
    dashboard.setDashboard(event.target.value);
  });

  roleSelect.addEventListener('change', (event) => {
    dashboard.setRole(event.target.value);
  });

  encryptionToggle.addEventListener('click', () => {
    if (dashboard.config.encryptionEnabled) {
      return;
    }
    const nextValue = !dashboard.config.encryptionEnabled;
    dashboard.setEncryption(nextValue);
    dashboard.syncControls();
  });

  soundToggle.addEventListener('click', () => {
    soundToggle.textContent = soundToggle.textContent === 'Muted' ? 'Active' : 'Muted';
  });

  exportButton.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(dashboard.config, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `glowhaven-dashboard-${dashboard.config.activeDashboardId}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  importButton.addEventListener('click', () => {
    importInput.click();
  });

  importInput.addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    const text = await file.text();
    const imported = JSON.parse(text);
    dashboard.config = imported;
    dashboard.render();
    await dashboard.persist();
    importInput.value = '';
  });

  await loadPlugins(dashboard);
}

init();

export { Widget };
