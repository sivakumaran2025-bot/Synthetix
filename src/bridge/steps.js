// The steps file is the source of truth: plain JSON that a human can read and a diff can patch.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/env.js';

export const STRATEGIES = ['role', 'label', 'placeholder', 'text', 'testid', 'css'];

export function newDoc({ name, start, baseUrl, viewport = config.viewport }) {
  return { version: 1, name, baseUrl, start, viewport, createdAt: new Date().toISOString(), steps: [] };
}

export function validateDoc(doc) {
  const fail = (m) => { throw new Error(`Invalid steps file: ${m}`); };
  if (!doc || typeof doc !== 'object') fail('not an object');
  if (doc.version !== 1) fail(`version must be 1, got ${JSON.stringify(doc.version)}`);
  if (typeof doc.start !== 'string' || !doc.start.startsWith('/')) fail('"start" must be a path such as "/index.html"');
  if (!Array.isArray(doc.steps)) fail('"steps" must be a list');
  doc.steps.forEach((s, i) => {
    const at = `step ${i + 1}`;
    if (typeof s.intent !== 'string' || !s.intent) fail(`${at} has no "intent"`);
    if (!['click', 'fill'].includes(s.action)) fail(`${at} has unknown action ${JSON.stringify(s.action)}`);
    if (!s.locator || !STRATEGIES.includes(s.locator.strategy)) fail(`${at} has an unknown locator strategy`);
    if (typeof s.code !== 'string') fail(`${at} has no "code"`);
    if (s.action === 'fill' && (typeof s.text !== 'string' || s.text === '')) fail(`${at} is "fill" but has no "text"`);
  });
  return doc;
}

export function saveDoc(file, doc) {
  validateDoc(doc);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

export function loadDoc(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { throw new Error(`Cannot read steps file: ${file}`); }
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new Error(`Steps file is not valid JSON: ${file}`); }
  return validateDoc(doc);
}
