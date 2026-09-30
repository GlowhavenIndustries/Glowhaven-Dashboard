const DEFAULT_TIMEOUT = 8000;

export async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT, fetchImpl = globalThis.fetch, ...requestOptions } = options;
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = requestOptions.signal;
  const forwardAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetchImpl(url, { ...requestOptions, signal: controller.signal });
    if (!response.ok) throw new Error('Request failed: ' + response.status);
    return response;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  return response.json();
}

export function resolveEndpointConfig(endpoints) {
  if (!Array.isArray(endpoints)) return [];
  return endpoints.map((entry) => typeof entry === 'string' ? { url: entry } : entry)
    .filter((entry) => typeof entry?.url === 'string' && entry.url.trim())
    .map((entry) => {
      const normalized = { url: entry.url.trim() };
      if (typeof entry.name === 'string' && entry.name.trim()) normalized.name = entry.name.trim();
      return normalized;
    });
}

export function mapWeatherCode(code) {
  return ({
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Heavy rain showers',
    82: 'Violent rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
  })[code] || 'Cloudy';
}

export function summarizeStatus(results) {
  const safe = Array.isArray(results) ? results : [];
  if (!safe.length) return { uptime: 'Not configured', incidents: 'Not configured', failures: 0, services: [], latencyAvg: 0 };
  const failures = safe.filter((x) => !x.ok).length;
  return {
    uptime: ((safe.length - failures) / safe.length * 100).toFixed(2) + '%',
    incidents: failures + ' incidents',
    failures,
    services: safe.map((x) => ({ name: x.name, status: x.ok ? (x.status || 'Stable') : 'Offline' })),
    latencyAvg: Math.round(safe.reduce((sum, x) => sum + (Number(x.latency) || 0), 0) / safe.length),
  };
}

async function serverData(kind) {
  return fetchJson('/api/integrations/' + encodeURIComponent(kind) + '/data');
}

export async function fetchBusinessKpis() {
  const data = await serverData('kpi');
  return { metrics: Array.isArray(data.metrics || data.kpis) ? (data.metrics || data.kpis) : [] };
}

export async function fetchIncidents() {
  const data = await serverData('incidents');
  return { incidents: Array.isArray(data.incidents || data.items) ? (data.incidents || data.items) : [] };
}

export async function fetchAutomations() {
  const data = await serverData('automations');
  return { automations: Array.isArray(data.automations || data.items) ? (data.automations || data.items) : [] };
}

export async function fetchActivity() {
  const data = await serverData('activity');
  return { items: Array.isArray(data.items || data.activity) ? (data.items || data.activity) : [] };
}

export async function fetchCalendarEvents() {
  const data = await serverData('calendar');
  return Array.isArray(data.events) ? data.events : [];
}

export async function fetchWeather() {
  return serverData('weather');
}

export async function fetchServerStatus() {
  return serverData('services');
}

export async function fetchGithubProjects() {
  return serverData('github');
}

export async function fetchTelemetrySnapshot() {
  const data = await fetchServerStatus();
  return {
    type: 'telemetry',
    metrics: {
      availability: data.uptime || 'Not configured',
      latency: (Number(data.latencyAvg) || 0) + 'ms',
      alerts: (Number(data.failures) || 0) + ' open',
    },
    server: data,
  };
}

export async function executeAutomation(payload = {}) {
  const csrf = globalThis.__glowhavenCsrf || '';
  return fetchJson('/api/automations/run', {
    method: 'POST',
    headers: csrf ? { 'X-Glowhaven-CSRF': csrf, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
