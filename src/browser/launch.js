// The ONE place a browser is launched. Every phase imports this.
// deviceScaleFactor is forced to 1 so that 1 screenshot pixel == 1 CSS pixel.
// That equality is what lets us later feed screenshot coordinates to document.elementFromPoint().
import { chromium } from 'playwright';
import { config } from '../../config/env.js';

export async function launchBrowser({ headless = config.headless, channel = config.browserChannel } = {}) {
  const options = { headless };
  if (channel) options.channel = channel;

  let browser;
  try {
    browser = await chromium.launch(options);
  } catch (err) {
    err.message += `\n\nHint: launch failed with channel="${channel || '(bundled chromium)'}". ` +
      'Set BROWSER_CHANNEL=msedge (or chrome) in .env to use a browser already installed on your PC.';
    throw err;
  }
  const context = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  return { browser, context, page, close: () => browser.close() };
}
