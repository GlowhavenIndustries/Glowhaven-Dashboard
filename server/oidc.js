import crypto from 'node:crypto';
import { randomToken, hashToken } from './security.js';

const pending = new Map();
const TTL = 10 * 60 * 1000;

function configured() {
  return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI);
}

async function discovery() {
  if (!configured()) throw new Error('OIDC is not configured');
  const issuer = process.env.OIDC_ISSUER.replace(/\/$/, '');
  const response = await fetch(issuer + '/.well-known/openid-configuration');
  if (!response.ok) throw new Error('OIDC discovery failed');
  return response.json();
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
  return url.toString();
}

function roleForClaims(claims) {
  const admins = new Set(String(process.env.OIDC_ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
  const adminGroups = new Set(String(process.env.OIDC_ADMIN_GROUPS || '').split(',').map((x) => x.trim()).filter(Boolean));
  return admins.has(String(claims.email || '').toLowerCase()) || groups.some((x) => adminGroups.has(x)) ? 'admin' : 'viewer';
}

export async function finishOidc(state, code, appState) {
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
  const infoResponse = await fetch(metadata.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + tokens.access_token } });
  if (!infoResponse.ok) throw new Error('OIDC userinfo request failed');
  const claims = await infoResponse.json();
  if (!claims?.sub || !claims?.email) throw new Error('OIDC identity did not contain an email');
  const email = String(claims.email).trim().toLowerCase();
  let user = appState.users.find((item) => item.email === email);
  if (!user) {
    user = { id: randomToken(16), email, role: appState.users.length ? roleForClaims(claims) : 'owner', createdAt: new Date().toISOString(), status: 'active', auth: 'oidc', externalSubject: String(claims.sub) };
    appState.users.push(user);
  }
  const token = randomToken(48);
  const csrf = randomToken(24);
  appState.sessions[hashToken(token)] = { userId: user.id, csrf, createdAt: Date.now(), expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
  return { user, token, csrf };
}