// Single place where environment variables are read and validated.
// Every other module imports `config` from here and never touches process.env.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer, got "${raw}"`);
  return n;
}
function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
}
function str(name, fallback = '') {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

// Older .env files said "muse-spark", which is not a real model id. Map it to the current one.
function museModel(name) {
  return name === 'muse-spark' ? 'muse-spark-1.2' : name;
}

export const config = {
  root: ROOT,
  shopDir: path.join(ROOT, 'mock-shop'),
  artifactsDir: path.join(ROOT, 'artifacts'),
  port: int('MOCK_SHOP_PORT', 4173),
  viewport: { width: int('VIEWPORT_WIDTH', 1280), height: int('VIEWPORT_HEIGHT', 800) },
  headless: bool('HEADLESS', true),
  browserChannel: str('BROWSER_CHANNEL', ''),
  discoveryMode: str('DISCOVERY_MODE', 'auto'),
  sam: {
    url: str('SAM_API_URL', 'https://api.meta.ai/v1/responses'),
    key: str('SAM_API_KEY', str('MODEL_API_KEY')),
    model: str('SAM_MODEL', 'sam-3.1'),
    timeoutMs: int('SAM_TIMEOUT_MS', 90000),
    retries: int('SAM_RETRIES', 2),
    // SAM 3.1 accepts ONE noun phrase per request, so each concept is its own request.
    concepts: str('SAM_CONCEPTS', 'button,input field').split(',').map((c) => c.trim()).filter(Boolean),
  },
  muse: {
    url: str('MUSE_API_URL', 'https://api.meta.ai/v1/responses'), key: str('MUSE_API_KEY', str('MODEL_API_KEY')), model: museModel(str('MUSE_MODEL', 'muse-spark-1.2')),
    timeoutMs: int('MUSE_TIMEOUT_MS', 150000),
    retries: int('MUSE_RETRIES', 2),
    reasoningEffort: str('MUSE_REASONING_EFFORT'), // optional: low | medium | high (blank = server default)
  },
};
config.baseUrl = `http://127.0.0.1:${config.port}`;
