import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { captureScreen } from '../src/browser/capture.js';
import { parseSamText } from '../src/vision/samClient.js';
import { discoverElements } from '../src/vision/discover.js';
import { domOracleBoxes } from '../src/vision/domOracle.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const vp = config.viewport;

console.log('Test 1: reading Meta\'s special-token output (no browser, no network)');
{
  // Example copied from the official "Reading segmentation output" page (mask payloads shortened).
  const docs = '<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~AAAA|>,1<|box;x1=260;y1=382;x2=340;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,81,~BBBB|>';
  const a = parseSamText(docs, { width: 537, height: 561 }, 'bus');
  assert.equal(a.length, 2);
  assert.deepEqual([a[0].objectId, a[0].x, a[0].y, a[0].w, a[0].h, a[0].label], [0, 353, 382, 101, 46, 'bus']);
  ok('two records parsed; x2/y2 treated as inclusive (width = x2 - x1 + 1)');
  assert.deepEqual([a[1].objectId, a[1].x], [1, 260]);
  const c = parseSamText('<0f>7<|box;x1=10;y1=20;x2=19;y2=29;w=1280;h=800;c=0.9609375|><|mask;x=0;y=0;c=0.9609375;data=10,10,!ZZ|>', vp);
  assert.equal(c[0].objectId, 7);
  assert.equal(c[0].score, 0.9609375);
  ok('sparse object ids and the confidence field (c=) are read');
  const d = parseSamText('<0f>0<|box;x1=100;y1=100;x2=199;y2=149;w=640;h=400|><|mask;x=0;y=0;data=1,1,~Q|>', vp);
  assert.deepEqual([d[0].x, d[0].y, d[0].w, d[0].h], [200, 200, 200, 100]);
  ok('boxes are scaled when the reply image size differs from our 1280x800');
  assert.deepEqual(parseSamText('', vp), []);
  ok('empty text = zero matches (valid result, not an error)');
}

