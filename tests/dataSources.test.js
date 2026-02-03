import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fetchCalendarEvents,
  fetchWeather,
  fetchServerStatus,
  fetchGithubProjects,
  getMockTelemetry,
} from '../dataSources.js';

describe('dataSources mock responses', () => {
  it('returns mock calendar events by default', async () => {
    const events = await fetchCalendarEvents();
    assert.ok(Array.isArray(events));
    assert.equal(events.length, 3);
    assert.deepEqual(events[0], { title: 'Ops sync', time: '09:30' });
  });

  it('returns mock weather by default', async () => {
    const weather = await fetchWeather();
    assert.equal(weather.temp, '72°');
    assert.equal(weather.conditions, 'Clear · 12% humidity');
  });

  it('returns mock server status by default', async () => {
    const status = await fetchServerStatus();
    assert.equal(status.uptime, '99.98%');
    assert.equal(status.services.length, 3);
    assert.equal(status.incidents, '0 incidents');
  });

  it('returns mock GitHub pipelines by default', async () => {
    const pipelines = await fetchGithubProjects();
    assert.equal(pipelines.summary, '5 pipelines');
    assert.equal(pipelines.items.length, 4);
  });

  it('provides mock telemetry with expected metrics', () => {
    const telemetry = getMockTelemetry();
    assert.equal(telemetry.type, 'telemetry');
    assert.ok(telemetry.metrics.availability.endsWith('%'));
    assert.ok(telemetry.metrics.latency.endsWith('ms'));
    assert.ok(telemetry.metrics.alerts.endsWith('open'));
    assert.equal(telemetry.server.services.length, 3);
  });
});
