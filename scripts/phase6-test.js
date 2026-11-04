import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { captureScreen, countDifferentPixels } from '../src/browser/capture.js';
import { loadDoc, saveDoc } from '../src/bridge/steps.js';
import { replay } from '../src/replay/replay.js';
import { healFlow } from '../src/heal/healer.js';
import { unifiedDiff } from '../src/heal/diff.js';
import { parseMutations } from '../src/mutations/pageMutator.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const sample = loadDoc(path.join(config.root, 'steps', 'offline-sample.steps.json'));
const sampleText = JSON.stringify(sample, null, 2) + '\n';
const open = async (mutation) => { const s = await startShopServer(0, { mutation }); return { s, base: `http://127.0.0.1:${s.address().port}` }; };
const fresh = async (browser) => (await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1 })).newPage();

console.log('Test 1: the patch writer (no browser)');
{
  const a = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const b = a.replace('line 5\n', 'LINE FIVE\n').replace('line 25\n', 'LINE 25\nextra line\n');
  const d = unifiedDiff(a, b, { path: 'demo/file.txt' });
  assert.ok(d.startsWith('diff --git a/demo/file.txt b/demo/file.txt\n--- a/demo/file.txt\n+++ b/demo/file.txt\n@@ '));
  assert.equal((d.match(/^@@ /gm) || []).length, 2);
  assert.equal(unifiedDiff(a, a, { path: 'x' }), '');
  ok('output looks like git: header, two separate hunks for two distant edits, empty when nothing changed');
  let gitOk = true;
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { gitOk = false; }
  if (gitOk) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synth-'));
    fs.mkdirSync(path.join(dir, 'demo'));
    fs.writeFileSync(path.join(dir, 'demo/file.txt'), a);
    fs.writeFileSync(path.join(dir, 'p.patch'), d);
    // Make this folder its own repository. Otherwise, if the temp folder happens to sit inside some other
    // git repository, `git apply` quietly skips every file and still reports success.
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['apply', '--check', 'p.patch'], { cwd: dir });
    execFileSync('git', ['apply', 'p.patch'], { cwd: dir });
    assert.equal(fs.readFileSync(path.join(dir, 'demo/file.txt'), 'utf8').replace(/\r\n/g, '\n'), b);
    ok('real `git apply` accepts the patch and produces exactly the new file');
  } else ok('(git not installed here: skipped the git apply check)');
  assert.deepEqual(parseMutations('all'), ['wrappers', 'hashed-classes', 'rename-text']);
  assert.throws(() => parseMutations('explode'), /Unknown mutation/);
  ok('mutation names are validated');
}

