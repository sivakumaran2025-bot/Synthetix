import { config } from '../../config/env.js';
import { startShopServer } from '../../scripts/server.js';
import { replay } from '../replay/replay.js';
import { healFlow } from '../heal/healer.js';
import { ARMS } from './arms.js';

export const EXPECTED_TOTAL = 59; // one Trail Backpack. Anything else means the test "passed" but bought the wrong thing.

export const SCENARIOS = [
  { id: 'control', label: 'Control (no change)', mutation: [] },
  { id: 'wrappers', label: 'Layout wrappers', mutation: ['wrappers'] },
  { id: 'hashed-classes', label: 'Hashed CSS classes', mutation: ['hashed-classes'] },
  { id: 'reorder', label: 'Reordered products', mutation: ['reorder-products'] },
  { id: 'rename-text', label: 'Renamed wording', mutation: ['rename-text'] },
  { id: 'everything', label: 'Everything at once', mutation: ['wrappers', 'hashed-classes', 'rename-text', 'reorder-products'] },
];

const firstLine = (e) => String(e.message).split('\n')[0];

async function runSelectorArm(page, arm, baseUrl, timeout) {
  await page.goto(baseUrl + '/index.html');
  let passed = 0;
  for (const s of arm.steps) {
    try {
      const loc = s.locate(page);
      if (s.action === 'click') await loc.click({ timeout });
      else await loc.fill(s.text, { timeout });
      await page.waitForLoadState('load').catch(() => {});
      passed++;
    } catch (e) {
      return { passed, total: arm.steps.length, failedAt: passed + 1, error: firstLine(e) };
    }
  }
  return { passed, total: arm.steps.length, failedAt: null };
}

// Did the flow really buy ONE Trail Backpack? (A test can run without errors and still do the wrong thing.)
async function readOutcome(page) {
  return page.evaluate(() => {
    let order = null;
    try { order = JSON.parse(localStorage.getItem('synthetix_order')); } catch { /* none */ }
    return { path: location.pathname, total: order ? order.total : null };
  });
}

export async function runOnce({ armId, browser, baseUrl, doc, timeout, muse, discover, onPage }) {
  const context = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  if (onPage) onPage(page);
  const started = Date.now();
  let r;
  let healed = 0;
  try {
    if (ARMS[armId]) {
      r = await runSelectorArm(page, ARMS[armId], baseUrl, timeout);
    } else if (armId === 'synthetix') {
      const res = await replay(page, doc, { baseUrl, timeout });
      const bad = res.find((x) => !x.ok);
      r = { passed: res.filter((x) => x.ok).length, total: doc.steps.length, failedAt: bad ? bad.index + 1 : (res.length < doc.steps.length ? res.length + 1 : null), error: bad?.error };
    } else if (armId === 'heal') {
      const rep = await healFlow({ page, context, doc, baseUrl, discover, muse, timeout });
      const bad = rep.results.find((x) => x.status === 'unhealable');
      healed = rep.results.filter((x) => x.status === 'healed').length;
      r = { passed: rep.results.filter((x) => x.status !== 'unhealable').length, total: doc.steps.length, failedAt: bad ? bad.index + 1 : null, error: bad?.error };
    } else throw new Error(`Unknown arm ${armId}`);

    let verdict = 'fail';
    let outcome = null;
    if (r.failedAt === null) {
      outcome = await readOutcome(page);
      verdict = outcome.path === '/confirmation.html' && Math.abs((outcome.total ?? -1) - EXPECTED_TOTAL) < 0.001 ? 'pass' : 'wrong-result';
    }
    return { verdict, passed: r.passed, total: r.total, failedAt: r.failedAt, error: r.error ?? null, healed, outcome, ms: Date.now() - started };
  } catch (e) {
    return { verdict: 'fail', passed: 0, total: doc?.steps?.length ?? 9, failedAt: 1, error: firstLine(e), healed, outcome: null, ms: Date.now() - started };
  } finally {
    await context.close();
  }
}

export async function runBenchmark({ browser, doc, arms, scenarios = SCENARIOS, timeout = 2000, runs = 1, muse, discover = {}, onPage, log = () => {} }) {
  const results = [];
  for (const sc of scenarios) {
    const server = await startShopServer(0, { mutation: sc.mutation });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const armId of arms) {
        const n = armId === 'heal' ? runs : 1; // only the AI arm can vary from run to run
        const list = [];
        for (let i = 0; i < n; i++) list.push(await runOnce({ armId, browser, baseUrl, doc, timeout, muse, discover, onPage }));
        const cell = { scenario: sc.id, arm: armId, runs: list };
        results.push(cell);
        log(cell);
      }
    } finally {
      server.close();
    }
  }
  return results;
}
