import net from 'node:net';
import tls from 'node:tls';
import { URL } from 'node:url';

export class MemorySessionStore {
  constructor(state = null) {
    this.state = state;
    this.fallbackMap = new Map();
  }

  _getSessionsObject() {
    if (this.state) {
      if (!this.state.sessions || typeof this.state.sessions !== 'object') {
        this.state.sessions = Object.create(null);
      }
      return this.state.sessions;
    }
    return null;
  }

  get(hash) {
    const obj = this._getSessionsObject();
    if (obj) return obj[hash] || null;
    return this.fallbackMap.get(hash) || null;
  }

  set(hash, session) {
    const obj = this._getSessionsObject();
    if (obj) {
      obj[hash] = session;
    } else {
      this.fallbackMap.set(hash, session);
    }
  }

  delete(hash) {
    const obj = this._getSessionsObject();
    if (obj) {
      delete obj[hash];
    } else {
      this.fallbackMap.delete(hash);
    }
  }

  revokeUserSessions(userId) {
    const obj = this._getSessionsObject();
    if (obj) {
      for (const [hash, session] of Object.entries(obj)) {
        if (session?.userId === userId) delete obj[hash];
      }
    } else {
      for (const [hash, session] of this.fallbackMap.entries()) {
        if (session?.userId === userId) this.fallbackMap.delete(hash);
      }
    }
  }

  cleanup() {
    const now = Date.now();
    const obj = this._getSessionsObject();
    if (obj) {
      for (const [hash, session] of Object.entries(obj)) {
        if (!session?.expiresAt || session.expiresAt <= now) delete obj[hash];
      }
    } else {
      for (const [hash, session] of this.fallbackMap.entries()) {
        if (!session?.expiresAt || session.expiresAt <= now) this.fallbackMap.delete(hash);
      }
    }
  }
}

function parseResp(buffer) {
  if (!buffer || buffer.length === 0) return null;
  const str = buffer.toString('utf8');
  const type = str[0];
  if (type === '+') {
    const line = str.slice(1, str.indexOf('\r\n'));
    return { value: line, readBytes: str.indexOf('\r\n') + 2 };
  }
  if (type === ':') {
    const line = str.slice(1, str.indexOf('\r\n'));
    return { value: Number(line), readBytes: str.indexOf('\r\n') + 2 };
  }
  if (type === '$') {
    const firstEol = str.indexOf('\r\n');
    const len = Number(str.slice(1, firstEol));
    if (len === -1) return { value: null, readBytes: firstEol + 2 };
    const val = str.slice(firstEol + 2, firstEol + 2 + len);
    return { value: val, readBytes: firstEol + 2 + len + 2 };
  }
  if (type === '-') {
    const line = str.slice(1, str.indexOf('\r\n'));
    throw new Error('Redis Error: ' + line);
  }
  return null;
}

export class RedisSessionStore {
  constructor(redisUrl) {
    this.url = new URL(redisUrl);
    this.prefix = 'gh_sess:';
    this.ttlSeconds = 8 * 60 * 60;
  }

  async _sendCommand(cmdArgs) {
    return new Promise((resolve, reject) => {
      const isTls = this.url.protocol === 'rediss:';
      const port = Number(this.url.port || 6379);
      const host = this.url.hostname || 'localhost';

      const socket = isTls
        ? tls.connect({ host, port, rejectUnauthorized: process.env.NODE_ENV === 'production' })
        : net.connect({ host, port });

      let responseBuffer = Buffer.alloc(0);

      socket.setTimeout(3000, () => {
        socket.destroy();
        reject(new Error('Redis connection timeout'));
      });

      socket.on('connect', () => {
        if (this.url.password) {
          const authArgs = this.url.username ? ['AUTH', this.url.username, this.url.password] : ['AUTH', this.url.password];
          let authPayload = `*${authArgs.length}\r\n`;
          for (const arg of authArgs) authPayload += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
          socket.write(authPayload);
        }

        let payload = `*${cmdArgs.length}\r\n`;
        for (const arg of cmdArgs) payload += `$${Buffer.byteLength(String(arg))}\r\n${String(arg)}\r\n`;
        socket.write(payload);
      });

      socket.on('data', (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        try {
          const parsed = parseResp(responseBuffer);
          if (parsed !== null) {
            socket.end();
            resolve(parsed.value);
          }
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });

      socket.on('error', (err) => reject(err));
    });
  }

  async get(hash) {
    try {
      const val = await this._sendCommand(['GET', this.prefix + hash]);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  }

  async set(hash, session) {
    try {
      const json = JSON.stringify(session);
      await this._sendCommand(['SETEX', this.prefix + hash, String(this.ttlSeconds), json]);
    } catch {}
  }

  async delete(hash) {
    try {
      await this._sendCommand(['DEL', this.prefix + hash]);
    } catch {}
  }

  async revokeUserSessions(userId) {
    try {
      const keysStr = await this._sendCommand(['KEYS', this.prefix + '*']);
      if (!Array.isArray(keysStr)) return;
      for (const key of keysStr) {
        const hash = key.slice(this.prefix.length);
        const session = await this.get(hash);
        if (session?.userId === userId) {
          await this.delete(hash);
        }
      }
    } catch {}
  }

  async cleanup() {
    // Redis handles expiration via SETEX automatically.
  }
}

export function createSessionStore(state = null, options = {}) {
  const redisUrl = options.redisUrl || process.env.REDIS_URL || (process.env.GLOWHAVEN_SESSION_STORE === 'redis' ? process.env.REDIS_URL || 'redis://localhost:6379' : null);
  if (redisUrl) {
    return new RedisSessionStore(redisUrl);
  }
  return new MemorySessionStore(state);
}

export function getSessionStore(state) {
  if (state && state.sessionStore) return state.sessionStore;
  const store = createSessionStore(state);
  if (state) state.sessionStore = store;
  return store;
}