const plain = await startShopServer(0);
const plainBase = `http://127.0.0.1:${plain.address().port}`;
const session = await launchBrowser();
const extra = [];
let fake;
try {
  console.log('Test 2: the simulated redesigns');
  const { page, context } = session;
  await page.goto(`${plainBase}/products.html`);
  const original = await captureScreen(page);

  for (const [name, check] of [
    ['wrappers', async (p) => (await p.locator('[data-mutated="wrapper"]').count()) > 8],
    ['hashed-classes', async (p) => (await p.locator('.btn').count()) === 0 && (await p.locator('button').count()) === 4],
    ['rename-text', async (p) => (await p.getByRole('button', { name: 'Add Trail Backpack to basket' }).count()) === 1],
  ]) {
    const { s, base } = await open(name);
    extra.push(s);
    await page.goto(`${base}/products.html`);
    await page.waitForTimeout(300);
    assert.ok(await check(page), `${name} did not change the page as intended`);
    ok(`"${name}" changes the page as described`);
    if (name !== 'rename-text') {
      const shot = await captureScreen(page);
      const diff = await countDifferentPixels(context, original.buffer, shot.buffer);
      assert.ok(diff >= 0 && diff < 200, `${name} changed ${diff} pixels; it should look identical`);
      ok(`   ...and the page looks identical to the eye (${diff} of ${shot.width * shot.height} pixels differ)`);
    }
    await page.getByRole('button', { name: /^Add Trail Backpack/ }).click();
    assert.equal(await page.locator('[id="cart-count"]').textContent(), '1');
  }
  ok('the shop still works under every mutation (adding to the cart succeeds)');

  console.log('Test 3: which redesigns break a recorded test?');
  for (const name of ['wrappers', 'hashed-classes']) {
    const { s, base } = await open(name);
    extra.push(s);
    const res = await replay(await fresh(session.browser), sample, { baseUrl: base });
    assert.equal(res.length, 9);
    assert.ok(res.every((r) => r.ok), `${name}: ${JSON.stringify(res.find((r) => !r.ok))}`);
    ok(`"${name}": all 9 recorded steps still pass with NO healing`);
  }
  {
    const { s, base } = await open('rename-text');
    extra.push(s);
    const res = await replay(await fresh(session.browser), sample, { baseUrl: base });
    assert.equal(res.length, 1);
    assert.equal(res[0].ok, false);
    ok(`"rename-text": the test breaks at step 1 ("${res[0].intent}") because the button now says "Start shopping"`);
  }

  console.log('Test 4: healing, using a stand-in model that reads the wording on the changed site');
  let current = null;
  let override = null;
  const table = {
    'Click the Shop now button': { loc: (p) => p.getByRole('link', { name: 'Start shopping' }), action: 'click' },
    'Add the Trail Backpack to the cart': { loc: (p) => p.getByRole('button', { name: 'Add Trail Backpack to basket' }), action: 'click' },
    'Open the cart': { loc: (p) => p.getByRole('link', { name: /^Basket/ }), action: 'click' },
    'Click the Proceed to checkout button': { loc: (p) => p.getByRole('link', { name: 'Go to checkout' }), action: 'click' },
    'Type Ada Lovelace in the full name field': { loc: (p) => p.getByLabel('Your name'), action: 'fill', text: 'Ada Lovelace' },
    'Type ada@example.com in the email field': { loc: (p) => p.getByLabel('Email'), action: 'fill', text: 'ada@example.com' },
    'Type 12 Analytical St in the shipping address field': { loc: (p) => p.getByLabel('Delivery address'), action: 'fill', text: '12 Analytical St' },
    'Type 4242424242424242 in the card number field': { loc: (p) => p.getByLabel('Card number'), action: 'fill', text: '4242424242424242' },
    'Click the Place order button': { loc: (p) => p.getByRole('button', { name: 'Complete purchase' }), action: 'click' },
  };
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const prompt = JSON.parse(body).input[0].content[0].text;
      const goal = prompt.match(/GOAL FOR THIS STEP: (.*)/)[1];
      let out;
      if (override) out = override(prompt, goal);
      else {
        const want = table[goal];
        const bb = await want.loc(current).boundingBox();
        const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
        let id = null;
        for (const line of prompt.split('\n')) {
          const m = line.match(/^(\d+): .* at x=(\d+), y=(\d+), size (\d+)x(\d+)$/);
          if (m && cx >= +m[2] && cx <= +m[2] + +m[4] && cy >= +m[3] && cy <= +m[3] + +m[5]) id = Number(m[1]);
        }
        out = { action: want.action, box_id: id, text: want.text ?? null, confidence: 0.95, reason: 'stand-in model read the new wording' };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output_text: JSON.stringify(out) }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const muse = { ...config.muse, url: `http://127.0.0.1:${fake.address().port}/v1/responses`, key: 'k', model: 'muse-spark-1.2', log: () => {} };

  const { s: allShop, base: allBase } = await open('all');
  extra.push(allShop);
  const hp = await fresh(session.browser);
  current = hp;
  const report = await healFlow({ page: hp, context: hp.context(), doc: sample, baseUrl: allBase, discover: { mode: 'dom' }, muse });
  assert.equal(report.ok, true, JSON.stringify(report.results.find((r) => r.status === 'unhealable')));
  const status = report.results.map((r) => r.status);
  assert.deepEqual(status, ['healed', 'healed', 'healed', 'healed', 'healed', 'passed', 'healed', 'passed', 'healed']);
  ok('with all three mutations on: 7 steps healed, the 2 whose wording did not change (Email, Card number) needed nothing');
  report.results.filter((r) => r.status === 'healed').forEach((r) => console.log(`       ${r.index + 1}. ${r.newCode}`));
  assert.equal(new URL(hp.url()).pathname, '/confirmation.html');
  ok('the order was still placed (the flow reached /confirmation.html)');

  const newText = JSON.stringify(report.healedDoc, null, 2) + '\n';
  const patch = unifiedDiff(sampleText, newText, { path: 'steps/offline-sample.steps.json' });
  const minus = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  const plus = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  assert.equal(minus.length, 14);
  assert.equal(plus.length, 14);
  assert.ok(minus.every((l) => /"(code|strategy|name|text|role|exact)"/.test(l) || /"locator"/.test(l) || /^-\s+[\]}{,"\w]/.test(l)));
  ok(`the patch is small and clean: ${minus.length} lines out, ${plus.length} lines in (only "locator" and "code" of the 7 healed steps)`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synth-heal-'));
  fs.mkdirSync(path.join(dir, 'steps'));
  fs.writeFileSync(path.join(dir, 'steps/offline-sample.steps.json'), sampleText);
  fs.writeFileSync(path.join(dir, 'heal.patch'), patch);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['apply', '--check', 'heal.patch'], { cwd: dir });
  execFileSync('git', ['apply', 'heal.patch'], { cwd: dir });
  assert.equal(fs.readFileSync(path.join(dir, 'steps/offline-sample.steps.json'), 'utf8').replace(/\r\n/g, '\n'), newText);
  ok('`git apply` turns the old steps file into exactly the healed one');

  const healedFile = path.join(dir, 'healed.steps.json');
  saveDoc(healedFile, report.healedDoc);
  const again = await replay(await fresh(session.browser), loadDoc(healedFile), { baseUrl: allBase });
  assert.ok(again.every((r) => r.ok), JSON.stringify(again.find((r) => !r.ok)));
  ok('the healed steps file now replays cleanly on the changed site with no AI');

  console.log('Test 5: the Healer refuses to guess');
  const { s: rn, base: rnBase } = await open('rename-text');
  extra.push(rn);
  const oneStep = (over = {}) => ({
    version: 1, name: 'one', start: '/products.html', steps: [{
      id: 1, intent: 'Add the Trail Backpack to the cart', action: 'click', urlAfter: '/products.html',
      locator: { strategy: 'role', role: 'button', name: 'Add Trail Backpack to cart', exact: true },
      code: "page.getByRole('button', { name: 'Add Trail Backpack to cart', exact: true })", ...over,
    }],
  });
  const tryHeal = async (doc, fn) => {
    override = fn;
    const p = await fresh(session.browser);
    current = p;
    return healFlow({ page: p, context: p.context(), doc, baseUrl: rnBase, discover: { mode: 'dom' }, muse });
  };
  const boxFor = (prompt, text) => Number(prompt.split('\n').find((l) => l.includes(text)).split(':')[0]);

  let r = await tryHeal(oneStep(), () => ({ action: 'not_found', box_id: null, text: null, confidence: 0.9, reason: 'nothing like that' }));
  assert.equal(r.ok, false);
  assert.match(r.results[0].error, /could not find/);
  ok('"not found" from Muse: nothing is changed, the test is reported as broken');
  r = await tryHeal(oneStep(), (prompt) => ({ action: 'click', box_id: boxFor(prompt, 'to basket'), text: null, confidence: 0.3, reason: 'unsure' }));
  assert.match(r.results[0].error, /only 0.3 sure/);
  ok('low confidence (0.3): refused');
  r = await tryHeal(oneStep({ action: 'fill', text: 'x', code: "page.getByRole('textbox', { name: 'Nope', exact: true })", locator: { strategy: 'role', role: 'textbox', name: 'Nope', exact: true } }),
    (prompt) => ({ action: 'click', box_id: boxFor(prompt, 'to basket'), text: null, confidence: 0.95, reason: 'a button' }));
  assert.match(r.results[0].error, /step is a "fill"/);
  ok('wrong kind of action (Muse says click, step says type): refused');
  r = await tryHeal(oneStep({ urlAfter: '/cart.html' }), (prompt) => ({ action: 'click', box_id: boxFor(prompt, 'to basket'), text: null, confidence: 0.95, reason: 'looks right' }));
  assert.match(r.results[0].error, /Rejecting the repair/);
  ok('the repaired step lands on a different page than before: refused');

  console.log('\nPhase 6 tests passed');
} catch (e) {
  console.error('\nPhase 6 test FAILED:', e.message);
  if (e.stack) console.error(e.stack.split('\n').filter((l) => l.includes('phase6-test')).slice(0, 2).join('\n'));
  process.exitCode = 1;
} finally {
  await session.close();
  plain.close();
  extra.forEach((s) => s.close());
  fake?.closeAllConnections?.();
  fake?.close();
}
