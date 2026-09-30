import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, isPrivateIp, validateRemoteUrl } from '../server/security.js';

test('password hashes verify and reject wrong passwords', () => {
  const record = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', record), true);
  assert.equal(verifyPassword('wrong password', record), false);
});

test('private IPv4 and IPv6 ranges are blocked', () => {
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(address), true, address);
  }
  assert.equal(isPrivateIp('8.8.8.8'), false);
});

test('production remote URL validation blocks private targets and URL credentials', async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldAllow = process.env.GLOWHAVEN_ALLOW_PRIVATE_NETWORK;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.GLOWHAVEN_ALLOW_PRIVATE_NETWORK;
    await assert.rejects(() => validateRemoteUrl('https://127.0.0.1/internal'), /Private network/);
    await assert.rejects(() => validateRemoteUrl('https://user:pass@example.com/'), /credentials/);
    await assert.rejects(() => validateRemoteUrl('https://example.com/?token=secret'), /credentials/);
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
    if (oldAllow === undefined) delete process.env.GLOWHAVEN_ALLOW_PRIVATE_NETWORK;
    else process.env.GLOWHAVEN_ALLOW_PRIVATE_NETWORK = oldAllow;
  }
});


test('security headers include browser isolation controls', async () => {
  const { securityHeaders } = await import('../server/security.js');
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const headers = securityHeaders();
    assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.match(headers['Strict-Transport-Security'], /includeSubDomains/);
  } finally {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  }
});
