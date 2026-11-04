// Plain replay: runs the saved locators with NO AI at all. (Phase 6's Healer wraps this.)
import { buildLocator } from '../bridge/locatorBridge.js';

export async function runStep(page, step, { timeout = 5000 } = {}) {
  const loc = buildLocator(page, step.locator);
  if (step.action === 'click') await loc.click({ timeout });
  else await loc.fill(step.text, { timeout });
  await page.waitForLoadState('load').catch(() => {});
}

export async function replay(page, doc, { baseUrl = doc.baseUrl, beforeStep, stopOnFailure = true, timeout = 5000 } = {}) {
  await page.goto(baseUrl + doc.start);
  const results = [];
  for (let i = 0; i < doc.steps.length; i++) {
    const step = doc.steps[i];
    try {
      if (beforeStep) await beforeStep(page, step);
      await runStep(page, step, { timeout });
      results.push({ index: i, intent: step.intent, ok: true });
    } catch (e) {
      results.push({ index: i, intent: step.intent, ok: false, error: String(e.message).split('\n')[0] });
      if (stopOnFailure) break;
    }
  }
  return results;
}
