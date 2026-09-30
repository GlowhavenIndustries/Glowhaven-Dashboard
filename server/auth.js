import { hashToken, randomToken, hashPassword, verifyPassword } from './security.js';

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
  return req.socket.remoteAddress || 'unknown';
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

function cleanupSessions(state) {
  const now = Date.now();
  for (const [hash, session] of Object.entries(state.sessions || {})) {
    if (!session?.expiresAt || session.expiresAt <= now) delete state.sessions[hash];
  }
}

export function sessionCookie(token, secure = false) {
  return `gh_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = false) {
  return `gh_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function parseSessionCookie(req) {
  const header = req.headers.cookie || '';
  const value = header.split(';').map((part) => part.trim()).find((part) => part.startsWith('gh_session='));
  return value ? decodeURIComponent(value.slice('gh_session='.length)) : '';
}

export function sessionUser(state, req) {
  cleanupSessions(state);
  const token = parseSessionCookie(req);
  if (!token) return null;
  const session = state.sessions[hashToken(token)];
  if (!session || session.expiresAt <= Date.now()) return null;
  return state.users.find((user) => user.id === session.userId) || null;
}

export function csrfToken(state, req) {
  const token = parseSessionCookie(req);
  const session = token ? state.sessions[hashToken(token)] : null;
  return session?.csrf || '';
}

export async function login(state, req, email, password) {
  checkRateLimit(req);
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized) || typeof password !== 'string' || !password) {
    throw new Error('Valid email and password are required');
  }

  const user = state.users.find((item) => item.email === normalized);
  if (!user || !verifyPassword(password, user.password)) {
    throw new Error('Invalid credentials');
  }

  cleanupSessions(state);
  const token = randomToken(48);
  state.sessions[hashToken(token)] = {
    userId: user.id,
    csrf: randomToken(24),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  return { user, token, csrf: state.sessions[hashToken(token)].csrf };
}

export async function logout(state, req) {
  const token = parseSessionCookie(req);
  if (token) delete state.sessions[hashToken(token)];
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
  state.sessions[hashToken(token)] = {
    userId: user.id,
    csrf: randomToken(24),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  return { user, token, csrf: state.sessions[hashToken(token)].csrf };
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

export function requirePermission(state, req, permission) {
  const user = sessionUser(state, req);
  if (!userCan(user, permission)) {
    const error = new Error('Forbidden');
    error.statusCode = user ? 403 : 401;
    throw error;
  }
  return user;
}

export function requireCsrf(state, req) {
  const token = req.headers['x-glowhaven-csrf'];
  const expected = csrfToken(state, req);
  if (!token || !expected || token !== expected) {
    const error = new Error('CSRF validation failed');
    error.statusCode = 403;
    throw error;
  }
}
