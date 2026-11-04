// The full loop, one goal at a time:  see (screenshot) -> find (SAM) -> decide (Muse) -> bridge (locator) -> act.
import { config } from '../../config/env.js';
import { captureScreen } from '../browser/capture.js';
import { discoverElements } from '../vision/discover.js';
import { renderSetOfMark } from '../vision/overlay.js';
import { chooseElement } from '../reasoning/choose.js';
import { bridge, buildLocator } from '../bridge/locatorBridge.js';
import { centerOf } from '../vision/boxes.js';
import { newDoc } from '../bridge/steps.js';

export async function recordFlow({ page, context, flow, baseUrl, discover = {}, muse = config.muse, log = () => {} }) {
  const doc = newDoc({ name: flow.name, start: flow.start, baseUrl });
  await page.goto(baseUrl + flow.start);
  const history = [];

  for (let i = 0; i < flow.goals.length; i++) {
    const goal = flow.goals[i];
    const label = `Step ${i + 1}/${flow.goals.length}`;
    const fail = (why) => { throw new Error(`${label} "${goal}": ${why}`); };

    const shot = await captureScreen(page);
    const { boxes, source } = await discoverElements({ page, screenshot: shot, ...discover });
    const overlay = await renderSetOfMark(context, shot.buffer, boxes);
    const decision = await chooseElement({ goal, boxes, overlay, history, muse });
    if (decision.action === 'not_found') fail(`Muse could not find a matching element. ${decision.reason}`);

    let br;
    try { br = await bridge(page, decision.box); } catch (e) { fail(`Muse picked box #${decision.box.id} but ${e.message}`); }

    const loc = buildLocator(page, br.spec);
    if (decision.action === 'click') await loc.click({ timeout: 5000 });
    else await loc.fill(decision.text, { timeout: 5000 });
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(150);

    doc.steps.push({
      id: i + 1,
      intent: goal,
      action: decision.action,
      ...(decision.action === 'fill' ? { text: decision.text } : {}),
      locator: br.spec,
      code: br.code,
      fragile: br.fragile,
      urlAfter: new URL(page.url()).pathname,
      evidence: {
        source, boxId: decision.box.id, box: { x: decision.box.x, y: decision.box.y, w: decision.box.w, h: decision.box.h },
        center: centerOf(decision.box), confidence: decision.confidence, reason: decision.reason,
        rejectedLocators: br.rejected.length,
      },
    });
    history.push(`${goal} (done)`);
    log({ label, goal, decision, code: br.code, fragile: br.fragile });
  }

  if (flow.expectUrl) {
    const now = new URL(page.url()).pathname;
    if (now !== flow.expectUrl) throw new Error(`Flow finished on ${now}, expected ${flow.expectUrl}`);
  }
  return doc;
}
