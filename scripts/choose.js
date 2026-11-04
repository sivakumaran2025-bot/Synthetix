// Full "see -> decide" demo on one page:
//   npm run choose -- products.html "Add the Trail Backpack to the cart"
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { captureScreen } from '../src/browser/capture.js';
import { discoverElements } from '../src/vision/discover.js';
import { renderSetOfMark } from '../src/vision/overlay.js';
import { chooseElement } from '../src/reasoning/choose.js';
import { centerOf } from '../src/vision/boxes.js';

const [pageName, ...goalWords] = process.argv.slice(2);
const goal = goalWords.join(' ');
if (!pageName || !goal) {
  console.log('Usage: npm run choose -- <page.html> "<goal>"\nExample: npm run choose -- products.html "Add the Trail Backpack to the cart"');
  process.exit(1);
}

const server = await startShopServer(0);
const session = await launchBrowser();
try {
  const { page, context } = session;
  await page.goto(`http://127.0.0.1:${server.address().port}/${pageName}`);
  const shot = await captureScreen(page);
  const { boxes, source } = await discoverElements({ page, screenshot: shot });
  const overlay = await renderSetOfMark(context, shot.buffer, boxes);
  console.log(`Page: ${pageName}\nGoal: ${goal}\nElements found: ${boxes.length} (source: ${source})\n`);

  const d = await chooseElement({ goal, boxes, overlay });
  console.log(`Muse decided:  action=${d.action}  box=${d.box ? '#' + d.box.id : 'none'}  confidence=${d.confidence}  (${(d.ms / 1000).toFixed(1)}s)`);
  if (d.text) console.log(`               type: "${d.text}"`);
  console.log(`               reason: ${d.reason}`);

  const base = `choose-${pageName.replace('.html', '')}`;
  fs.writeFileSync(path.join(config.artifactsDir, `${base}-all.png`), overlay);
  if (d.box) {
    fs.writeFileSync(path.join(config.artifactsDir, `${base}-picked.png`), await renderSetOfMark(context, shot.buffer, [d.box]));
    // Ground-truth check for YOUR information only. The agent never sees this.
    const c = centerOf(d.box);
    const real = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? `<${el.tagName.toLowerCase()}> ${el.getAttribute('aria-label') || (el.innerText || el.placeholder || '').trim().slice(0, 50)}` : 'nothing';
    }, c);
    console.log(`\nSanity check (DOM, for you only): the centre of that box (${c.x},${c.y}) is really -> ${real}`);
  }
  console.log(`\nSaved artifacts/${base}-all.png${d.box ? ` and artifacts/${base}-picked.png` : ''}`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  await session.close();
  server.close();
}
