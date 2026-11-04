import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../config/env.js';

let failed = false;
const ok = (m) => console.log(`  ✔ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const bad = (m) => { console.log(`  ✘ ${m}`); failed = true; };

console.log('Checking environment...');
const major = Number(process.versions.node.split('.')[0]);
major >= 18 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} is too old (need >= 18)`);
fs.existsSync(path.join(ROOT, '.env')) ? ok('.env file found') : bad('.env missing (run: cp .env.example .env)');
config.port > 0 && config.port < 65536 ? ok(`MOCK_SHOP_PORT = ${config.port}`) : bad('MOCK_SHOP_PORT invalid');
config.viewport.width === 1280 && config.viewport.height === 800
  ? ok('Viewport 1280x800')
  : warn(`Viewport is ${config.viewport.width}x${config.viewport.height} (project spec is 1280x800)`);
config.sam.key ? ok('Meta API key set (MODEL_API_KEY)') : warn('MODEL_API_KEY empty -> discovery will use the DOM fallback');
ok(`SAM endpoint = ${config.sam.url}  model = ${config.sam.model}`);
ok(`Muse model = ${config.muse.model}`);
ok(`SAM concepts = ${config.sam.concepts.join(' | ')}`);

if (failed) { console.log('\nEnvironment check FAILED'); process.exit(1); }
console.log('\nEnvironment check passed');
