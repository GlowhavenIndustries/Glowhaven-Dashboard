const DEFAULT_TIMEOUT = 8000;
const DEFAULT_RETRIES = 2;
const DEFAULT_ENDPOINTS = [
  'https://api.github.com',
  'https://api.github.com/rate_limit',
  'https://api.github.com/meta',
];

const DEFAULT_GITHUB_REPOS = [
  { owner: 'openai', repo: 'openai-cookbook' },
  { owner: 'vercel', repo: 'next.js' },
];

const JSON_HEADERS = {
  Accept: 'application/json',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  const retrySeconds = Number(retryAfter);
  if (Number.isFinite(retrySeconds) && retrySeconds >= 0) {
    return Math.min(retrySeconds * 1000, 10000);
  }
  return Math.min(250 * 2 ** attempt, 2000);
}

export async function fetchWithTimeout(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    fetchImpl = globalThis.fetch,
    ...requestOptions
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available in this environment');
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = requestOptions.signal;

    const abortExternal = () => controller.abort();
    externalSignal?.addEventListener('abort', abortExternal, { once: true });

    try {
      const response = await fetchImpl(url, {
        ...requestOptions,
        signal: controller.signal,
      });

      if (response.ok) return response;

      const retryable = response.status === 408 || response.status === 425 ||
        response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) {
        throw new Error(`Request failed: ${response.status}`);
      }

      await sleep(getRetryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' ||
        /network|fetch|timeout/i.test(error?.message || '');
      if (!retryable || attempt === retries) throw error;
      await sleep(Math.min(250 * 2 ** attempt, 2000));
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortExternal);
    }
  }

  throw lastError || new Error('Request failed');
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: { ...JSON_HEADERS, ...(options.headers || {}) },
  });
  return response.json();
}

function formatEventTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function resolveEndpointConfig(endpoints) {
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return DEFAULT_ENDPOINTS.map((url) => ({ url }));
  }

  return endpoints
    .map((entry) => (typeof entry === 'string' ? { url: entry } : entry))
    .filter((entry) => typeof entry?.url === 'string' && entry.url.trim())
    .map((entry) => ({
      url: entry.url.trim(),
      name: typeof entry.name === 'string' ? entry.name.trim() : undefined,
    }));
}

export function mapWeatherCode(code) {
  const map = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    71: 'Slight snow',
    73: 'Moderate snow',
    75: 'Heavy snow',
    80: 'Rain showers',
    81: 'Heavy rain showers',
    82: 'Violent rain showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Thunderstorm with hail',
  };
  return map[code] || 'Cloudy';
}

async function fetchEndpointStatus(endpoint, options = {}) {
  const started = Date.now();
  const response = await fetchWithTimeout(endpoint.url, options);
  const latency = Date.now() - started;

  let name = endpoint.name;
  try {
    const data = await response.clone().json();
    name ||= data?.name || data?.service?.name;
  } catch {
    // Non-JSON health endpoints are valid; use their hostname below.
  }

  if (!name) {
    const url = new URL(endpoint.url);
    name = `${url.hostname}${url.pathname !== '/' ? url.pathname : ''}`;
  }

  return {
    name,
    status: latency > 900 ? 'Degraded' : 'Stable',
    latency,
    ok: response.ok,
  };
}

export function summarizeStatus(results) {
  const safeResults = Array.isArray(results) ? results : [];
  const total = safeResults.length;

  if (!total) {
    return {
      uptime: '0.00%',
      incidents: '0 incidents',
      failures: 0,
      services: [],
      latencyAvg: 0,
    };
  }

  const successCount = safeResults.filter((result) => result.ok).length;
  const failures = total - successCount;

  return {
    uptime: `${((successCount / total) * 100).toFixed(2)}%`,
    incidents: `${failures} incidents`,
    failures,
    services: safeResults.map((result) => ({
      name: result.name,
      status: result.ok ? result.status : 'Offline',
    })),
    latencyAvg: Math.round(
      safeResults.reduce((sum, result) => sum + (Number(result.latency) || 0), 0) / total,
    ),
  };
}

