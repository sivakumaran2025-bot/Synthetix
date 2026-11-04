// Layer 2a: "what clickable things are on screen?"  Returns clean numbered boxes.
// mode 'sam'  = ask SAM.   mode 'dom' = read the DOM (stand-in while you have no SAM access).
// mode 'auto' = SAM when URL+key are set, otherwise DOM; if SAM errors, DOM.
import { config } from '../../config/env.js';
import { normalizeBoxes } from './boxes.js';
import { callSam } from './samClient.js';
import { domOracleBoxes } from './domOracle.js';

export async function discoverElements({ page, screenshot, mode = config.discoveryMode, sam = config.sam, log = console.warn }) {
  const viewport = config.viewport;
  let chosen = mode;
  if (mode === 'auto') chosen = sam.url && sam.key ? 'sam' : 'dom';

  if (chosen === 'sam') {
    try {
      const raw = await callSam(screenshot.buffer, sam, { viewport });
      if (raw.length === 0 && mode === 'auto') throw new Error('SAM found no elements');
      return { source: 'sam', boxes: normalizeBoxes(raw, viewport), rawCount: raw.length };
    } catch (e) {
      if (mode === 'sam') throw e;
      log(`  ! SAM failed (${e.message}). Falling back to DOM discovery.`);
    }
  }
  const raw = await domOracleBoxes(page);
  return { source: 'dom', boxes: normalizeBoxes(raw, viewport), rawCount: raw.length };
}
