// npm run heal -- steps/buy-backpack.steps.json --mutation rename-text [--write]
// Replays the steps on a CHANGED copy of the shop; repairs broken locators with SAM + Muse; writes a patch.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { parseArgs } from './args.js';
import { ensureShop } from './server.js';
import { launchBrowser } from '../src/browser/launch.js';
import { loadDoc, saveDoc } from '../src/bridge/steps.js';
import { healFlow } from '../src/heal/healer.js';
import { unifiedDiff } from '../src/heal/diff.js';

const { positional, flags } = parseArgs(process.argv.slice(2), ['mutation']);
const file = positional[0];
if (!file) {
  console.log('Usage: npm run heal -- steps/buy-backpack.steps.json --mutation rename-text [--write]\nMutations: wrappers, hashed-classes, rename-text, all');
  process.exit(1);
}
const doc = loadDoc(file);
const rel = path.relative(config.root, path.resolve(file)).split(path.sep).join('/');
const rawText = fs.readFileSync(file, 'utf8');
const hasWindowsEndings = rawText.includes('\r\n');
const oldText = rawText.replace(/\r\n/g, '\n');
if (hasWindowsEndings) console.log('Note: this file uses Windows line endings (CRLF). The patch is written with Unix endings, so `git apply` may reject it. Use --write instead.\n');
else if (oldText !== JSON.stringify(doc, null, 2) + '\n') console.log('Note: this file was not written by Synthetix, so the patch is based on its normalised form.\n');

let shop;
try { shop = await ensureShop({ mutation: flags.mutation }); }
catch (e) { console.error(`ERROR: ${e.message}`); process.exit(1); }
const session = await launchBrowser();
try {
  console.log(`Healing "${doc.name}"${flags.mutation ? ` on a changed site (${flags.mutation})` : ''}\n`);
  const report = await healFlow({
    page: session.page, context: session.context, doc, baseUrl: shop.baseUrl,
    log: (r) => {
      const n = r.index + 1;
      if (r.status === 'passed') console.log(`  ✔ ${n}. ${r.intent}`);
      else if (r.status === 'healed') {
        console.log(`  ⚕ ${n}. ${r.intent}   HEALED (confidence ${r.confidence})`);
        console.log(`       was: ${r.oldCode}\n       now: ${r.newCode}`);
        console.log(`       why: ${r.reason}${r.fragile ? '\n       WARNING: the new locator is a fragile CSS fallback' : ''}`);
      } else {
        console.log(`  ✘ ${n}. ${r.intent}   COULD NOT HEAL\n       ${r.error}\n       (old locator failed with: ${r.oldError})`);
      }
    },
  });

  const healedCount = report.results.filter((r) => r.status === 'healed').length;
  const newText = JSON.stringify(report.healedDoc, null, 2) + '\n';
  const patch = unifiedDiff(JSON.stringify(doc, null, 2) + '\n', newText, { path: rel });
  fs.mkdirSync(path.join(config.root, 'patches'), { recursive: true });
  const base = path.basename(file).replace(/\.steps\.json$/, '').replace(/\.json$/, '');
  fs.writeFileSync(path.join(config.root, 'patches', `${base}.heal-report.json`), JSON.stringify(report.results, null, 2) + '\n');

  if (!report.ok) {
    console.log(`\nHealing STOPPED: ${healedCount} step(s) repaired before a step that could not be repaired.`);
    process.exitCode = 1;
  } else if (healedCount === 0) {
    console.log('\nNothing needed healing: every locator still works.');
  } else {
    console.log(`\nHealed ${healedCount} step(s).`);
  }
  if (patch && report.ok) {
    const patchFile = path.join(config.root, 'patches', `${base}.patch`);
    fs.writeFileSync(patchFile, patch);
    console.log(`Patch written: patches/${base}.patch   (apply it from the project folder with: git apply patches/${base}.patch  - or just add --write)\n`);
    console.log(patch);
    if (flags.write) { saveDoc(file, report.healedDoc); console.log(`Updated ${rel} in place (--write).`); }
    else console.log(`The steps file was NOT changed. Add --write to update it in place.`);
  }
} catch (e) {
  console.error('\nHEAL FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await session.close();
  shop.close();
}
