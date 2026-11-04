// Talks to Muse Spark on Meta Model API (same endpoint and key as SAM, different model).
//   POST https://api.meta.ai/v1/responses   Authorization: Bearer <key>
//   input_text + input_image(data URL) in one user message; ask for JSON via text.format (json_schema).
import { config } from '../../config/env.js';
import { transient, withRetry, TRANSIENT_STATUSES } from '../net/retry.js';

// The reply is OpenAI-Responses style: either a ready-made output_text, or output[] items
// (possibly a "reasoning" item first) whose message content holds output_text parts.
export function extractText(json) {
  if (typeof json?.output_text === 'string' && json.output_text) return json.output_text;
  const parts = [];
  for (const item of json?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content ?? []) if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('');
}

// Tolerates ```json fences and a sentence before/after the JSON.
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`Muse reply contained no JSON object. It said: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error(`Muse reply was not valid JSON. It said: ${text.slice(0, 200)}`);
  }
}

function explainHttpError(status, body) {
  let hint = '';
  if (status === 401) hint = ' -> the API key is wrong or missing. Re-copy it into MODEL_API_KEY in .env.';
  else if (status === 402 || status === 403) hint = ' -> permission or billing problem. Open Billing on dev.meta.ai and update the payment method.';
  else if (status === 404) hint = ' -> model not found or no access. Check MUSE_MODEL in .env (use muse-spark-1.2).';
  else if (status === 429) hint = ' -> rate limited. Wait a minute and retry.';
  return `Muse returned HTTP ${status}${hint} Reply: ${body.slice(0, 300)}`;
}

async function post(muse, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(muse.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${muse.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (e) {
    throw transient(e.name === 'AbortError' ? `Muse request timed out after ${Math.round(timeoutMs / 1000)}s` : `Muse network error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function askMuse({ prompt, imageBuffer, schema, schemaName = 'result', muse = config.muse, timeoutMs = muse.timeoutMs ?? 150000 }) {
  if (!muse.url) throw new Error('MUSE_API_URL is empty (see .env).');
  if (!muse.key) throw new Error('No API key. Put your Meta key in MODEL_API_KEY in .env.');

  const content = [{ type: 'input_text', text: prompt }];
  if (imageBuffer) content.push({ type: 'input_image', image_url: `data:image/png;base64,${imageBuffer.toString('base64')}` });
  const base = {
    model: muse.model,
    input: [{ type: 'message', role: 'user', content }],
    ...(muse.reasoningEffort ? { reasoning: { effort: muse.reasoningEffort } } : {}),
  };
  const withSchema = schema ? { ...base, text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } } } : base;

  const started = Date.now();
  const attemptOnce = async () => {
    let attempt = await post(muse, withSchema, timeoutMs);
    // If the server rejects the schema option, retry once with a plain request (the prompt still demands JSON).
    if (!attempt.ok && attempt.status === 400 && schema) attempt = await post(muse, base, timeoutMs);
    if (!attempt.ok) {
      const err = new Error(explainHttpError(attempt.status, attempt.text));
      err.transient = TRANSIENT_STATUSES.includes(attempt.status);
      throw err;
    }
    return attempt;
  };
  const attempt = await withRetry(attemptOnce, { retries: muse.retries ?? 2, backoffMs: muse.backoffMs ?? 1500, log: muse.log ?? console.warn });

  let json;
  try { json = JSON.parse(attempt.text); } catch { throw new Error('Muse reply was not JSON'); }
  const text = extractText(json);
  if (!text) throw new Error(`Muse reply had no text. Raw: ${attempt.text.slice(0, 300)}`);
  return { text, json: extractJson(text), ms: Date.now() - started };
}
