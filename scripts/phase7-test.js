import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { loadDoc } from '../src/bridge/steps.js';
import { runBenchmark, SCENARIOS } from '../src/bench/runner.js';
import { cellText, renderMarkdown, scoreOf } from '../src/bench/report.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const doc = loadDoc(path.join(config.root, 'steps', 'offline-sample.steps.json'));
const session = await launchBrowser();
let fake;
try {
  console.log('Test 1: the reorder mutation');
  const s = await startShopServer(0, { mutation: ['reorder-products'] });
  const p = await session.context.newPage();
  await p.goto(`http://127.0.0.1:${s.address().port}/products.html`);
  await p.waitForTimeout(300);
  const labels = await p.locator('#product-grid button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  assert.deepEqual(labels, ['Add Desk Lamp to cart', 'Add Studio Headphones to cart', 'Add Steel Water Bottle to cart', 'Add Trail Backpack to cart']);
  await p.getByLabel('Search products').fill('a'); // a re-render must keep the new order
  await p.waitForTimeout(300);
  const after = await p.locator('#product-grid button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  assert.equal(after[after.length - 1], 'Add Trail Backpack to cart');
  await p.close(); s.close();
  ok('product cards appear in reverse order, and stay reversed after the page redraws them');

  console.log('Test 2: the four free approaches across all six scenarios (about a minute)');
  const results = await runBenchmark({ browser: session.browser, doc, arms: ['css', 'xpath', 'semantic', 'synthetix'], timeout: 1200 });
  const verdict = (sc, arm) => results.find((c) => c.scenario === sc && c.arm === arm).runs[0].verdict;
  const expected = {
    control: { css: 'pass', xpath: 'pass', semantic: 'pass', synthetix: 'pass' },
    wrappers: { css: 'fail', xpath: 'fail', semantic: 'pass', synthetix: 'pass' },
    'hashed-classes': { css: 'fail', xpath: 'pass', semantic: 'pass', synthetix: 'pass' },
    reorder: { css: 'wrong-result', xpath: 'wrong-result', semantic: 'pass', synthetix: 'pass' },
    'rename-text': { css: 'pass', xpath: 'pass', semantic: 'fail', synthetix: 'fail' },
    everything: { css: 'fail', xpath: 'fail', semantic: 'fail', synthetix: 'fail' },
  };
  for (const [sc, arms] of Object.entries(expected)) {
    for (const [arm, want] of Object.entries(arms)) assert.equal(verdict(sc, arm), want, `${sc} / ${arm}: expected ${want}, got ${verdict(sc, arm)}`);
  }
  ok('control: every approach buys one Trail Backpack (the benchmark itself is fair)');
  ok('layout wrappers break CSS and XPath; semantic and Synthetix locators survive');
  ok('hashed classes break CSS only (XPath does not use classes; it survives)');
  ok('reordered products: CSS and XPath "pass" while buying the WRONG item (a silent false pass, caught by checking the order total)');
  ok('renamed wording: CSS and XPath survive, semantic and unhealed Synthetix break (the trade-off, shown honestly)');
  ok('everything at once: all four free approaches fail');
  const css = results.find((c) => c.scenario === 'reorder' && c.arm === 'css').runs[0];
  assert.equal(css.outcome.total, 39.9);
  ok(`   (the reordered CSS test bought a $${css.outcome.total} item instead of $59)`);

  console.log('Test 3: the Healer arm, using a stand-in model that reads the wording on the changed site');
  let current = null;
  const table = {
    'Click the Shop now button': { loc: (pg) => pg.getByRole('link', { name: 'Start shopping' }), action: 'click' },
    'Add the Trail Backpack to the cart': { loc: (pg) => pg.getByRole('button', { name: 'Add Trail Backpack to basket' }), action: 'click' },
    'Open the cart': { loc: (pg) => pg.getByRole('link', { name: /^Basket/ }), action: 'click' },
    'Click the Proceed to checkout button': { loc: (pg) => pg.getByRole('link', { name: 'Go to checkout' }), action: 'click' },
    'Type Ada Lovelace in the full name field': { loc: (pg) => pg.getByLabel('Your name'), action: 'fill', text: 'Ada Lovelace' },
    'Type ada@example.com in the email field': { loc: (pg) => pg.getByLabel('Email'), action: 'fill', text: 'ada@example.com' },
    'Type 12 Analytical St in the shipping address field': { loc: (pg) => pg.getByLabel('Delivery address'), action: 'fill', text: '12 Analytical St' },
    'Type 4242424242424242 in the card number field': { loc: (pg) => pg.getByLabel('Card number'), action: 'fill', text: '4242424242424242' },
    'Click the Place order button': { loc: (pg) => pg.getByRole('button', { name: 'Complete purchase' }), action: 'click' },
  };
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const prompt = JSON.parse(body).input[0].content[0].text;
      const want = table[prompt.match(/GOAL FOR THIS STEP: (.*)/)[1]];
      const bb = await want.loc(current).boundingBox();
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
  const muse = { ...config.muse, url: `http://127.0.0.1:${fake.address().port}/v1/responses`, key: 'k', model: 'muse-spark-1.2', log: () => {} };
  const heal = await runBenchmark({
    browser: session.browser, doc, arms: ['heal'], timeout: 2500, muse, discover: { mode: 'dom' },
    scenarios: SCENARIOS.filter((x) => ['control', 'rename-text', 'everything'].includes(x.id)), onPage: (pg) => { current = pg; },
  });
  const h = (id) => heal.find((c) => c.scenario === id).runs[0];
  assert.deepEqual([h('control').verdict, h('control').healed], ['pass', 0]);
  assert.deepEqual([h('rename-text').verdict, h('rename-text').healed], ['pass', 7]);
  assert.deepEqual([h('everything').verdict, h('everything').healed], ['pass', 7]);
  ok('control: passes with nothing healed; renamed wording: passes with 7 steps healed; everything at once: passes with 7 healed');
  assert.equal(h('everything').outcome.total, 59);
  ok('...and the order total is still $59.00 (the right item was bought)');

  console.log('Test 4: the report');
  const md = renderMarkdown([...results, ...heal], { stepsFile: 'steps/offline-sample.steps.json', when: 'test' });
  assert.ok(md.includes('| Approach |') && md.includes('Everything at once') && md.includes('⚠️ wrong result') && md.includes('(7 healed)'));
  assert.ok(md.includes('How to read this honestly'));
  assert.deepEqual(scoreOf(results, 'semantic'), { pass: 4, total: 6 });
  assert.equal(cellText(results.find((c) => c.scenario === 'control' && c.arm === 'css')), '✅ 9/9');
  ok('the markdown table has every approach, the false-pass warning, the healed counts and an honest reading guide');
  console.log('\n' + md.split('\n').filter((l) => l.startsWith('|')).join('\n') + '\n');
  console.log('Phase 7 tests passed');
} catch (e) {
  console.error('\nPhase 7 test FAILED:', e.message);
  if (e.stack) console.error(e.stack.split('\n').filter((l) => l.includes('phase7-test')).slice(0, 2).join('\n'));
  process.exitCode = 1;
} finally {
  await session.close();
  fake?.closeAllConnections?.();
  fake?.close();
}