console.log('Test 2: discovery against a fake Meta API (same wire format as the real one)');
const shop = await startShopServer(0);
const session = await launchBrowser();
let domBoxes = [];
const seenPrompts = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/responses') { res.writeHead(404).end('{"error":{"code":"not_found"}}'); return; }
    if (req.headers.authorization !== 'Bearer good-key') { res.writeHead(401).end('{"error":{"code":"invalid_api_key"}}'); return; }
    const b = JSON.parse(body);
    const parts = b.input?.[0]?.content ?? [];
    const text = parts.find((p) => p.type === 'input_text')?.text;
    const img = parts.find((p) => p.type === 'input_image')?.image_url;
    if (b.model !== 'sam-3.1' || b.stream !== true || !text || !img?.startsWith('data:image/png;base64,')) {
      res.writeHead(400).end('{"error":{"message":"bad request shape"}}'); return;
    }
    seenPrompts.push(text);
    const pick = {
      button: domBoxes.filter((x) => x.label.startsWith('Add')),
      link: domBoxes.filter((x) => !x.label.startsWith('Add') && x.y < 60),
      'input field': domBoxes.filter((x) => x.y >= 60 && !x.label.startsWith('Add')),
    }[text] ?? []; // anything else (e.g. a comma list) returns zero matches, like the real API
    const line = pick.length === 0 ? '' : '<0f>' + pick.map((x, i) => {
      const x1 = Math.round(x.x), y1 = Math.round(x.y), x2 = Math.round(x.x + x.w) - 1, y2 = Math.round(x.y + x.h) - 1;
      return `${i}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=1280;h=800;c=0.9|><|mask;x=0;y=0;c=0.9;data=3,3,!AAA|>`;
    }).join(',');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const events = [];
    if (line) { const cut = Math.floor(line.length / 2); events.push(line.slice(0, cut), line.slice(cut)); }
    const sse = events.map((d) => `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: d })}\n\n`).join('') +
      `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`;
    // send in awkward 17-byte chunks to prove the stream reader copes with split lines
    for (let i = 0; i < sse.length; i += 17) res.write(sse.slice(i, i + 17));
    res.end();
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${fake.address().port}/v1/responses`;
const good = { ...config.sam, url, key: 'good-key', concepts: ['button', 'link', 'input field'] };

try {
  const { page } = session;
  await page.goto(`http://127.0.0.1:${shop.address().port}/products.html`);
  const shot = await captureScreen(page);
  domBoxes = await domOracleBoxes(page);

  const dom = await discoverElements({ page, screenshot: shot, mode: 'dom' });
  assert.ok(dom.boxes.length >= 8);
  ok(`mode "dom": ${dom.boxes.length} elements`);

  const viaSam = await discoverElements({ page, screenshot: shot, mode: 'sam', sam: good });
  assert.equal(viaSam.source, 'sam');
  assert.equal(viaSam.boxes.length, dom.boxes.length);
  ok(`mode "sam": ${viaSam.boxes.length} elements merged from ${good.concepts.length} separate requests`);
  assert.deepEqual([...seenPrompts].sort(), [...good.concepts].sort());
  assert.ok(seenPrompts.every((p) => !p.includes(',')));
  ok('each request carried exactly ONE noun phrase (no comma lists, as Meta requires)');

  const labels = new Set(viaSam.boxes.map((b) => b.label));
  assert.deepEqual([...labels].sort(), ['button', 'input field', 'link']);
  ok('every box remembers which concept found it (button / link / text input field)');

  const noKey = await discoverElements({ page, screenshot: shot, mode: 'auto', sam: { ...good, key: '' } });
  assert.equal(noKey.source, 'dom');
  ok('mode "auto" with no key falls back to DOM');

  await assert.rejects(discoverElements({ page, screenshot: shot, mode: 'sam', sam: { ...good, key: 'wrong' } }), /HTTP 401.*API key is wrong/);
  ok('wrong key -> clear error mentioning the key (HTTP 401)');

  const warned = [];
  const fb = await discoverElements({ page, screenshot: shot, mode: 'auto', sam: { ...good, key: 'wrong' }, log: (m) => warned.push(m) });
  assert.equal(fb.source, 'dom');
  assert.equal(warned.length, 1);
  ok('mode "auto" with a failing SAM warns once, then falls back to DOM');

  await assert.rejects(discoverElements({ page, screenshot: shot, mode: 'sam', sam: { ...good, model: 'nope' } }), /HTTP 400/);
  ok('bad request shape is rejected by the fake API (guards our request format)');

  const zero = await discoverElements({ page, screenshot: shot, mode: 'sam', sam: { ...good, concepts: ['unicorn'] } });
  assert.equal(zero.boxes.length, 0);
  ok('a concept with no matches gives an empty list, not a crash');

  let samHits = 0;
  const shaky = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      samHits++;
      if (samHits === 1) { res.writeHead(503).end('busy'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '<0f>0<|box;x1=0;y1=0;x2=99;y2=49;w=1280;h=800|><|mask;x=0;y=0;data=1,1,!A|>' })}\n\ndata: ${JSON.stringify({ type: 'response.completed' })}\n\n`);
    });
  });
  await new Promise((r) => shaky.listen(0, '127.0.0.1', r));
  const { callSam } = await import('../src/vision/samClient.js');
  const got = await callSam(shot.buffer, { ...good, url: `http://127.0.0.1:${shaky.address().port}/v1/responses`, concepts: ['button'], retries: 2, backoffMs: 10, log: () => {} }, { saveRaw: false });
  shaky.close();
  assert.equal(got.length, 1);
  assert.equal(samHits, 2);
  ok('SAM: HTTP 503 is retried and then succeeds (2 tries)');

  assert.ok(fs.existsSync(path.join(config.artifactsDir, 'phase3-sam-raw.txt')));
  const dump = fs.readFileSync(path.join(config.artifactsDir, 'phase3-sam-raw.txt'), 'utf8');
  assert.ok(!dump.includes('good-key'));
  ok('raw SAM text saved for debugging (masks stripped, no key inside)');
  console.log('\nPhase 3 tests passed');
} catch (e) {
  console.error('\nPhase 3 test FAILED:', e.message);
  if (e.stack) console.error(e.stack.split('\n').filter((l) => l.includes('phase3-test')).slice(0, 2).join('\n'));
  process.exitCode = 1;
} finally {
  await session.close();
  shop.close();
  fake.close();
}
