import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { captureScreen, countDifferentPixels } from '../src/browser/capture.js';
import { normalizeBoxes, centerOf, iou } from '../src/vision/boxes.js';
import { renderSetOfMark } from '../src/vision/overlay.js';
import { domOracleBoxes } from '../src/vision/domOracle.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const out = (f) => path.join(config.artifactsDir, f);
const vp = config.viewport;

console.log('Test 1: pure logic (no browser)');
{
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), 1);
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 }), 0);
  ok('iou() works');

  const messy = [
    { x: 100, y: 300, w: 100, h: 40, score: 0.9 },
    { x: 101, y: 301, w: 100, h: 40, score: 0.5 },   // near-duplicate -> removed
    { x: 10, y: 10, w: 3, h: 3, score: 0.9 },         // too tiny -> removed
    { x: 1200, y: 760, w: 300, h: 300, score: 0.8 },  // sticks out -> clamped
    { x: 50, y: 50, w: 120, h: 40, score: 0.7 },
    { x: NaN, y: 0, w: 5, h: 5 },                     // invalid -> removed
  ];
  const clean = normalizeBoxes(messy, vp);
  assert.equal(clean.length, 3);
  assert.deepEqual(clean.map((b) => b.id), [1, 2, 3]);
  assert.deepEqual(clean[0], { id: 1, x: 50, y: 50, w: 120, h: 40, score: 0.7, label: undefined });
  const edge = clean.find((b) => b.x === 1200);
  assert.equal(edge.x + edge.w, vp.width);
  assert.equal(edge.y + edge.h, vp.height);
  ok('normalizeBoxes: clamps, dedups, drops tiny/invalid, numbers in reading order');
  assert.deepEqual(centerOf({ x: 100, y: 100, w: 50, h: 20 }), { x: 125, y: 110 });
  ok('centerOf() works');
}

console.log('Test 2: browser capture + overlay');
const server = await startShopServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const session = await launchBrowser();
try {
  const { page, context } = session;
  await page.goto(`${base}/products.html`);
  const shot = await captureScreen(page, { savePath: out('phase2-raw-products.png') });
  assert.equal(shot.width, 1280);
  assert.equal(shot.height, 800);
  ok(`captureScreen -> ${shot.width}x${shot.height} PNG (${shot.buffer.length} bytes)`);

  const shot2 = await captureScreen(page);
  const diff = await countDifferentPixels(context, shot.buffer, shot2.buffer);
  assert.ok(diff >= 0 && diff <= 100, `two captures of an unchanged page differ in ${diff} pixels (more than anti-aliasing noise)`);
  ok(`two captures of an unchanged page differ in only ${diff} of ${shot.width * shot.height} pixels (anti-aliasing noise)`);

  const handmade = normalizeBoxes([
    { x: 133, y: 499, w: 210, h: 42 }, { x: 401, y: 499, w: 210, h: 42 },
    { x: 114, y: 164, w: 320, h: 40 }, { x: 5, y: 5, w: 100, h: 14 },
  ], vp);
  const som1 = await renderSetOfMark(context, shot.buffer, handmade);
  fs.writeFileSync(out('phase2-som-handmade.png'), som1);
  assert.equal((await import('../src/browser/capture.js')).pngSize(som1).width, 1280);
  assert.ok(!som1.equals(shot.buffer), 'the overlay image is identical to the raw screenshot: no boxes were drawn');
  ok('overlay with hand-made boxes rendered (artifacts/phase2-som-handmade.png)');

  const boxes = normalizeBoxes(await domOracleBoxes(page), vp);
  assert.ok(boxes.length >= 8, `expected >= 8 boxes, got ${boxes.length}`);
  const som2 = await renderSetOfMark(context, shot.buffer, boxes);
  fs.writeFileSync(out('phase2-som-products.png'), som2);
  ok(`overlay with ${boxes.length} DOM-derived boxes rendered (artifacts/phase2-som-products.png)`);

  fs.writeFileSync(out('phase2-boxes-products.json'), JSON.stringify(boxes, null, 2));
  ok('box list saved (artifacts/phase2-boxes-products.json)');

  // The key Phase-5 idea, proven early: a box centre maps back to the right DOM element.
  const bagBox = boxes.find((b) => b.label === 'Add Trail Backpack to cart');
  const c = centerOf(bagBox);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('aria-label'), c);
  assert.equal(hit, 'Add Trail Backpack to cart');
  ok(`pixel (${c.x},${c.y}) -> elementFromPoint -> "${hit}"  (coordinate space is correct)`);

  console.log('\nPhase 2 tests passed');
} catch (e) {
  console.error('\nPhase 2 test FAILED:', e.message);
  if (e.stack) console.error(e.stack.split('\n').filter((l) => l.includes('phase2-test')).slice(0, 2).join('\n'));
  process.exitCode = 1;
} finally {
  await session.close();
  server.close();
}
