// npm run record -- flows/buy-backpack.json        (real SAM + real Muse; writes steps/<name>.steps.json)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { ensureShop } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { recordFlow } from '../src/agent/record.js';
import { saveDoc } from '../src/bridge/steps.js';

const flowFile = process.argv[2];
if (!flowFile) { console.log('Usage: npm run record -- flows/buy-backpack.json'); process.exit(1); }
const flow = JSON.parse(fs.readFileSync(flowFile, 'utf8'));
const outFile = path.join(config.root, 'steps', `${flow.name}.steps.json`);

const shop = await ensureShop();
const session = await launchBrowser();
try {
  console.log(`Recording "${flow.name}" (${flow.goals.length} goals)\n`);
  const doc = await recordFlow({
    page: session.page, context: session.context, flow, baseUrl: shop.baseUrl,
    log: ({ label, goal, decision, code, fragile }) => {
      console.log(`${label}: ${goal}`);
      console.log(`   Muse: ${decision.action} box #${decision.box.id} (confidence ${decision.confidence}, answered in ${(decision.ms / 1000).toFixed(1)}s)`);
      console.log(`   Locator: ${code}${fragile ? '   <-- fragile (CSS fallback)' : ''}\n`);
    },
  });
  saveDoc(outFile, doc);
  console.log(`Recorded ${doc.steps.length} steps -> steps/${flow.name}.steps.json`);
  console.log(`Replay it with no AI:  npm run replay -- steps/${flow.name}.steps.json`);
} catch (e) {
  console.error('\nRECORDING FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await session.close();
  shop.close();
}
