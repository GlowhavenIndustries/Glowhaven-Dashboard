import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  executeAutomation,
  fetchActivity,
  fetchAutomations,
  fetchBusinessKpis,
  fetchCalendarEvents,
  fetchGithubProjects,
  fetchServerStatus,
  fetchTelemetrySnapshot,
  fetchWeather,
  mapWeatherCode,
  resolveEndpointConfig,
  summarizeStatus,
} from '../dataSources.js';

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = handler;
}

function response(body, options = {}) {
  const payload = JSON.stringify(body);
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: new Headers(options.headers),
    clone() {
      return this;
    },
    async json() {
      return JSON.parse(payload);
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('data source utilities', () => {
  it('filters invalid endpoints and preserves names', () => {
    assert.deepEqual(resolveEndpointConfig([
      'https://example.com',
      { url: ' https://status.example.com ', name: 'Core API' },
      { url: '' },
      null,
    ]), [
      { url: 'https://example.com' },
      { url: 'https://status.example.com', name: 'Core API' },
    ]);
  });

  it('summarizes healthy and failed services deterministically', () => {
    assert.deepEqual(summarizeStatus([
      { name: 'A', ok: true, status: 'Stable', latency: 20 },
      { name: 'B', ok: false, status: 'Offline', latency: 8000 },
    ]), {
      uptime: '50.00%',
      incidents: '1 incidents',
      failures: 1,
      services: [
        { name: 'A', status: 'Stable' },
        { name: 'B', status: 'Offline' },
      ],
      latencyAvg: 4010,
    });
  });

  it('maps extended weather codes', () => {
    assert.equal(mapWeatherCode(0), 'Clear');
    assert.equal(mapWeatherCode(96), 'Thunderstorm with hail');
    assert.equal(mapWeatherCode(999), 'Cloudy');
  });
});

describe('data source providers', () => {
  it('fetches and normalizes GitHub calendar activity', async () => {
    mockFetch(async () => response([
      { type: 'PushEvent', repo: { name: 'GlowhavenIndustries/demo' }, created_at: '2026-09-30T10:00:00Z' },
    ]));

    const events = await fetchCalendarEvents({
      provider: 'github',
      github: { org: 'GlowhavenIndustries' },
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].title, 'Push · GlowhavenIndustries/demo');
    assert.ok(events[0].time);
  });

  it('keeps weather usable when optional AQI fails', async () => {
    let calls = 0;
    mockFetch(async (url) => {
      calls += 1;
      if (String(url).includes('air-quality')) {
        throw new Error('AQI offline');
      }
      return response({
        current: {
          temperature_2m: 72,
          relative_humidity_2m: 44,
          wind_speed_10m: 8,
          weather_code: 2,
          uv_index: 5,
        },
      });
    });

    const weather = await fetchWeather({
      provider: 'openMeteo',
      openMeteo: { units: 'imperial', location: { lat: 32.77, lon: -96.79 } },
    });

    assert.equal(weather.temp, '72°');
    assert.match(weather.conditions, /Partly cloudy/);
    assert.equal(weather.aqi, 'N/A');
    assert.equal(calls, 2);
  });

  it('isolates GitHub repository failures', async () => {
    mockFetch(async (url) => {
      if (String(url).includes('bad/repo')) {
        throw new Error('network failure');
      }
      return response({ workflow_runs: [{ conclusion: 'success', updated_at: '2026-09-30T10:00:00Z' }] });
    });

    const projects = await fetchGithubProjects({
      repositories: [
        { owner: 'good', repo: 'repo' },
        { owner: 'bad', repo: 'repo' },
      ],
      retries: 0,
    });

    assert.equal(projects.items[0].status, 'success');
    assert.equal(projects.items[1].status, 'Unavailable');
  });

  it('returns telemetry from server health results', async () => {
    mockFetch(async (url) => {
      if (String(url).includes('offline')) throw new Error('offline');
      return response({ name: 'Core API' });
    });

    const telemetry = await fetchTelemetrySnapshot({
      endpoints: [
        { url: 'https://online.example.com/health', name: 'Core API' },
        { url: 'https://offline.example.com/health', name: 'Offline API' },
      ],
      retries: 0,
    });

    assert.equal(telemetry.type, 'telemetry');
    assert.equal(telemetry.metrics.availability, '50.00%');
    assert.equal(telemetry.metrics.alerts, '1 open');
    assert.equal(telemetry.server.services[1].status, 'Offline');
  });

  it('fetches Open-Meteo weather without a network dependency in tests', async () => {
    mockFetch(async () => response({
      current: {
        temperature_2m: 65,
        relative_humidity_2m: 50,
        wind_speed_10m: 6,
        weather_code: 0,
        uv_index: 2,
      },
    }));

    const weather = await fetchWeather({
      provider: 'openMeteo',
      openMeteo: { units: 'imperial', location: { lat: 40, lon: -75 } },
    });

    assert.equal(weather.temp, '65°');
    assert.equal(weather.conditions, 'Clear · 50% humidity');
  });
});

describe('company adapter fallbacks', () => {
  it('does not invent a service when none are configured', async () => {
    const health = await fetchServerStatus({ endpoints: [] });
    assert.equal(health.uptime, 'Not configured');
    assert.equal(health.services.length, 0);
  });

  it('uses configured KPI metrics without an endpoint', async () => {
    const kpis = await fetchBusinessKpis({
      metrics: [{ label: 'Revenue', value: '$42k', change: '+8%' }],
    });
    assert.equal(kpis.metrics[0].label, 'Revenue');
    assert.equal(kpis.metrics[0].value, '$42k');
    assert.equal(kpis.metrics[0].change, '+8%');
  });

  it('returns configured incidents and automations', async () => {
    const incidents = await fetchIncidents({
      incidents: [{ id: '1', title: 'API latency', severity: 'high', status: 'open' }],
    });
    const automations = await fetchAutomations({
      automations: [{ id: '2', name: 'Restart worker', status: 'ready' }],
    });
    assert.equal(incidents.incidents[0].title, 'API latency');
    assert.equal(automations.automations[0].name, 'Restart worker');
  });

  it('does not use default repositories for a new company', async () => {
    const projects = await fetchGithubProjects({ repositories: [] });
    assert.equal(projects.summary, 'Not configured');
    assert.equal(projects.items.length, 0);
  });

  it('executes an automation through the configured endpoint', async () => {
    mockFetch(async (url, options) => {
      assert.equal(String(url), 'https://company.example/automation');
      assert.equal(options.method, 'POST');
      return response({ accepted: true });
    });
    const result = await executeAutomation(
      { endpoint: 'https://company.example/automation', retries: 0 },
      { id: 'job-1', name: 'Restart worker' },
    );
    assert.equal(result.accepted, true);
  });
});
