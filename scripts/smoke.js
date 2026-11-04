// Drives a real browser through the whole shop flow using NORMAL Playwright locators.
// If this passes, the mock site is a trustworthy target for the agent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../src/browser/launch.js';
import { config } from '../config/env.js';
import { startShopServer } from './server.js';

fs.mkdirSync(config.artifactsDir, { recursive: true });
const server = await startShopServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const session = await launchBrowser();
const step = (m) => console.log(`  ✔ ${m}`);

try {
  const { page } = session;
  console.log('Running smoke flow...');

  await page.goto(`${base}/index.html`);
  await page.getByRole('link', { name: 'Shop now' }).click();
  await page.waitForURL('**/products.html');
  step('Home -> Products');

  await page.getByRole('button', { name: 'Add Trail Backpack to cart' }).click();
  assert.equal(await page.locator('#cart-count').textContent(), '1');
  step('Added Trail Backpack (badge = 1)');

  await page.getByRole('link', { name: /^Cart/ }).click();
  await page.waitForURL('**/cart.html');
  assert.equal(await page.locator('#cart-total').textContent(), '$59.00');
  step('Cart total = $59.00');

  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await page.waitForURL('**/checkout.html');
  await page.getByLabel('Full name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Shipping address').fill('12 Analytical St');
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForURL('**/confirmation.html');
  await page.getByRole('heading', { name: 'Thank you for your order!' }).waitFor();
  step('Checkout -> Confirmation');

  await page.screenshot({ path: path.join(config.artifactsDir, 'smoke-confirmation.png') });
  await page.goto(`${base}/products.html`);
  await page.screenshot({ path: path.join(config.artifactsDir, 'smoke-products-1280x800.png') });
  const size = page.viewportSize();
  assert.deepEqual(size, { width: 1280, height: 800 });
  step(`Screenshots saved to artifacts/ (viewport ${size.width}x${size.height})`);
  console.log('\nSmoke test passed');
} catch (e) {
  console.error('\nSmoke test FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await session.close();
  server.close();
}
