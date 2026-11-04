// Offline structural check: every page exists, every local href/src resolves,
// and the server really serves them (200) and blocks path traversal.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';

const PAGES = ['index', 'products', 'cart', 'checkout', 'confirmation', 'login'].map((p) => `${p}.html`);
let failed = false;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { console.log(`  ✘ ${m}`); failed = true; };

console.log('Checking mock site files...');
for (const page of PAGES) {
  const file = path.join(config.shopDir, page);
  if (!fs.existsSync(file)) { bad(`${page} missing`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|mailto:)/.test(r));
  const broken = refs.filter((r) => !fs.existsSync(path.join(config.shopDir, r)));
  broken.length ? bad(`${page} has broken refs: ${broken.join(', ')}`) : ok(`${page} (${refs.length} local refs OK)`);
}

console.log('Checking HTTP server...');
const server = await startShopServer(0).catch((e) => { bad(`server failed: ${e.message}`); return null; });
if (server) {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const page of [...PAGES, 'css/style.css', 'js/app.js']) {
    const r = await fetch(`${base}/${page}`);
    r.status === 200 ? ok(`GET /${page} -> 200`) : bad(`GET /${page} -> ${r.status}`);
  }
  const nf = await fetch(`${base}/nope.html`);
  nf.status === 404 ? ok('GET /nope.html -> 404') : bad(`missing page returned ${nf.status}`);
  const net = await import('node:net');
  const raw = await new Promise((resolve) => {
    const s = net.connect(server.address().port, '127.0.0.1', () => s.write('GET /../.env HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let buf = ''; s.on('data', (d) => (buf += d)); s.on('close', () => resolve(buf));
  });
  /HTTP\/1\.1 (403|404)/.test(raw) ? ok('path traversal blocked') : bad('path traversal NOT blocked');
  server.close();
}
if (failed) { console.log('\nSite check FAILED'); process.exit(1); }
console.log('\nSite check passed');
