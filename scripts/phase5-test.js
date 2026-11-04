import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { normalizeBoxes } from '../src/vision/boxes.js';
import { domOracleBoxes } from '../src/vision/domOracle.js';
import { bridge, buildLocator, specToCode, BridgeError } from '../src/bridge/locatorBridge.js';
import { validateDoc, saveDoc, loadDoc } from '../src/bridge/steps.js';
import { recordFlow } from '../src/agent/record.js';
import { replay } from '../src/replay/replay.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const flow = JSON.parse(fs.readFileSync(path.join(config.root, 'flows', 'buy-backpack.json'), 'utf8'));

// Scrambles every class name and wraps every control in an extra <div> (the "front-end redesign").
const mutateDom = (page) => page.evaluate(() => {
  const rand = () => 'h' + Math.random().toString(36).slice(2, 8);
  document.querySelectorAll('body *').forEach((el) => { el.className = rand(); });
  document.querySelectorAll('button, a, input, textarea, select').forEach((el) => {
    if (el.parentElement?.dataset.mut) return;
    const w = document.createElement('div');
    w.dataset.mut = '1'; w.className = rand();
    el.parentNode.insertBefore(w, el); w.appendChild(el);
  });
});

const shop = await startShopServer(0);
const base = `http://127.0.0.1:${shop.address().port}`;
const session = await launchBrowser();
let fake;
try {
  const { page, context } = session;

  console.log('Test 1: the bridge builds a stable locator for every control on every page');
  const names = {};
  for (const p of ['index', 'products', 'cart', 'checkout', 'login', 'confirmation']) {
    await page.goto(`${base}/${p}.html`);
    const boxes = normalizeBoxes(await domOracleBoxes(page), config.viewport);
    for (const b of boxes) {
      const r = await bridge(page, b);
      assert.equal(r.fragile, false, `${p}: ${r.code} is only a CSS fallback`);
      assert.equal(await buildLocator(page, r.spec).count(), 1);
      names[`${p}:${b.label || r.spec.text || r.spec.name}`] = r;
    }
  }
  ok(`${Object.keys(names).length} controls across 6 pages -> every one got a semantic, unique, verified locator (no CSS fallback)`);

  await page.goto(`${base}/products.html`);
  const boxes = normalizeBoxes(await domOracleBoxes(page), config.viewport);
  const find = (label) => boxes.find((b) => b.label === label);
  const bag = await bridge(page, find('Add Trail Backpack to cart'));
  assert.equal(bag.code, "page.getByRole('button', { name: 'Add Trail Backpack to cart', exact: true })");
  ok(`product button -> ${bag.code}`);
  const search = await bridge(page, find('e.g. lamp'));
  assert.equal(search.code, "page.getByRole('searchbox', { name: 'Search products', exact: true })");
  ok(`search box     -> ${search.code}`);
  await page.goto(`${base}/login.html`);
  const lb = normalizeBoxes(await domOracleBoxes(page), config.viewport);
  const pw = await bridge(page, lb.find((b) => b.y > 250 && b.y < 300));
  assert.equal(pw.spec.strategy, 'label');
  ok(`password field -> ${pw.code}   (password inputs have no ARIA role, so it falls back to the label)`);

  console.log('Test 2: honest failures');
  await assert.rejects(bridge(page, { x: 5, y: 770, w: 20, h: 20 }), (e) => e instanceof BridgeError && /no interactive element/.test(e.message));
  ok('a box over empty background is rejected with a clear reason');
  assert.throws(() => specToCode({ strategy: 'nope' }), /Unknown locator strategy/);
  ok('unknown locator strategies are refused');

  console.log('Test 3: the steps file');
  const good = { version: 1, start: '/index.html', steps: [{ intent: 'x', action: 'click', locator: bag.spec, code: bag.code }] };
  validateDoc(good);
  assert.throws(() => validateDoc({ ...good, version: 2 }), /version/);
  assert.throws(() => validateDoc({ ...good, steps: [{ ...good.steps[0], action: 'fill' }] }), /no "text"/);
  assert.throws(() => validateDoc({ ...good, steps: [{ ...good.steps[0], locator: { strategy: 'xpath' } }] }), /locator strategy/);
  assert.throws(() => validateDoc({ ...good, start: 'index.html' }), /start/);
  ok('good files pass; wrong version, fill without text, unknown strategy and bad start path are rejected');

  console.log('Test 4: why semantic locators survive a redesign');
  await page.goto(`${base}/products.html`);
  const before = await page.locator('button.btn').count();
  await mutateDom(page);
  const after = await page.locator('button.btn').count();
  assert.equal(before, 4);
  assert.equal(after, 0);
  ok(`a class-based selector (button.btn) matched ${before} buttons before the redesign and ${after} after`);
  assert.equal(await buildLocator(page, bag.spec).count(), 1);
  await buildLocator(page, bag.spec).click();
  assert.equal(await page.locator('[id="cart-count"]').textContent(), '1');
  ok('the bridge locator still finds exactly 1 element after the redesign, and clicking it works');

  console.log('Test 5: record a whole flow, then replay it with no AI');
  // A stand-in for Muse that knows the intended element for each goal and answers the way a perfect model would.
  const intended = {
    'Click the Shop now button': { loc: (p) => p.getByRole('link', { name: 'Shop now' }), action: 'click' },
    'Add the Trail Backpack to the cart': { loc: (p) => p.getByRole('button', { name: 'Add Trail Backpack to cart' }), action: 'click' },
    'Open the cart': { loc: (p) => p.getByRole('link', { name: /^Cart/ }), action: 'click' },
    'Click the Proceed to checkout button': { loc: (p) => p.getByRole('link', { name: 'Proceed to checkout' }), action: 'click' },
    'Type Ada Lovelace in the full name field': { loc: (p) => p.getByLabel('Full name'), action: 'fill', text: 'Ada Lovelace' },
    'Type ada@example.com in the email field': { loc: (p) => p.getByLabel('Email'), action: 'fill', text: 'ada@example.com' },
    'Type 12 Analytical St in the shipping address field': { loc: (p) => p.getByLabel('Shipping address'), action: 'fill', text: '12 Analytical St' },
    'Type 4242424242424242 in the card number field': { loc: (p) => p.getByLabel('Card number'), action: 'fill', text: '4242424242424242' },
    'Click the Place order button': { loc: (p) => p.getByRole('button', { name: 'Place order' }), action: 'click' },
  };
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const prompt = JSON.parse(body).input[0].content[0].text;
      const goal = prompt.match(/GOAL FOR THIS STEP: (.*)/)[1];
      const want = intended[goal];
      const bb = await want.loc(page).boundingBox();
      const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
      let id = null;
      for (const line of prompt.split('\n')) {
        const m = line.match(/^(\d+): .* at x=(\d+), y=(\d+), size (\d+)x(\d+)$/);
        if (m && cx >= +m[2] && cx <= +m[2] + +m[4] && cy >= +m[3] && cy <= +m[3] + +m[5]) id = Number(m[1]);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output_text: JSON.stringify({ action: want.action, box_id: id, text: want.text ?? null, confidence: 0.95, reason: 'stand-in model' }) }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const muse = { ...config.muse, url: `http://127.0.0.1:${fake.address().port}/v1/responses`, key: 'k', model: 'muse-spark-1.2' };

  const doc = await recordFlow({ page, context, flow, baseUrl: base, discover: { mode: 'dom' }, muse });
  assert.equal(doc.steps.length, 9);
  validateDoc(doc);
  assert.ok(doc.steps.every((s) => !s.fragile));
  assert.equal(doc.steps[8].urlAfter, '/confirmation.html');
  // Test 4 left an item in this browser's cart, so the nav link was named "Cart (2)" while recording.
  // A fresh replay sees "Cart (1)". The bridge must therefore have dropped the counter from the name.
  assert.deepEqual([doc.steps[2].locator.name, doc.steps[2].locator.exact], ['Cart', false]);
  assert.equal(doc.steps[4].locator.role, 'textbox');
  assert.equal(doc.steps[4].text, 'Ada Lovelace');
  ok(`recorded ${doc.steps.length} steps; none fragile; the changing counter in "Cart (2)" was dropped from the locator`);
  doc.steps.forEach((s) => console.log(`       ${s.id}. ${s.action.padEnd(5)} ${s.code}`));

  const file = path.join(config.artifactsDir, 'phase5-test.steps.json');
  saveDoc(file, doc);
  const reloaded = loadDoc(file);
  assert.deepEqual(reloaded.steps.map((s) => s.code), doc.steps.map((s) => s.code));
  ok('saved to disk and loaded back identically');

  const ctx2 = await session.browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  const clean = await replay(p2, reloaded, { baseUrl: base });
  assert.ok(clean.every((r) => r.ok), JSON.stringify(clean.find((r) => !r.ok)));
  assert.equal(new URL(p2.url()).pathname, '/confirmation.html');
  ok('replay with plain Playwright, no AI: all 9 steps pass and the order is confirmed');

  const p3 = await (await session.browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1 })).newPage();
  const mutated = await replay(p3, reloaded, { baseUrl: base, beforeStep: mutateDom });
  assert.ok(mutated.every((r) => r.ok), JSON.stringify(mutated.find((r) => !r.ok)));
  ok('replay while the page is "redesigned" before every step (new classes, extra wrappers): still all 9 pass');

  console.log('\nPhase 5 tests passed');
} catch (e) {
  console.error('\nPhase 5 test FAILED:', e.message);
  if (e.stack) console.error(e.stack.split('\n').filter((l) => l.includes('phase5-test')).slice(0, 2).join('\n'));
  process.exitCode = 1;
} finally {
  await session.close();
  shop.close();
  fake?.close();
}
