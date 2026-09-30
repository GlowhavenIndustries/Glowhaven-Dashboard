import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('audit log writes newline-delimited records and verifies its hash chain', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glowhaven-audit-'));
  const oldDir = process.env.GLOWHAVEN_DATA_DIR;
  const oldKey = process.env.GLOWHAVEN_MASTER_KEY;
  try {
    process.env.GLOWHAVEN_DATA_DIR = dir;
    process.env.GLOWHAVEN_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const storage = await import('../server/storage.js?' + Date.now());
    const security = await import('../server/security.js?' + Date.now());
    const entry = { id: '1', timestamp: new Date().toISOString(), actorId: 'u', actorEmail: 'u@example.com', action: 'test', details: {}, previousHash: '' };
    entry.hash = security.auditHash(entry, '');
    await storage.appendAudit(entry);
    const result = await storage.verifyAuditChain(security.auditHash);
    assert.equal(result.valid, true);
    assert.equal((await storage.readAudit(10)).length, 1);
  } finally {
    if (oldDir === undefined) delete process.env.GLOWHAVEN_DATA_DIR;
    else process.env.GLOWHAVEN_DATA_DIR = oldDir;
    if (oldKey === undefined) delete process.env.GLOWHAVEN_MASTER_KEY;
    else process.env.GLOWHAVEN_MASTER_KEY = oldKey;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
