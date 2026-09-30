import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeIncidentAction } from '../dataSources.js';

test('dashboard features: executeIncidentAction triggers network request with CSRF header', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({ ok: true, incidentId: 'inc-404', action: 'acknowledge' }),
    };
  };

  globalThis.__glowhavenCsrf = 'test-csrf-token-123';
  const result = await executeIncidentAction('inc-404', 'acknowledge');

  assert.equal(capturedUrl, '/api/incidents/action');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['X-Glowhaven-CSRF'], 'test-csrf-token-123');
  assert.equal(JSON.parse(capturedOptions.body).id, 'inc-404');
  assert.equal(result.ok, true);
});

test('dashboard features: verifyAuditChain detects corrupted entries in audit log', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glowhaven-audit-corrupt-'));
  const oldDir = process.env.GLOWHAVEN_DATA_DIR;
  const oldKey = process.env.GLOWHAVEN_MASTER_KEY;
  try {
    process.env.GLOWHAVEN_DATA_DIR = dir;
    process.env.GLOWHAVEN_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const storage = await import('../server/storage.js?' + Date.now());
    const security = await import('../server/security.js?' + Date.now());

    const entry1 = { id: '1', timestamp: new Date().toISOString(), actorId: 'u1', actorEmail: 'u1@example.com', action: 'login', details: {}, previousHash: '' };
    entry1.hash = security.auditHash(entry1, '');
    await storage.appendAudit(entry1);

    const entry2 = { id: '2', timestamp: new Date().toISOString(), actorId: 'u2', actorEmail: 'u2@example.com', action: 'tampered', details: {}, previousHash: entry1.hash };
    entry2.hash = 'fake-invalid-hash';
    await storage.appendAudit(entry2);

    const verification = await storage.verifyAuditChain(security.auditHash);
    assert.equal(verification.valid, false);
    assert.equal(verification.reason, 'hash mismatch');
  } finally {
    if (oldDir === undefined) delete process.env.GLOWHAVEN_DATA_DIR;
    else process.env.GLOWHAVEN_DATA_DIR = oldDir;
    if (oldKey === undefined) delete process.env.GLOWHAVEN_MASTER_KEY;
    else process.env.GLOWHAVEN_MASTER_KEY = oldKey;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
