import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  fetchWithTimeout,
  mapWeatherCode,
  resolveEndpointConfig,
  summarizeStatus,
} from '../dataSources.js';
import {
  encryptSecret,
  decryptSecret,
  hashPassword,
  verifyPassword,
  auditHash,
  validateRemoteUrl,
} from '../server/security.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.GLOWHAVEN_MASTER_KEY;

function response(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async json() { return body; },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GLOWHAVEN_MASTER_KEY;
  else process.env.GLOWHAVEN_MASTER_KEY = originalKey;
});

describe('client data utilities', () => {
  it('normalizes endpoint configuration without undefined fields', () => {
    assert.deepEqual(resolveEndpointConfig([
      ' https://example.com ',
      { url: 'https://status.example.com', name: 'Core API' },
      { url: '' },
      null,
    ]), [
      { url: 'https://example.com' },
      { url: 'https://status.example.com', name: 'Core API' },
    ]);
  });

  it('summarizes service health deterministically', () => {
    assert.deepEqual(summarizeStatus([
      { name: 'API', ok: true, status: 'Stable', latency: 20 },
      { name: 'Worker', ok: false, status: 'Offline', latency: 120 },
    ]), {
      uptime: '50.00%',
      incidents: '1 incidents',
      failures: 1,
      services: [
        { name: 'API', status: 'Stable' },
        { name: 'Worker', status: 'Offline' },
      ],
      latencyAvg: 70,
    });
  });

  it('maps weather codes', () => {
    assert.equal(mapWeatherCode(0), 'Clear');
    assert.equal(mapWeatherCode(95), 'Thunderstorm');
    assert.equal(mapWeatherCode(999), 'Cloudy');
  });

  it('enforces request timeout', async () => {
    globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
    await assert.rejects(() => fetchWithTimeout('https://example.com', { timeoutMs: 5, retries: 0 }), /aborted/);
  });
});

describe('security primitives', () => {
  it('hashes and verifies passwords without storing plaintext', () => {
    const password = 'A-very-long-company-password-2026!';
    const record = hashPassword(password);
    assert.notEqual(record.hash, password);
    assert.ok(verifyPassword(password, record));
    assert.equal(verifyPassword('wrong-password', record), false);
  });

  it('encrypts and decrypts secrets with authenticated encryption', () => {
    process.env.GLOWHAVEN_MASTER_KEY = 'a'.repeat(64);
    const sealed = encryptSecret('company-api-token');
    assert.notEqual(sealed.ciphertext, 'company-api-token');
    assert.equal(decryptSecret(sealed), 'company-api-token');
  });

  it('creates chained audit hashes', () => {
    process.env.GLOWHAVEN_MASTER_KEY = 'b'.repeat(64);
    const one = auditHash({ id: '1', action: 'login' }, '');
    const two = auditHash({ id: '2', action: 'settings.update' }, one);
    assert.equal(one.length, 64);
    assert.equal(two.length, 64);
    assert.notEqual(one, two);
  });

  it('rejects localhost integration targets', async () => {
    await assert.rejects(() => validateRemoteUrl('http://localhost:3000'), /Localhost/);
  });
});

describe('server-backed data contract', () => {
  it('returns authenticated server data through the client wrapper contract', async () => {
    globalThis.fetch = async (url) => {
      assert.equal(url, '/api/integrations/kpi/data');
      return response({ metrics: [{ label: 'Revenue', value: '$42k', change: '+8%' }] });
    };
    const module = await import('../dataSources.js?server-contract=' + Date.now());
    const result = await module.fetchBusinessKpis();
    assert.equal(result.metrics[0].label, 'Revenue');
    assert.equal(result.metrics[0].value, '$42k');
  });
});