function getLocation(config = {}) {
  const location = config.location || {};
  const latitude = Number(location.lat);
  const longitude = Number(location.lon);

  return {
    city: typeof location.city === 'string' ? location.city : '',
    lat: Number.isFinite(latitude) ? latitude : 37.7749,
    lon: Number.isFinite(longitude) ? longitude : -122.4194,
  };
}

export async function fetchCalendarEvents(config = {}) {
  const provider = config.provider || 'github';

  if (provider === 'google' && config.google?.apiKey && config.google?.calendarId) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.google.calendarId)}/events`,
    );
    url.searchParams.set('key', config.google.apiKey);
    url.searchParams.set('timeMin', new Date().toISOString());
    url.searchParams.set('maxResults', '5');
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');

    const data = await fetchJson(url.toString());
    return (Array.isArray(data.items) ? data.items : []).map((event) => ({
      title: event.summary || 'Untitled',
      time: formatEventTime(event.start?.dateTime || event.start?.date) || 'All day',
    }));
  }

  if (provider === 'outlook' && config.outlook?.endpoint) {
    const data = await fetchJson(config.outlook.endpoint, {
      headers: config.outlook.token
        ? { Authorization: `Bearer ${config.outlook.token}` }
        : undefined,
    });
    return (Array.isArray(data.value) ? data.value : []).slice(0, 5).map((event) => ({
      title: event.subject || 'Untitled',
      time: formatEventTime(event.start?.dateTime) || 'Scheduled',
    }));
  }

  if (provider === 'github') {
    const org = config.github?.org || 'openai';
    const items = await fetchJson(
      `https://api.github.com/orgs/${encodeURIComponent(org)}/events?per_page=5`,
    );
    return (Array.isArray(items) ? items : []).map((event) => ({
      title: `${event.type?.replace(/Event$/, '') || 'Activity'} · ${event.repo?.name || org}`,
      time: formatEventTime(event.created_at),
    }));
  }

  return [];
}

export async function fetchWeather(config = {}) {
  const provider = config.provider || 'openMeteo';

  if (provider === 'openWeather' && config.openWeather?.apiKey) {
    const { apiKey, units = 'imperial' } = config.openWeather;
    const location = getLocation(config.openWeather);
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');

    if (Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
      url.searchParams.set('lat', location.lat);
      url.searchParams.set('lon', location.lon);
    } else if (location.city) {
      url.searchParams.set('q', location.city);
    }

    url.searchParams.set('appid', apiKey);
    url.searchParams.set('units', units);

    const data = await fetchJson(url.toString());
    const temp = Number(data.main?.temp);
    const humidity = Number(data.main?.humidity);
    const wind = Number(data.wind?.speed);

    return {
      temp: Number.isFinite(temp) ? `${Math.round(temp)}°` : '—',
      conditions: `${data.weather?.[0]?.main || 'Clear'} · ${Number.isFinite(humidity) ? humidity : '—'}% humidity`,
      wind: Number.isFinite(wind)
        ? `${Math.round(wind)} ${units === 'imperial' ? 'mph' : 'm/s'}`
        : '—',
      aqi: data.main?.pressure ? String(Math.round(data.main.pressure / 10)) : '—',
      uv: data.sys?.country || '—',
    };
  }

  if (provider === 'openMeteo') {
    const source = config.openMeteo || config.openWeather || {};
    const location = getLocation(source);
    const units = source.units || 'imperial';

    const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
    weatherUrl.searchParams.set('latitude', location.lat);
    weatherUrl.searchParams.set('longitude', location.lon);
    weatherUrl.searchParams.set(
      'current',
      'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,uv_index',
    );
    weatherUrl.searchParams.set('timezone', 'auto');
    if (units === 'imperial') {
      weatherUrl.searchParams.set('temperature_unit', 'fahrenheit');
      weatherUrl.searchParams.set('wind_speed_unit', 'mph');
    }

    const weatherData = await fetchJson(weatherUrl.toString());
    const current = weatherData.current || {};

    let aqiValue = '—';
    try {
      const aqiUrl = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
      aqiUrl.searchParams.set('latitude', location.lat);
      aqiUrl.searchParams.set('longitude', location.lon);
      aqiUrl.searchParams.set('current', 'us_aqi');
      const aqiData = await fetchJson(aqiUrl.toString());
      const aqi = aqiData.current?.us_aqi;
      if (typeof aqi === 'number') aqiValue = String(aqi);
    } catch {
      // Air quality is optional; weather should still render.
    }

    const temperature = Number(current.temperature_2m);
    const humidity = Number(current.relative_humidity_2m);
    const wind = Number(current.wind_speed_10m);
    const uv = Number(current.uv_index);

    return {
      temp: Number.isFinite(temperature) ? `${Math.round(temperature)}°` : '—',
      conditions: `${mapWeatherCode(current.weather_code)} · ${Number.isFinite(humidity) ? humidity : '—'}% humidity`,
      wind: Number.isFinite(wind)
        ? `${Math.round(wind)} ${units === 'imperial' ? 'mph' : 'km/h'}`
        : '—',
      aqi: aqiValue,
      uv: Number.isFinite(uv) ? String(uv) : '—',
    };
  }

  return { temp: '—', conditions: 'Unavailable', wind: '—', aqi: '—', uv: '—' };
}

