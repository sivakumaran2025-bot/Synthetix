// Talks to SAM 3.1 on Meta Model API (official docs: https://dev.meta.ai/docs/sam/segmenting).
//   POST https://api.meta.ai/v1/responses      Authorization: Bearer <key>
//   body: model "sam-3.1", input_text = ONE noun phrase, input_image = data URL, stream = true
//   reply: server-sent events; text deltas add up to a line like
//     <0f>0<|box;x1=181;y1=365;x2=556;y2=486;w=1280;h=800|><|mask;...|>,1<|box;...|><|mask;...|>
// We only need the boxes, so masks are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/env.js';
import { transient, withRetry, TRANSIENT_STATUSES } from '../net/retry.js';

// ---- 1. read the special-token text ------------------------------------------------------
export function parseSamText(text, viewport = config.viewport, label) {
  const boxes = [];
  const re = /(\d+)<\|box;([^|]*)\|>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const f = {};
    for (const pair of m[2].split(';')) {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) f[k.trim()] = Number(v);
    }
    if (!['x1', 'y1', 'x2', 'y2'].every((k) => Number.isFinite(f[k]))) continue;
    // The reply states the image size it used (w,h). Scale if it differs from our viewport.
    const sx = Number.isFinite(f.w) && f.w > 0 ? viewport.width / f.w : 1;
    const sy = Number.isFinite(f.h) && f.h > 0 ? viewport.height / f.h : 1;
    boxes.push({
      objectId: Number(m[1]),
      x: f.x1 * sx,
      y: f.y1 * sy,
      w: (f.x2 - f.x1 + 1) * sx, // x2/y2 are INCLUSIVE in Meta's format
      h: (f.y2 - f.y1 + 1) * sy,
      score: Number.isFinite(f.c) ? f.c : 1,
      label,
    });
  }
  return boxes;
}

// ---- 2. one request = one concept -------------------------------------------------------
function explainHttpError(status, body) {
  const snippet = body.slice(0, 300);
  let hint = '';
  if (status === 401) hint = ' -> the API key is wrong or missing. Re-copy it into MODEL_API_KEY in .env.';
  else if (status === 402 || status === 403) hint = ' -> permission or billing problem. Your dashboard may show "account is restricted": open Billing and update the payment method.';
  else if (status === 404) hint = ' -> model not found or no access. Check SAM_MODEL and SAM_API_URL.';
  else if (status === 429) hint = ' -> rate limited. Wait a minute and retry.';
  else if (status === 400) hint = ' -> the request was rejected (see message).';
  return `SAM returned HTTP ${status}${hint} Reply: ${snippet}`;
}

async function readStreamedText(res) {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let completed = false;
  const handleLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let ev;
    try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') text += ev.delta;
    else if (ev.type === 'response.completed') completed = true;
    else if (ev.type === 'response.failed' || ev.type === 'error') {
      throw new Error(`SAM stream reported an error: ${JSON.stringify(ev).slice(0, 300)}`);
    }
  };
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl).replace(/\r$/, ''));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer.replace(/\r$/, ''));
  if (!completed) throw transient('SAM stream ended before response.completed (partial result discarded)');
  return text;
}

export async function segmentConcept(buffer, concept, sam = config.sam, { timeoutMs = sam.timeoutMs ?? 90000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(sam.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sam.key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        model: sam.model,
        input: [{ type: 'message', role: 'user', content: [
          { type: 'input_text', text: concept },
          { type: 'input_image', image_url: `data:image/png;base64,${buffer.toString('base64')}` },
        ] }],
        stream: true,
        metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(explainHttpError(res.status, await res.text()));
      err.transient = TRANSIENT_STATUSES.includes(res.status);
      throw err;
    }
    return await readStreamedText(res); // an empty string just means "no matches" (not an error)
  } catch (e) {
    if (e.name === 'AbortError') throw transient(`SAM request for "${concept}" timed out after ${Math.round(timeoutMs / 1000)}s`);
    if (e instanceof TypeError) throw transient(`SAM network error: ${e.message}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---- 3. all concepts -> one merged box list ---------------------------------------------
export async function callSam(buffer, sam = config.sam, { viewport = config.viewport, saveRaw = true } = {}) {
  if (!sam.url) throw new Error('SAM_API_URL is empty (see .env).');
  if (!sam.key) throw new Error('No API key. Put your Meta key in MODEL_API_KEY in .env (or use DISCOVERY_MODE=dom).');
  if (!sam.concepts?.length) throw new Error('SAM_CONCEPTS is empty (see .env).');

  const retryOpts = { retries: sam.retries ?? 2, backoffMs: sam.backoffMs ?? 1500, log: sam.log ?? console.warn };
  const texts = await Promise.all(sam.concepts.map((c) => withRetry(() => segmentConcept(buffer, c, sam), retryOpts)));
  if (saveRaw) {
    try {
      fs.mkdirSync(config.artifactsDir, { recursive: true });
      const dump = sam.concepts.map((c, i) => `### ${c}\n${texts[i].replace(/<\|mask;.*?\|>/g, '<|mask;...|>')}\n`).join('\n');
      fs.writeFileSync(path.join(config.artifactsDir, 'phase3-sam-raw.txt'), dump);
    } catch { /* debugging aid only */ }
  }
  return sam.concepts.flatMap((c, i) => parseSamText(texts[i], viewport, c));
}
