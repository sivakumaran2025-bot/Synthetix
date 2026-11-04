// Defines the "Box" contract used by every vision step:
//   { id, x, y, w, h, score?, label? }   (pixels, top-left origin, same space as the screenshot)
// SAM (Phase 3) will output messy boxes; normalizeBoxes() turns them into a clean numbered list.

export function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export function centerOf(box) {
  return { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) };
}

export function normalizeBoxes(raw, viewport, { minSize = 8, iouThreshold = 0.85, maxBoxes = 60 } = {}) {
  // 1. clamp to the viewport, drop invalid / tiny boxes
  const clamped = [];
  for (const r of raw) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) continue;
    const x1 = Math.max(0, r.x), y1 = Math.max(0, r.y);
    const x2 = Math.min(viewport.width, r.x + r.w), y2 = Math.min(viewport.height, r.y + r.h);
    const w = x2 - x1, h = y2 - y1;
    if (w < minSize || h < minSize) continue;
    clamped.push({ x: Math.round(x1), y: Math.round(y1), w: Math.round(w), h: Math.round(h), score: r.score ?? 1, label: r.label });
  }
  // 2. remove near-duplicates (keep the highest score, then the largest)
  clamped.sort((a, b) => b.score - a.score || b.w * b.h - a.w * a.h);
  const kept = [];
  for (const b of clamped) if (!kept.some((k) => iou(k, b) > iouThreshold)) kept.push(b);
  // 3. cap the count, then sort in reading order (top-to-bottom, left-to-right)
  const top = kept.slice(0, maxBoxes);
  top.sort((a, b) => Math.round(a.y / 20) - Math.round(b.y / 20) || a.x - b.x);
  // 4. number them 1..N
  return top.map((b, i) => ({ id: i + 1, ...b }));
}
