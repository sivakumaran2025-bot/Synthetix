// npm run replay -- steps/buy-backpack.steps.json     (no AI, no API calls: just the saved locators)
import { parseArgs } from './args.js';
import { ensureShop } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { loadDoc } from '../src/bridge/steps.js';
import { replay } from '../src/replay/replay.js';

const { positional, flags } = parseArgs(process.argv.slice(2), ['mutation']);
const file = positional[0];
if (!file) { console.log('Usage: npm run replay -- steps/buy-backpack.steps.json [--mutation rename-text]'); process.exit(1); }
const doc = loadDoc(file);
let shop;
try { shop = await ensureShop({ mutation: flags.mutation }); }
catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1); }
const session = await launchBrowser();
try {
  const results = await replay(session.page, doc, { baseUrl: shop.baseUrl });
  results.forEach((r) => console.log(`  ${r.ok ? '✔' : '✘'} ${r.index + 1}. ${r.intent}${r.ok ? '' : `\n       ${r.error}`}`));
  const failed = results.find((r) => !r.ok);
  if (failed || results.length < doc.steps.length) {
    console.log(`\nReplay FAILED at step ${(failed?.index ?? results.length) + 1}`);
    process.exitCode = 1;
  } else {
    console.log(`\nReplay passed (${results.length} steps, no AI used)`);
  }
} finally {
  await session.close();
  shop.close();
}
