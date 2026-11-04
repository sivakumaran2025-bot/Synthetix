// Tiny zero-dependency static file server for the mock shop.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { pageMutator, parseMutations } from '../src/mutations/pageMutator.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createShopServer(rootDir = config.shopDir, { mutation = [] } = {}) {
  const root = path.resolve(rootDir);
  const mutations = parseMutations(mutation);
  const mutatorJs = `(${pageMutator.toString()})(${JSON.stringify(mutations)});`;
  const inject = `<script src="/__mutate.js"></script>`;
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (mutations.length && rel === '/__mutate.js') {
        res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
        res.end(mutatorJs);
        return;
      }
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.resolve(root, '.' + rel);
      // Block path traversal (e.g. /../.env)
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        if (mutations.length && path.extname(file) === '.html') {
          res.end(data.toString('utf8').replace('</body>', `${inject}\n</body>`)); // after app.js, so it runs last
        } else {
          res.end(data);
        }
      });
    } catch {
      res.writeHead(400).end('Bad request');
    }
  });
}

export function startShopServer(port = config.port, options = {}) {
  return new Promise((resolve, reject) => {
    const server = createShopServer(config.shopDir, options);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// Start the shop on the configured port, or reuse it if `npm run serve` is already running.
// With a mutation switched on we always start our own private copy on a free port.
export async function ensureShop({ port = config.port, mutation = [] } = {}) {
  if (parseMutations(mutation).length) {
    const server = await startShopServer(0, { mutation });
    return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const server = await startShopServer(port);
    return { baseUrl, close: () => server.close() };
  } catch (e) {
    if (e.code === 'EADDRINUSE') return { baseUrl, close: () => {} };
    throw e;
  }
}
