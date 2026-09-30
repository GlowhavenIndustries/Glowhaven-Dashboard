import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.env.GLOWHAVEN_DATA_DIR || './data');
const FILES = {
  state: path.join(DATA_DIR, 'state.json'),
  secrets: path.join(DATA_DIR, 'secrets.json'),
  audits: path.join(DATA_DIR, 'audit.jsonl'),
};

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function secureWrite(file, content) {
  await ensureDir();
  const temp = file + '.' + process.pid + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
  await fs.writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  try { await fs.chmod(temp, 0o600); await fs.rename(temp, file); } catch (error) { try { await fs.rm(temp, { force: true }); } catch {} throw error; }
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(file, value) {
  await secureWrite(file, JSON.stringify(value, null, 2) + '\n');
}

export async function loadState() {
  return readJson(FILES.state, {
    version: 1,
    organization: { name: '', timezone: 'UTC' },
    users: [],
    sessions: Object.create(null),
    integrations: Object.create(null),
  });
}

export async function saveState(state) {
  const sanitized = { ...state };
  await writeJson(FILES.state, sanitized);
}

export async function loadSecrets() {
  const loaded = await readJson(FILES.secrets, Object.create(null));
  return Object.assign(Object.create(null), loaded && typeof loaded === 'object' ? loaded : {});
}

export async function saveSecrets(secrets) {
  await writeJson(FILES.secrets, secrets);
}

let auditWrite = Promise.resolve();

export async function appendAudit(entry) {
  auditWrite = auditWrite.then(async () => {
    await ensureDir();
    await fs.appendFile(FILES.audits, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { await fs.chmod(FILES.audits, 0o600); } catch {}
  });
  return auditWrite;
}

async function readAuditEntries() {
  try {
    const raw = await fs.readFile(FILES.audits, 'utf8');
    const entries = [];
    let start = 0;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{') { depth += 1; continue; }
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const chunk = raw.slice(start, index + 1).trim();
          if (chunk) entries.push(JSON.parse(chunk));
          if (raw[index + 1] === '\\n') index += 1;
          start = index + 1;
        }
      }
    }
    if (depth !== 0 || raw.slice(start).trim()) throw new Error('Audit log contains an incomplete record');
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readLastAuditHash() {
  const entries = await readAuditEntries();
  return entries.length ? String(entries[entries.length - 1].hash || '') : '';
}

export async function verifyAuditChain(auditHashFn) {
  try {
    const entries = await readAuditEntries();
    let previousHash = '';
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry.previousHash !== previousHash) return { valid: false, count: entries.length, index, reason: 'previousHash mismatch' };
      if (entry.hash !== auditHashFn(entry, previousHash)) return { valid: false, count: entries.length, index, reason: 'hash mismatch' };
      previousHash = entry.hash;
    }
    return { valid: true, count: entries.length, lastHash: previousHash };
  } catch (error) {
    return { valid: false, count: 0, reason: 'Audit log could not be parsed' };
  }
}


export async function readAudit(limit = 200) {
  const entries = await readAuditEntries();
  return entries.slice(-Math.max(1, Math.min(Number(limit) || 200, 500))).reverse();
}

export { DATA_DIR, FILES };
