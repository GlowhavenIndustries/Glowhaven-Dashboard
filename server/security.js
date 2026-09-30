import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const derived = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt: salt.toString('hex'), hash: derived.toString('hex'), version: 2 };
}

export function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  try {
    const derived = crypto.scryptSync(password, Buffer.from(record.salt, 'hex'), 64, { N: record.version === 2 ? 32768 : 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const expected = Buffer.from(record.hash, 'hex');
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export async function ensureMasterKey(dataDir) {
  if (process.env.GLOWHAVEN_MASTER_KEY) return;
  if (process.env.NODE_ENV === 'production') throw new Error('GLOWHAVEN_MASTER_KEY must be configured in production');
  const file = path.join(dataDir, 'master.key');
  try {
    process.env.GLOWHAVEN_MASTER_KEY = (await fs.readFile(file, 'utf8')).trim();
    masterKey();
    return;
  } catch {}
  const key = crypto.randomBytes(32).toString('hex');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, key + '\n', { mode: 0o600 });
  process.env.GLOWHAVEN_MASTER_KEY = key;
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
  return { version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}

export function decryptSecret(record) {
  const key = masterKey();
  if (record?.version !== 1) throw new Error('Unsupported secret record');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function auditHash(entry, previousHash = '') {
  return crypto.createHmac('sha256', masterKey()).update(JSON.stringify({ ...entry, previousHash })).digest('hex');
}

export async function validateRemoteUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Integration endpoint must be a valid URL'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Integration endpoint must use HTTP or HTTPS');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production integration endpoints must use HTTPS');
  if (url.username || url.password) throw new Error('Integration endpoint credentials in URLs are not allowed');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Local integration endpoints are blocked');
  }

  if (process.env.NODE_ENV === 'production' && process.env.GLOWHAVEN_ALLOW_PRIVATE_NETWORK !== '1') {
    await assertPublicResolution(hostname);
  }
  return url.toString();
}

async function assertPublicResolution(hostname) {
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error('Integration hostname did not resolve');
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new Error('Private network integration endpoints are blocked by default');
  }
}

export function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const p = address.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 127) || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && (p[1] === 0 || p[1] === 168)) ||
      (p[0] === 198 && p[1] >= 18 && p[1] <= 19) ||
      p[0] >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true;
    const mapped = normalized.match(/^::ffff:(\d+(?:\.\d+){3})$/);
    return Boolean(mapped && isPrivateIp(mapped[1]));
  }
  return true;
}

export async function requestJson(inputUrl, options = {}) {
  const url = new URL(await validateRemoteUrl(inputUrl));
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs || 8000), 30000));
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const body = options.body;
  const transport = url.protocol === 'https:' ? await import('node:https') : await import('node:http');

  const addresses = net.isIP(url.hostname)
    ? [{ address: url.hostname, family: net.isIP(url.hostname) }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });
  const publicAddresses = process.env.NODE_ENV === 'production' && process.env.GLOWHAVEN_ALLOW_PRIVATE_NETWORK !== '1'
    ? addresses.filter(({ address }) => !isPrivateIp(address))
    : addresses;
  if (!publicAddresses.length) throw new Error('Integration hostname did not resolve to an allowed address');
  const selected = publicAddresses[0];

  return await new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method,
      headers,
      lookup(_hostname, _options, callback) { callback(null, selected.address, selected.family); },
      ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          req.destroy(new Error('Integration response is too large'));
        } else chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(Object.assign(new Error('Integration request failed with HTTP ' + res.statusCode), { statusCode: 502 }));
        try { resolve(text ? JSON.parse(text) : {}); } catch { reject(Object.assign(new Error('Integration returned invalid JSON'), { statusCode: 502 })); }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Integration request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export function securityHeaders() {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' https://fonts.googleapis.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off',
  };
  if (process.env.NODE_ENV === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  return headers;
}
