import { hashToken, randomToken, hashPassword, verifyPassword, verifyApiKey } from './security.js';
import { getSessionStore } from './sessionStore.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT = 10;

const attempts = new Map();
const MAX_RATE_KEYS = 10000;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clientKey(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(req) {
  const key = clientKey(req);
  const now = Date.now();
  if (attempts.size >= MAX_RATE_KEYS && !attempts.has(key)) {
    for (const [candidate, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(candidate);
    }
    if (attempts.size >= MAX_RATE_KEYS) throw new Error('Authentication service is busy');
  }
  const current = attempts.get(key) || { count: 0, resetAt: now + AUTH_RATE_WINDOW_MS };
  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + AUTH_RATE_WINDOW_MS;
  }
  current.count += 1;
  attempts.set(key, current);
  if (current.count > AUTH_RATE_LIMIT) {
    const error = new Error('Too many authentication attempts');
    error.statusCode = 429;
    throw error;
  }
}

export async function cleanupSessions(state) {
  const store = getSessionStore(state);
  await store.cleanup();
}

export function sessionCookie(token, secure = false) {
  return `gh_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = false) {
  return `gh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function parseSessionCookie(req) {
  const header = req.headers?.cookie || '';
  const value = header.split(';').map((part) => part.trim()).find((part) => part.startsWith('gh_session='));
  return value ? decodeURIComponent(value.slice('gh_session='.length)) : '';
}

export async function revokeUserSessions(state, userId) {
  const store = getSessionStore(state);
  await store.revokeUserSessions(userId);
}

export function parseApiKey(req) {
  const headerKey = req.headers?.['x-api-key'];
  if (headerKey) return String(headerKey).trim();
  const authHeader = req.headers?.authorization || '';
  if (authHeader.startsWith('Bearer gh_ak_')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return '';
}

export function sessionUser(state, req) {
  const apiKeyToken = parseApiKey(req);
  if (apiKeyToken && Array.isArray(state.apiKeys)) {
    const apiKey = state.apiKeys.find((k) => verifyApiKey(apiKeyToken, k));
    if (apiKey) {
      apiKey.lastUsedAt = new Date().toISOString();
      return {
        id: 'apikey:' + apiKey.id,
        email: 'apikey:' + apiKey.name,
        role: apiKey.role,
        status: 'active',
        isApiKey: true,
        apiKeyId: apiKey.id,
      };
    }
  }

  const token = parseSessionCookie(req);
  if (!token) return null;

  const store = getSessionStore(state);
  const tokenHash = hashToken(token);
  const res = store.get(tokenHash);

  if (res && typeof res.then === 'function') {
    return res.then((session) => {
      if (!session || session.expiresAt <= Date.now()) return null;
      const user = state.users.find((u) => u.id === session.userId) || null;
      if (!user || user.status === 'disabled') return null;
      return user;
    });
  }

  const session = res;
  if (!session || session.expiresAt <= Date.now()) return null;
  const user = state.users.find((u) => u.id === session.userId) || null;
  if (!user || user.status === 'disabled') return null;
  return user;
}

export function csrfToken(state, req) {
  const token = parseSessionCookie(req);
  if (!token) return '';
  const store = getSessionStore(state);
  const tokenHash = hashToken(token);
  const res = store.get(tokenHash);
  if (res && typeof res.then === 'function') {
    return res.then((session) => session?.csrf || '');
  }
  return res?.csrf || '';
}

export async function login(state, req, email, password) {
  checkRateLimit(req);
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized) || typeof password !== 'string' || !password) {
    throw new Error('Valid email and password are required');
  }

  const policy = state.securityPolicy || {};
  if (policy.enforceSso && Array.isArray(policy.ssoDomains) && policy.ssoDomains.length > 0) {
    const domain = normalized.split('@')[1];
    if (policy.ssoDomains.some((d) => d.toLowerCase() === domain)) {
      throw new Error('Single Sign-On (SSO) is required for ' + domain + '. Please sign in with company SSO.');
    }
  }

  const user = state.users.find((item) => item.email === normalized);
  if (!user || !verifyPassword(password, user.password)) {
    throw new Error('Invalid credentials');
  }

  if (user.status === 'disabled') {
    throw new Error('Account is disabled');
  }

  const store = getSessionStore(state);
  await store.cleanup();
  const token = randomToken(48);
  const session = {
    userId: user.id,
    csrf: randomToken(24),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await store.set(hashToken(token), session);

  return { user, token, csrf: session.csrf };
}

export async function logout(state, req) {
  const token = parseSessionCookie(req);
  if (token) {
    const store = getSessionStore(state);
    await store.delete(hashToken(token));
  }
}

export async function setupOwner(state, req, email, password) {
  checkRateLimit(req);
  if (state.users.length) throw new Error('Initial setup is already complete');

  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) throw new Error('A valid admin email is required');
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('The initial admin password must be at least 12 characters');
  }

  const user = {
    id: randomToken(16),
    email: normalized,
    role: 'owner',
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  state.users.push(user);
  const token = randomToken(48);
  const store = getSessionStore(state);
  const session = {
    userId: user.id,
    csrf: randomToken(24),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await store.set(hashToken(token), session);

  return { user, token, csrf: session.csrf };
}

export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    status: user.status,
  };
}

export function userCan(user, permission) {
  if (!user || user.status !== 'active') return false;
  const matrix = {
    view: ['owner', 'admin', 'operator', 'viewer'],
    operate: ['owner', 'admin', 'operator'],
    manage: ['owner', 'admin'],
    audit: ['owner', 'admin'],
    users: ['owner', 'admin'],
  };
  return matrix[permission]?.includes(user.role) || false;
}

export async function requirePermission(state, req, permission) {
  const user = await sessionUser(state, req);
  if (!userCan(user, permission)) {
    const error = new Error('Forbidden');
    error.statusCode = user ? 403 : 401;
    throw error;
  }
  return user;
}

export async function requireCsrf(state, req) {
  const user = await sessionUser(state, req);
  if (user?.isApiKey) return;
  const token = req.headers?.['x-glowhaven-csrf'];
  const expected = await csrfToken(state, req);
  if (!token || !expected || token !== expected) {
    const error = new Error('CSRF validation failed');
    error.statusCode = 403;
    throw error;
  }
}
