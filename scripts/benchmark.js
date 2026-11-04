// npm run benchmark                  free: CSS, XPath, hand-written semantic, Synthetix replay
// npm run benchmark -- --heal        adds Synthetix + Healer with the REAL SAM + Muse (costs API calls)
// Options: --steps <file>  --runs <n> (repeats for the AI arm)  --only control,rename-text
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { parseArgs } from './args.js';
import { launchBrowser } from '../src/browser/launch.js';
import { loadDoc } from '../src/bridge/steps.js';
import { runBenchmark, SCENARIOS } from '../src/bench/runner.js';
import { ARM_LABELS } from '../src/bench/arms.js';
import { cellText, renderMarkdown, scoreOf } from '../src/bench/report.js';

const { flags } = parseArgs(process.argv.slice(2), ['steps', 'runs', 'only']);
const real = path.join(config.root, 'steps', 'buy-backpack.steps.json');
const sample = path.join(config.root, 'steps', 'offline-sample.steps.json');
const stepsFile = flags.steps ?? (fs.existsSync(real) ? real : sample);
const doc = loadDoc(stepsFile);
const arms = ['css', 'xpath', 'semantic', 'synthetix', ...(flags.heal ? ['heal'] : [])];
const runs = Math.max(1, Number(flags.runs) || 1);
let scenarios = SCENARIOS;
if (flags.only) {
  const want = String(flags.only).split(',');
  const bad = want.filter((w) => !SCENARIOS.some((s) => s.id === w));
  if (bad.length) { console.error(`ERROR: unknown scenario "${bad[0]}". Choose from: ${SCENARIOS.map((s) => s.id).join(', ')}`); process.exit(1); }
  scenarios = SCENARIOS.filter((s) => want.includes(s.id));
}
if (flags.heal && !config.muse.key) { console.error('ERROR: --heal needs your Meta key. Put it in MODEL_API_KEY in .env.'); process.exit(1); }

console.log(`Benchmark: ${scenarios.length} scenarios x ${arms.length} approaches${flags.heal ? ` (AI arm: ${runs} run(s) each)` : ''}`);
console.log(`Synthetix steps file: ${path.relative(config.root, stepsFile)}${stepsFile === sample ? '   (offline sample; record your own with npm run record)' : ''}\n`);

const session = await launchBrowser();
try {
  const results = await runBenchmark({
    browser: session.browser, doc, arms, scenarios, runs,
    log: (c) => console.log(`  ${(SCENARIOS.find((s) => s.id === c.scenario).label).padEnd(22)} ${ARM_LABELS[c.arm].padEnd(52)} ${cellText(c)}`),
  });
  const md = renderMarkdown(results, { stepsFile: path.relative(config.root, stepsFile) });
  fs.mkdirSync(path.join(config.root, 'benchmark'), { recursive: true });
  fs.writeFileSync(path.join(config.root, 'benchmark', 'results.md'), md);
  fs.writeFileSync(path.join(config.root, 'benchmark', 'results.json'), JSON.stringify({ stepsFile: path.relative(config.root, stepsFile), generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
  console.log('\nScores (scenarios passed with the correct result):');
  for (const a of arms) { const s = scoreOf(results, a); console.log(`  ${ARM_LABELS[a].padEnd(52)} ${s.pass}/${s.total}`); }
  console.log('\nSaved benchmark/results.md (paste it into your submission) and benchmark/results.json');
} catch (e) {
  console.error('\nBENCHMARK FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await session.close();
}
