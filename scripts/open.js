// node scripts/open.js [page.html] [--mutation rename-text]
// Starts the shop AND opens it in a browser window that Playwright controls. No address to type.
// Close the window (or press Ctrl+C) to finish.
import { parseArgs } from './args.js';
import { ensureShop } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';

const { positional, flags } = parseArgs(process.argv.slice(2), ['mutation']);
const pageName = positional[0] || 'index.html';

let shop;
try { shop = await ensureShop({ mutation: flags.mutation }); }
catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1); }

const session = await launchBrowser({ headless: process.env.OPEN_HEADLESS === 'true' });
await session.page.goto(`${shop.baseUrl}/${pageName}`);
console.log(`Opened ${shop.baseUrl}/${pageName}${flags.mutation ? `  (changed site: ${flags.mutation})` : ''}`);
console.log('Click around in the window. Close the window, or press Ctrl+C here, to finish.');

await new Promise((resolve) => {
  session.browser.on('disconnected', resolve);
  process.on('SIGINT', resolve);
});
await session.close().catch(() => {});
shop.close();
console.log('Closed.');
