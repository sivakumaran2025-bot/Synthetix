// Try the discovery layer on any shop page:  npm run discover -- login.html
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { captureScreen } from '../src/browser/capture.js';
import { discoverElements } from '../src/vision/discover.js';
import { renderSetOfMark } from '../src/vision/overlay.js';

const pageName = process.argv[2] || 'products.html';
const server = await startShopServer(0);
const session = await launchBrowser();
try {
  await session.page.goto(`http://127.0.0.1:${server.address().port}/${pageName}`);
  const shot = await captureScreen(session.page);
  const { boxes, source } = await discoverElements({ page: session.page, screenshot: shot });
  console.log(`Page: ${pageName}   Discovery source: ${source}   Elements found: ${boxes.length}\n`);
  console.log('  #   x     y     w     h    label');
  for (const b of boxes) console.log(`${String(b.id).padStart(3)} ${String(b.x).padStart(5)} ${String(b.y).padStart(5)} ${String(b.w).padStart(5)} ${String(b.h).padStart(5)}    ${b.label ?? ''}`);
  const base = `discover-${pageName.replace('.html', '')}`;
  fs.writeFileSync(path.join(config.artifactsDir, `${base}.png`), await renderSetOfMark(session.context, shot.buffer, boxes));
  fs.writeFileSync(path.join(config.artifactsDir, `${base}.json`), JSON.stringify(boxes, null, 2));
  console.log(`\nSaved artifacts/${base}.png and artifacts/${base}.json`);
} finally {
  await session.close();
  server.close();
}
