// TEST-ONLY helper. It asks the DOM where the interactive elements are.
// The real agent NEVER does this (it uses SAM). We use it in Phase 2 to get realistic boxes
// so we can test the overlay before SAM exists, and later as a ground-truth to grade SAM against.
export async function domOracleBoxes(page) {
  return page.evaluate(() => {
    const sel = 'a[href], button, input, select, textarea, [role="button"]';
    return [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height, label: (el.getAttribute('aria-label') || el.innerText || el.placeholder || '').trim().slice(0, 40) };
    }).filter(Boolean);
  });
}
