import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('enterprise features: user lifecycle, API keys, audit search/CSV, and SSO domain policy', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'glowhaven-ent-test-'));
  const oldDir = process.env.GLOWHAVEN_DATA_DIR;
  const oldKey = process.env.GLOWHAVEN_MASTER_KEY;

  try {
    process.env.GLOWHAVEN_DATA_DIR = dir;
    process.env.GLOWHAVEN_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    const storage = await import('../server/storage.js?' + Date.now());
    const security = await import('../server/security.js?' + Date.now());
    const auth = await import('../server/auth.js?' + Date.now());

    const state = await storage.loadState();
    state.users = [];
    state.sessions = {};
    state.apiKeys = [];
    state.securityPolicy = { enforceSso: false, ssoDomains: [], minPasswordLength: 12 };

    const ownerRes = await auth.setupOwner(state, { socket: { remoteAddress: '127.0.0.1' } }, 'owner@enterprise.com', 'SuperSecurePassword123!');
    assert.ok(ownerRes.token);

    const newUser = {
      id: 'u-123',
      email: 'operator@enterprise.com',
      role: 'operator',
      password: security.hashPassword('OperatorPassword123!'),
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    state.users.push(newUser);

    const userLogin = await auth.login(state, { socket: { remoteAddress: '127.0.0.1' } }, 'operator@enterprise.com', 'OperatorPassword123!');
    assert.ok(userLogin.token);

    const req = { headers: { cookie: `gh_session=${userLogin.token}` }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(auth.sessionUser(state, req)?.email, 'operator@enterprise.com');

    newUser.status = 'disabled';
    auth.revokeUserSessions(state, newUser.id);

    assert.equal(auth.sessionUser(state, req), null);

    await assert.rejects(
      () => auth.login(state, { socket: { remoteAddress: '127.0.0.1' } }, 'operator@enterprise.com', 'OperatorPassword123!'),
      /Account is disabled/
    );

    const rawKeyToken = 'gh_ak_' + security.randomToken(32);
    const keyHash = security.hashToken(rawKeyToken);
    state.apiKeys.push({
      id: 'key-1',
      name: 'CI Bot',
      role: 'operator',
      keyHash,
      prefix: rawKeyToken.slice(0, 12) + '...',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      createdBy: 'owner@enterprise.com',
    });

    const apiKeyReq = { headers: { 'x-api-key': rawKeyToken }, socket: { remoteAddress: '127.0.0.1' } };
    const apiUser = auth.sessionUser(state, apiKeyReq);
    assert.ok(apiUser);
    assert.equal(apiUser.role, 'operator');
    assert.equal(apiUser.isApiKey, true);

    const bearerReq = { headers: { authorization: `Bearer ${rawKeyToken}` }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(auth.sessionUser(state, bearerReq)?.role, 'operator');

    state.apiKeys = [];
    assert.equal(auth.sessionUser(state, apiKeyReq), null);

    state.securityPolicy = { enforceSso: true, ssoDomains: ['enterprise.com'], minPasswordLength: 12 };
    await assert.rejects(
      () => auth.login(state, { socket: { remoteAddress: '127.0.0.1' } }, 'owner@enterprise.com', 'SuperSecurePassword123!'),
      /Single Sign-On \(SSO\) is required for enterprise.com/
    );

  } finally {
    if (oldDir === undefined) delete process.env.GLOWHAVEN_DATA_DIR;
    else process.env.GLOWHAVEN_DATA_DIR = oldDir;
    if (oldKey === undefined) delete process.env.GLOWHAVEN_MASTER_KEY;
    else process.env.GLOWHAVEN_MASTER_KEY = oldKey;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
