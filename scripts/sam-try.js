// Try any noun phrases on any shop page with the REAL SAM, and see what it finds.
//   node scripts/sam-try.js products.html "search box" "navigation link" "text"
// Each phrase is its own request (SAM 3.1 takes one noun phrase per request).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { captureScreen } from '../src/browser/capture.js';
import { callSam } from '../src/vision/samClient.js';
import { normalizeBoxes } from '../src/vision/boxes.js';
import { renderSetOfMark } from '../src/vision/overlay.js';

const [pageName, ...phrases] = process.argv.slice(2);
if (!pageName || phrases.length === 0) {
  console.log('Usage: node scripts/sam-try.js <page.html> "<phrase 1>" "<phrase 2>" ...');
  process.exit(1);
}
if (!config.sam.key) { console.error('No key found. Put MODEL_API_KEY=... in .env first.'); process.exit(1); }

const server = await startShopServer(0);
const session = await launchBrowser();
try {
  await session.page.goto(`http://127.0.0.1:${server.address().port}/${pageName}`);
  const shot = await captureScreen(session.page);
  console.log(`Page: ${pageName}\n`);
  const all = [];
  for (const phrase of phrases) {               // one at a time so each result is easy to read
    const raw = await callSam(shot.buffer, { ...config.sam, concepts: [phrase] }, { saveRaw: false });
    console.log(`"${phrase}" -> ${raw.length} match(es)`);
    for (const b of raw) console.log(`     x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.w)} h=${Math.round(b.h)} confidence=${b.score}`);
    all.push(...raw);
  }
  const boxes = normalizeBoxes(all, config.viewport);
  const file = `sam-try-${pageName.replace('.html', '')}.png`;
  fs.writeFileSync(path.join(config.artifactsDir, file), await renderSetOfMark(session.context, shot.buffer, boxes));
  console.log(`\n${boxes.length} box(es) after cleanup. Picture saved: artifacts/${file}`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  await session.close();
  server.close();
}
