import assert from 'node:assert/strict';
import http from 'node:http';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { captureScreen, pngSize } from '../src/browser/capture.js';
import { normalizeBoxes } from '../src/vision/boxes.js';
import { renderSetOfMark } from '../src/vision/overlay.js';
import { domOracleBoxes } from '../src/vision/domOracle.js';
import { extractText, extractJson } from '../src/reasoning/muse.js';
import { buildPrompt, validateDecision, chooseElement } from '../src/reasoning/choose.js';

const ok = (m) => console.log(`  ✔ ${m}`);

console.log('Test 1: pure logic (no browser, no network)');
{
  assert.equal(extractText({ output_text: 'hi' }), 'hi');
  assert.equal(extractText({ output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }] }), '{"a":1}');
  assert.equal(extractText({}), '');
  ok('reply text is found in both Responses shapes (output_text, or output[] after a reasoning item)');
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a":2} Hope that helps'), { a: 2 });
  assert.throws(() => extractJson('no json here'), /no JSON object/);
  ok('JSON is pulled out of code fences and chatty text; garbage gives a clear error');

  const boxes = [{ id: 1, x: 10, y: 10, w: 50, h: 20, label: 'button' }, { id: 2, x: 100, y: 10, w: 80, h: 20, label: 'input field' }];
  const prompt = buildPrompt({ goal: 'Add the lamp', boxes, history: ['Opened the shop'] });
  assert.ok(prompt.includes('GOAL FOR THIS STEP: Add the lamp'));
  assert.ok(prompt.includes('1: button at x=10, y=10, size 50x20'));
  assert.ok(prompt.includes('1. Opened the shop'));
  assert.ok(!/aria-label|<button|class=/i.test(prompt));
  ok('prompt holds the goal, the box list and history, and NO page code (vision only)');

  assert.deepEqual(validateDecision({ action: 'click', box_id: 2, text: null, confidence: 1.7, reason: 'r' }, boxes).confidence, 1);
  assert.equal(validateDecision({ action: 'fill', box_id: 2, text: 'lamp', confidence: 0.9, reason: 'r' }, boxes).text, 'lamp');
  assert.equal(validateDecision({ action: 'not_found', box_id: null, text: null, confidence: 0.2, reason: 'none' }, boxes).box, null);
  assert.throws(() => validateDecision({ action: 'click', box_id: 99, confidence: 1, reason: '' }, boxes), /box 99.*not on the screen/);
  assert.throws(() => validateDecision({ action: 'fill', box_id: 2, text: '', confidence: 1, reason: '' }, boxes), /no text/);
  assert.throws(() => validateDecision({ action: 'dance', box_id: 1 }, boxes), /unknown action/);
  ok('decisions are checked: made-up box ids, empty fill text and unknown actions are rejected');
}

console.log('Test 2: reasoning against a fake Meta API (same wire format as the real one)');
const shop = await startShopServer(0);
const session = await launchBrowser();
let answerFor = () => null;
let rejectSchema = false;
let flaky = null;
let hits = 0;
let lastBody = null;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    hits++; // count every request that reaches the server, including rejected ones
    if (req.url !== '/v1/responses' || req.method !== 'POST') { res.writeHead(404).end('{}'); return; }
    if (req.headers.authorization !== 'Bearer good-key') { res.writeHead(401).end('{"error":{"code":"invalid_api_key"}}'); return; }
    if (flaky === 'hang-once' && hits === 1) return;          // never answers: the client must give up and retry
    if (flaky === 'always-hang') return;
    if (flaky === '503-once' && hits === 1) { res.writeHead(503).end('{"error":"overloaded"}'); return; }
    const b = JSON.parse(body);
    lastBody = b;
    const parts = b.input?.[0]?.content ?? [];
    const text = parts.find((p) => p.type === 'input_text')?.text ?? '';
    const img = parts.find((p) => p.type === 'input_image')?.image_url ?? '';
    if (b.model !== 'muse-spark-1.2' || !img.startsWith('data:image/png;base64,')) { res.writeHead(400).end('{"error":{"message":"bad shape"}}'); return; }
    if (rejectSchema && b.text) { res.writeHead(400).end('{"error":{"message":"text.format not supported"}}'); return; }
    const out = answerFor(text);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: out }] }] }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const muse = { ...config.muse, url: `http://127.0.0.1:${fake.address().port}/v1/responses`, key: 'good-key', model: 'muse-spark-1.2' };

