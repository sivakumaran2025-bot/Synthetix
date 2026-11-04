// Layer 4: the Locator Bridge.
// Input : a box (pixels) chosen from the screenshot.
// Output: a clean, stable, SEMANTIC Playwright locator for the element under that box.
// The page is asked about the pixel exactly once (document.elementFromPoint); every locator we propose is
// then verified: it must match exactly ONE element, and that element must be the one under the box.
import { centerOf } from '../vision/boxes.js';

export class BridgeError extends Error {}

export const INTERACTIVE_SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
  '[role="menuitem"]', '[role="switch"]', '[role="textbox"]', '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Runs INSIDE the page. Self-contained on purpose (Playwright serialises it).
function describePoint({ x, y, sel }) {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return { found: false, reason: 'nothing is rendered at this point' };
  const el = hit.closest(sel); // the click may land on a <span> inside a <button>: climb to the control
  if (!el) return { found: false, reason: `no interactive element at this point (found a <${hit.tagName.toLowerCase()}>)` };
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const txt = (n) => ((n && (n.innerText || n.textContent)) || '').replace(/\s+/g, ' ').trim();

  let role = el.getAttribute('role');
  if (!role) {
    if (tag === 'button') role = 'button';
    else if (tag === 'a') role = 'link';
    else if (tag === 'select') role = 'combobox';
    else if (tag === 'textarea') role = 'textbox';
    else if (tag === 'input') {
      const map = { button: 'button', submit: 'button', reset: 'button', checkbox: 'checkbox', radio: 'radio', search: 'searchbox', range: 'slider', number: 'spinbutton' };
      if (map[type]) role = map[type];
      else if (['', 'text', 'email', 'tel', 'url'].includes(type)) role = 'textbox'; // password has NO ARIA role
    }
  }
  let label = null;
  if (el.labels && el.labels.length) label = [...el.labels].map(txt).join(' ').trim() || null;
  let name = el.getAttribute('aria-label');
  if (!name) {
    const by = el.getAttribute('aria-labelledby');
    if (by) name = by.split(/\s+/).map((id) => txt(document.getElementById(id))).join(' ').trim();
  }
  if (!name && label) name = label;
  if (!name && (tag === 'button' || tag === 'a' || role === 'button' || role === 'link')) name = txt(el);
  if (!name && tag === 'input' && ['button', 'submit', 'reset'].includes(type)) name = el.value;
  if (!name) name = el.getAttribute('title') || '';
  return {
    found: true, tag, type, role: role || null, name: name || null, label,
    placeholder: el.getAttribute('placeholder') || null,
    text: tag === 'a' || tag === 'button' ? txt(el) || null : null,
    testid: el.getAttribute('data-testid') || null,
    id: el.id || null,
    nameAttr: el.getAttribute('name') || null,
  };
}

// Most stable first. CSS is the last resort and is flagged as fragile.
export function candidatesFor(d) {
  const out = [];
  if (d.role && d.name) {
    // Counters such as the "(2)" in "Cart (2)" change from run to run. Prefer the stable part of the name.
    const stable = d.name.replace(/\s*[(\[]\s*\d+\s*[)\]]/g, '').trim();
    if (stable && stable !== d.name) out.push({ strategy: 'role', role: d.role, name: stable, exact: false });
    out.push({ strategy: 'role', role: d.role, name: d.name, exact: true });
    out.push({ strategy: 'role', role: d.role, name: d.name, exact: false });
  }
  if (d.label && ['input', 'select', 'textarea'].includes(d.tag)) out.push({ strategy: 'label', text: d.label, exact: true });
  if (d.placeholder) out.push({ strategy: 'placeholder', text: d.placeholder, exact: true });
  if (d.text) out.push({ strategy: 'text', text: d.text, exact: true });
  if (d.testid) out.push({ strategy: 'testid', id: d.testid });
  if (d.id) out.push({ strategy: 'css', selector: `[id="${d.id}"]` });
  if (d.nameAttr) out.push({ strategy: 'css', selector: `${d.tag}[name="${d.nameAttr}"]` });
  return out;
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function specToCode(spec) {
  switch (spec.strategy) {
    case 'role': return `page.getByRole(${q(spec.role)}, { name: ${q(spec.name)}${spec.exact ? ', exact: true' : ''} })`;
    case 'label': return `page.getByLabel(${q(spec.text)}${spec.exact ? ', { exact: true }' : ''})`;
    case 'placeholder': return `page.getByPlaceholder(${q(spec.text)}${spec.exact ? ', { exact: true }' : ''})`;
    case 'text': return `page.getByText(${q(spec.text)}${spec.exact ? ', { exact: true }' : ''})`;
    case 'testid': return `page.getByTestId(${q(spec.id)})`;
    case 'css': return `page.locator(${q(spec.selector)})`;
    default: throw new Error(`Unknown locator strategy: ${spec.strategy}`);
  }
}

export function buildLocator(page, spec) {
  switch (spec.strategy) {
    case 'role': return page.getByRole(spec.role, { name: spec.name, ...(spec.exact ? { exact: true } : {}) });
    case 'label': return page.getByLabel(spec.text, spec.exact ? { exact: true } : {});
    case 'placeholder': return page.getByPlaceholder(spec.text, spec.exact ? { exact: true } : {});
    case 'text': return page.getByText(spec.text, spec.exact ? { exact: true } : {});
    case 'testid': return page.getByTestId(spec.id);
    case 'css': return page.locator(spec.selector);
    default: throw new Error(`Unknown locator strategy: ${spec.strategy}`);
  }
}

async function isTarget(page, spec, point) {
  const loc = buildLocator(page, spec);
  const n = await loc.count();
  if (n !== 1) return { ok: false, why: `matches ${n} elements` };
  const handle = await page.evaluateHandle(({ x, y, sel }) => {
    const h = document.elementFromPoint(x, y);
    return h ? h.closest(sel) : null;
  }, { ...point, sel: INTERACTIVE_SELECTOR });
  try {
    const same = await loc.evaluate((el, target) => el === target, handle);
    return same ? { ok: true } : { ok: false, why: 'matches a different element' };
  } finally {
    await handle.dispose();
  }
}

export async function bridge(page, box) {
  const point = centerOf(box);
  const descriptor = await page.evaluate(describePoint, { ...point, sel: INTERACTIVE_SELECTOR });
  if (!descriptor.found) throw new BridgeError(`At (${point.x}, ${point.y}): ${descriptor.reason}`);
  const rejected = [];
  for (const spec of candidatesFor(descriptor)) {
    const r = await isTarget(page, spec, point);
    if (r.ok) return { spec, code: specToCode(spec), descriptor, point, rejected, fragile: spec.strategy === 'css' };
    rejected.push({ code: specToCode(spec), why: r.why });
  }
  throw new BridgeError(`Found a <${descriptor.tag}> at (${point.x}, ${point.y}) but could not build a unique locator. Tried: ` +
    (rejected.map((r) => `${r.code} (${r.why})`).join('; ') || 'nothing (the element has no role, name, label or text)'));
}
