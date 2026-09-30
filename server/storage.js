import fs from 'node:fs/promises';
import path from 'node:path';

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
  await fs.writeFile(file, content, { encoding: 'utf8', mode: 0o600 });
  try { await fs.chmod(file, 0o600); } catch {}
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
    sessions: {},
    integrations: {},
  });
}

export async function saveState(state) {
  const sanitized = { ...state };
  await writeJson(FILES.state, sanitized);
}

export async function loadSecrets() {
  return readJson(FILES.secrets, {});
}

export async function saveSecrets(secrets) {
  await writeJson(FILES.secrets, secrets);
}

export async function appendAudit(entry) {
  await ensureDir();
  await fs.appendFile(FILES.audits, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
  try { await fs.chmod(FILES.audits, 0o600); } catch {}
}

export async function readAudit(limit = 200) {
  try {
    const lines = (await fs.readFile(FILES.audits, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, Math.min(Number(limit) || 200, 500))).reverse().map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export { DATA_DIR, FILES };