try {
  const { page, context } = session;
  await page.goto(`http://127.0.0.1:${shop.address().port}/products.html`);
  const shot = await captureScreen(page);
  const boxes = normalizeBoxes(await domOracleBoxes(page), config.viewport);
  const overlay = await renderSetOfMark(context, shot.buffer, boxes);
  const bag = boxes.find((b) => b.label === 'Add Trail Backpack to cart');
  const search = boxes.find((b) => b.label === 'e.g. lamp');
  assert.ok(bag && search);

  answerFor = (t) => JSON.stringify((t.match(/GOAL FOR THIS STEP: (.*)/)?.[1] ?? '').includes('Backpack')
    ? { action: 'click', box_id: bag.id, text: null, confidence: 0.93, reason: 'Button under the Trail Backpack card.' }
    : { action: 'fill', box_id: search.id, text: 'lamp', confidence: 0.9, reason: 'Search field.' });

  const d1 = await chooseElement({ goal: 'Add the Trail Backpack to the cart', boxes, overlay, muse });
  assert.equal(d1.action, 'click');
  assert.equal(d1.box.id, bag.id);
  ok(`click decision: box #${d1.box.id} (confidence ${d1.confidence})`);

  assert.equal(lastBody.text.format.type, 'json_schema');
  assert.equal(lastBody.text.format.schema.required.length, 5);
  const sent = lastBody.input[0].content.find((p) => p.type === 'input_image').image_url;
  const png = Buffer.from(sent.split(',')[1], 'base64');
  assert.deepEqual(pngSize(png), { width: 1280, height: 800 });
  ok('request shape: model, goal text, JSON schema, and the 1280x800 numbered overlay as a data URL');

  const d2 = await chooseElement({ goal: 'Type lamp into the search box', boxes, overlay, muse });
  assert.deepEqual([d2.action, d2.box.id, d2.text], ['fill', search.id, 'lamp']);
  ok('fill decision carries the text to type');

  answerFor = () => '```json\n' + JSON.stringify({ action: 'click', box_id: bag.id, text: null, confidence: 0.8, reason: 'fenced' }) + '\n```';
  assert.equal((await chooseElement({ goal: 'g', boxes, overlay, muse })).box.id, bag.id);
  ok('a reply wrapped in a ```json fence still works');

  rejectSchema = true;
  assert.equal((await chooseElement({ goal: 'g', boxes, overlay, muse })).box.id, bag.id);
  assert.equal(lastBody.text, undefined);
  rejectSchema = false;
  ok('if the server rejects the JSON-schema option, we retry once without it');

  answerFor = () => JSON.stringify({ action: 'click', box_id: 99, text: null, confidence: 1, reason: 'oops' });
  await assert.rejects(chooseElement({ goal: 'g', boxes, overlay, muse }), /box 99/);
  ok('a made-up box id is caught before anything is clicked');

  answerFor = () => JSON.stringify({ action: 'not_found', box_id: null, text: null, confidence: 0.1, reason: 'No such button.' });
  const nf = await chooseElement({ goal: 'Click the unicorn', boxes, overlay, muse });
  assert.deepEqual([nf.action, nf.box], ['not_found', null]);
  ok('"not_found" is a normal answer (the Healer will use it later)');

  await assert.rejects(chooseElement({ goal: 'g', boxes, overlay, muse: { ...muse, key: 'wrong' } }), /HTTP 401.*API key is wrong/);
  ok('wrong key -> clear error (HTTP 401)');
  await assert.rejects(chooseElement({ goal: 'g', boxes, overlay, muse: { ...muse, model: 'muse-spark' } }), /HTTP 400/);
  ok('wrong model name is rejected by the fake API (guards our request format)');

  console.log('Test 3: slow and flaky network');
  answerFor = () => JSON.stringify({ action: 'click', box_id: bag.id, text: null, confidence: 0.9, reason: 'ok' });
  const quick = { ...muse, timeoutMs: 300, backoffMs: 10, retries: 2, log: () => {} };
  flaky = 'hang-once'; hits = 0;
  assert.equal((await chooseElement({ goal: 'g', boxes, overlay, muse: quick })).box.id, bag.id);
  assert.equal(hits, 2);
  ok('a request that never answers is abandoned after the time limit and retried (2 tries, then success)');
  flaky = '503-once'; hits = 0;
  assert.equal((await chooseElement({ goal: 'g', boxes, overlay, muse: quick })).box.id, bag.id);
  assert.equal(hits, 2);
  ok('HTTP 503 (server overloaded) is retried and succeeds');
  flaky = 'always-hang'; hits = 0;
  await assert.rejects(chooseElement({ goal: 'g', boxes, overlay, muse: { ...quick, retries: 1 } }), /timed out after .*gave up after 2 attempts/);
  assert.equal(hits, 2);
  ok('if it never answers, it stops after the allowed retries with a clear message');
  flaky = null; hits = 0;
  await assert.rejects(chooseElement({ goal: 'g', boxes, overlay, muse: { ...quick, key: 'wrong' } }), /HTTP 401/);
  assert.equal(hits, 1);
  ok('a wrong key is NOT retried (it can never succeed)');
  const timed = await chooseElement({ goal: 'g', boxes, overlay, muse });
  assert.ok(Number.isFinite(timed.ms) && timed.ms >= 0);
  ok(`each decision reports how long Muse took (${timed.ms} ms here)`);

  const empty = await chooseElement({ goal: 'g', boxes: [], overlay, muse });
  assert.equal(empty.action, 'not_found');
  ok('no detected elements -> not_found without spending an API call');

  console.log('\nPhase 4 tests passed');
} catch (e) {
  console.error('\nPhase 4 test FAILED:', e.message);
  if (e.stack) console.error(e.stack.split('\n').filter((l) => l.includes('phase4-test')).slice(0, 2).join('\n'));
  process.exitCode = 1;
} finally {
  await session.close();
  shop.close();
  fake.closeAllConnections?.();
  fake.close();
}
