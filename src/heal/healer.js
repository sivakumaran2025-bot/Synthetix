// The Healer: replays a steps file. When a locator no longer works, it looks at the page again (screenshot ->
// SAM -> Muse), finds the element by the step's INTENT, and proposes a replacement locator.
// It refuses to "heal" when it is not sure: a wrong repair is worse than a failing test.
import { config } from '../../config/env.js';
import { runStep } from '../replay/replay.js';
import { captureScreen } from '../browser/capture.js';
import { discoverElements } from '../vision/discover.js';
import { renderSetOfMark } from '../vision/overlay.js';
import { chooseElement } from '../reasoning/choose.js';
import { bridge, buildLocator } from '../bridge/locatorBridge.js';

const firstLine = (e) => String(e.message).split('\n')[0];

async function healStep({ page, context, step, history, discover, muse, minConfidence, timeout }) {
  const refuse = (why) => ({ ok: false, error: why });
  const shot = await captureScreen(page);
  const { boxes, source } = await discoverElements({ page, screenshot: shot, ...discover });
  const overlay = await renderSetOfMark(context, shot.buffer, boxes);
  const decision = await chooseElement({ goal: step.intent, boxes, overlay, history, muse });

  if (decision.action === 'not_found') return refuse(`Muse could not find "${step.intent}" on the page. ${decision.reason}`);
  if (decision.action !== step.action) return refuse(`Muse wants to "${decision.action}" but this step is a "${step.action}". Not guessing.`);
  if (decision.confidence < minConfidence) return refuse(`Muse is only ${decision.confidence} sure (minimum ${minConfidence}). Not guessing. ${decision.reason}`);

  let br;
  try { br = await bridge(page, decision.box); } catch (e) { return refuse(`Muse picked box #${decision.box.id} but ${e.message}`); }
  if (br.code === step.code) return refuse('The new locator is identical to the broken one, so the locator is not the problem (element hidden or disabled?).');

  const loc = buildLocator(page, br.spec);
  if (step.action === 'click') await loc.click({ timeout });
  else await loc.fill(step.text, { timeout }); // always the ORIGINAL text, never one Muse invented
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(150);

  const now = new URL(page.url()).pathname;
  if (step.urlAfter && now !== step.urlAfter) return refuse(`After using the new locator the page is ${now}, but this step used to end on ${step.urlAfter}. Rejecting the repair.`);
  return { ok: true, spec: br.spec, code: br.code, fragile: br.fragile, confidence: decision.confidence, reason: decision.reason, source, ms: decision.ms };
}

export async function healFlow({ page, context, doc, baseUrl, discover = {}, muse = config.muse, minConfidence = 0.6, timeout = 2500, log = () => {} }) {
  await page.goto(baseUrl + doc.start);
  const healed = structuredClone(doc);
  const results = [];
  const history = [];

  for (let i = 0; i < healed.steps.length; i++) {
    const step = healed.steps[i];
    let oldError;
    try {
      await runStep(page, step, { timeout });
      results.push({ index: i, intent: step.intent, status: 'passed' });
      history.push(`${step.intent} (done)`);
      log(results[results.length - 1]);
      continue;
    } catch (e) { oldError = firstLine(e); }

    let r;
    try { r = await healStep({ page, context, step, history, discover, muse, minConfidence, timeout }); }
    catch (e) { r = { ok: false, error: firstLine(e) }; }

    if (!r.ok) {
      results.push({ index: i, intent: step.intent, status: 'unhealable', error: r.error, oldError, oldCode: step.code });
      log(results[results.length - 1]);
      return { ok: false, results, healedDoc: healed };
    }
    results.push({ index: i, intent: step.intent, status: 'healed', oldCode: step.code, newCode: r.code, confidence: r.confidence, reason: r.reason, fragile: r.fragile, oldError });
    step.locator = r.spec;
    step.code = r.code;
    history.push(`${step.intent} (done)`);
    log(results[results.length - 1]);
  }
  return { ok: true, results, healedDoc: healed };
}
