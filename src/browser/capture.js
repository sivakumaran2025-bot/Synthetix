// Layer 1 of the loop: take a deterministic screenshot of what the user would see.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/env.js';

// PNG header: bytes 16-19 = width, 20-23 = height (big-endian).
export function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export async function captureScreen(page, { savePath } = {}) {
  await page.waitForLoadState('load');
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
  // The pointer stays where the last click left it. Park it in the corner so no button shows its hover colour.
  await page.mouse.move(0, 0);

  const shoot = () => page.screenshot({
    type: 'png',
    animations: 'disabled', // freeze CSS animations so two captures look identical
    caret: 'hide',          // hide the blinking text cursor
    scale: 'css',           // 1 pixel per CSS pixel
  });
  // Keep shooting until THREE consecutive frames are identical (about 0.3 s of stillness), i.e. the page has
  // finished painting: late fonts, emoji glyphs, images. Gives up after a while so a page that never settles
  // (for example a looping video) still returns something.
  let buffer = await shoot();
  let identical = 0;
  for (let i = 0; i < 20 && identical < 2; i++) {
    await page.waitForTimeout(100);
    const next = await shoot();
    identical = next.equals(buffer) ? identical + 1 : 0;
    buffer = next;
  }

  const { width, height } = pngSize(buffer);
  const { viewport } = config;
  if (width !== viewport.width || height !== viewport.height) {
    throw new Error(`Screenshot is ${width}x${height}, expected ${viewport.width}x${viewport.height}`);
  }
  if (savePath) {
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buffer);
  }
  return { buffer, base64: buffer.toString('base64'), width, height };
}

// Counts pixels that differ between two PNGs (-1 if their sizes differ). Chromium's anti-aliasing on rounded
// corners is not perfectly repeatable (a handful of pixels now and then), so "same picture" means "almost
// the same pixels", never "same bytes".
export async function countDifferentPixels(context, a, b) {
  const page = await context.newPage();
  const url = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  try {
    return await page.evaluate(async ({ a, b }) => {
      const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return -1;
      const px = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const da = px(ia), db = px(ib);
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) n++;
      return n;
    }, { a: url(a), b: url(b) });
  } finally {
    await page.close();
  }
}
