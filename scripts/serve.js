import { startShopServer } from './server.js';
import { config } from '../config/env.js';

startShopServer(config.port, { mutation: process.env.SHOP_MUTATION })
  .then(() => console.log(`Mock shop running at ${config.baseUrl}  (Ctrl+C to stop)`))
  .catch((e) => { console.error(`Could not start server: ${e.message}`); process.exit(1); });