export async function fetchServerStatus(config = {}) {
  const endpoints = resolveEndpointConfig(config.endpoints);
  const results = await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        return await fetchEndpointStatus(endpoint, {
          timeoutMs: config.timeoutMs || DEFAULT_TIMEOUT,
          retries: config.retries ?? DEFAULT_RETRIES,
        });
      } catch {
        return {
          name: endpoint.name || endpoint.url,
          status: 'Offline',
          latency: config.timeoutMs || DEFAULT_TIMEOUT,
          ok: false,
        };
      }
    }),
  );

  return summarizeStatus(results);
}

export async function fetchGithubProjects(config = {}) {
  const repositories = (
    Array.isArray(config.repositories) && config.repositories.length
      ? config.repositories
      : DEFAULT_GITHUB_REPOS
  )
    .filter((repo) => repo?.owner && repo?.repo)
    .slice(0, 8);

  const headers = {
    ...JSON_HEADERS,
    ...(config.token
      ? { Authorization: `Bearer ${config.token}` }
      : {}),
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const results = await Promise.all(
    repositories.map(async (repo) => {
      const name = `${repo.owner}/${repo.repo}`;
      try {
        const data = await fetchJson(
          `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/actions/runs?per_page=1`,
          { headers, retries: config.retries ?? DEFAULT_RETRIES },
        );
        const run = data.workflow_runs?.[0];

        return {
          name,
          status: run?.conclusion
            ? run.conclusion.replaceAll('_', ' ')
            : run?.status || 'Queued',
          updatedAt: run?.updated_at || null,
        };
      } catch (error) {
        return {
          name,
          status: 'Unavailable',
          updatedAt: null,
          error: error.message,
        };
      }
    }),
  );

  return {
    summary: `${repositories.length} pipelines`,
    items: results,
    lastSync: `Last sync ${new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`,
  };
}

export async function fetchTelemetrySnapshot(config = {}) {
  const summary = await fetchServerStatus(config);
  return {
    type: 'telemetry',
    metrics: {
      availability: summary.uptime,
      latency: `${summary.latencyAvg}ms`,
      alerts: `${summary.failures} open`,
    },
    server: {
      uptime: summary.uptime,
      incidents: summary.incidents,
      services: summary.services,
    },
  };
}
