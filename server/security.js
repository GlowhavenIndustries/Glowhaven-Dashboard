import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const textEncoder = new TextEncoder();

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString('hex'), hash: derived.toString('hex') };
}

export function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const derived = crypto.scryptSync(password, Buffer.from(record.salt, 'hex'), 64);
  const expected = Buffer.from(record.hash, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function masterKey() {
  const configured = process.env.GLOWHAVEN_MASTER_KEY;
  if (!configured) throw new Error('GLOWHAVEN_MASTER_KEY is required');
  if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error('GLOWHAVEN_MASTER_KEY must be 32 bytes encoded as 64 hex characters');
  return Buffer.from(configured, 'hex');
}

export function encryptSecret(value) {
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function decryptSecret(record) {
  const key = masterKey();
  if (record?.version !== 1) throw new Error('Unsupported secret record');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(record.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function auditHash(entry, previousHash = '') {
  const payload = JSON.stringify({ ...entry, previousHash });
  return crypto.createHmac('sha256', masterKey()).update(payload).digest('hex');
}

export async function validateRemoteUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Integration endpoint must be a valid URL');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Integration endpoint must use HTTP or HTTPS');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost integration endpoints are blocked');
  }

  if (process.env.NODE_ENV === 'production' && process.env.GLOWHAVEN_ALLOW_PRIVATE_NETWORK !== '1') {
    const addresses = net.isIP(hostname)
      ? [hostname]
      : (await dns.lookup(hostname, { all: true })).map((item) => item.address);

    for (const address of addresses) {
      if (isPrivateIp(address)) throw new Error('Private network integration endpoints are blocked by default');
    }
  }

  return url.toString();
}

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 127 ||
      parts[0] === 169 && parts[1] === 254;
  }
  if (version === 6) {
    const value = address.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }
  return false;
}

export function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; connect-src 'self' https:; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}
