import crypto from 'node:crypto';
import { randomToken, hashToken } from './security.js';

const pending = new Map();
const TTL = 10 * 60 * 1000;

function issuerUrl() {
  let url;
  try { url = new URL(process.env.OIDC_ISSUER); } catch { throw new Error('OIDC issuer must be a valid URL'); }
  if (url.protocol !== 'https:') throw new Error('OIDC issuer must use HTTPS');
  return url.toString().replace(/\/$/, '');
}

function configured() {
  return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI);
}

async function discovery() {
  if (!configured()) throw new Error('OIDC is not configured');
  const issuer = issuerUrl();
  const response = await fetch(issuer + '/.well-known/openid-configuration', { redirect: 'error' });
  if (!response.ok) throw new Error('OIDC discovery failed');
  const metadata = await response.json();
  if (metadata.issuer !== issuer || typeof metadata.authorization_endpoint !== 'string' || typeof metadata.token_endpoint !== 'string' || typeof metadata.userinfo_endpoint !== 'string' || typeof metadata.jwks_uri !== 'string') {
    throw new Error('OIDC discovery metadata failed validation');
  }
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.userinfo_endpoint, metadata.jwks_uri]) {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') throw new Error('OIDC endpoints must use HTTPS');
  }
  return metadata;
}

async function verifyIdToken(idToken, metadata, expectedNonce) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('OIDC provider returned an invalid ID token');
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('OIDC ID token is not valid JWT');
  }
  const supported = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512', PS256: 'RSA-SHA256', PS384: 'RSA-SHA384', PS512: 'RSA-SHA512', ES256: 'SHA256', ES384: 'SHA384', ES512: 'SHA512' };
  if (!supported[header.alg] || !header.kid) throw new Error('OIDC ID token uses an unsupported signing algorithm');
  const jwksResponse = await fetch(metadata.jwks_uri, { redirect: 'error', headers: { Accept: 'application/json' } });
  if (!jwksResponse.ok) throw new Error('OIDC JWKS request failed');
  const jwks = await jwksResponse.json();
  const jwk = Array.isArray(jwks.keys) ? jwks.keys.find((key) => key.kid === header.kid) : null;
  if (!jwk) throw new Error('OIDC signing key not found');
  let publicKey;
  try { publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw new Error('OIDC signing key is invalid'); }
  const verifier = crypto.createVerify(supported[header.alg]);
  verifier.update(parts[0] + '.' + parts[1]);
  verifier.end();
  const valid = verifier.verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'));
  if (!valid) throw new Error('OIDC ID token signature validation failed');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuerUrl() || !audience.includes(process.env.OIDC_CLIENT_ID) || claims.nonce !== expectedNonce || claims.email_verified !== true || !claims.exp || Number(claims.exp) <= Math.floor(Date.now() / 1000)) {
    throw new Error('OIDC ID token claims failed validation');
  }
  if (audience.length > 1 && claims.azp !== process.env.OIDC_CLIENT_ID) throw new Error('OIDC ID token authorized party validation failed');
  return claims;
}

export function isOidcConfigured() { return configured(); }

export async function startOidc() {
  const metadata = await discovery();
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pending.set(hashToken(state), { nonce, verifier, expiresAt: Date.now() + TTL });
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.OIDC_CLIENT_ID);
  url.searchParams.set('redirect_uri', process.env.OIDC_REDIRECT_URI);
  url.searchParams.set('scope', process.env.OIDC_SCOPE || 'openid profile email');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString(), state };
}

function roleForClaims(claims) {
  const admins = new Set(String(process.env.OIDC_ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
  const adminGroups = new Set(String(process.env.OIDC_ADMIN_GROUPS || '').split(',').map((x) => x.trim()).filter(Boolean));
  return admins.has(String(claims.email || '').toLowerCase()) || groups.some((x) => adminGroups.has(x)) ? 'admin' : 'viewer';
}

export async function finishOidc(state, code, appState, expectedState = '') {
  if (!state || !expectedState || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) throw new Error('OIDC state validation failed');
  const record = pending.get(hashToken(state));
  pending.delete(hashToken(state));
  if (!record || record.expiresAt <= Date.now()) throw new Error('OIDC state expired');
  const metadata = await discovery();
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: process.env.OIDC_CLIENT_ID, client_secret: process.env.OIDC_CLIENT_SECRET,
      redirect_uri: process.env.OIDC_REDIRECT_URI, code, code_verifier: record.verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error('OIDC token exchange failed');
  const tokens = await tokenResponse.json();
  if (!tokens.access_token) throw new Error('OIDC provider did not return an access token');
  if (!tokens.id_token) throw new Error('OIDC provider did not return an ID token');
  await verifyIdToken(tokens.id_token, metadata, record.nonce);
  const infoResponse = await fetch(metadata.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + tokens.access_token } });
  if (!infoResponse.ok) throw new Error('OIDC userinfo request failed');
  const claims = await infoResponse.json();
  if (!claims?.sub || !claims?.email) throw new Error('OIDC identity did not contain an email');
  const email = String(claims.email).trim().toLowerCase();
  let user = appState.users.find((item) => item.email === email);
  if (user?.auth === 'oidc' && user.externalSubject && user.externalSubject !== String(claims.sub)) throw new Error('OIDC subject does not match the existing account');
  if (!user) {
    user = { id: randomToken(16), email, role: appState.users.length ? roleForClaims(claims) : 'owner', createdAt: new Date().toISOString(), status: 'active', auth: 'oidc', externalSubject: String(claims.sub) };
    appState.users.push(user);
  }
  const token = randomToken(48);
  const csrf = randomToken(24);
  appState.sessions[hashToken(token)] = { userId: user.id, csrf, createdAt: Date.now(), expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  return { user, token, csrf };
}