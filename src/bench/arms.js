// The competitors. Each "arm" is the SAME 9-step checkout flow written a different way.
// The selector arms are written the way developers really write them (DevTools "Copy selector" / "Copy XPath"
// and Playwright's recommended getByRole), NOT deliberately sabotaged.
const S = (action, intent, locate, text) => ({ action, intent, locate, ...(text ? { text } : {}) });

export const ARMS = {
  css: {
    label: 'CSS selectors (DevTools "Copy selector")',
    steps: [
      S('click', 'Shop now', (p) => p.locator('main > section.hero > a.btn')),
      S('click', 'Add Trail Backpack', (p) => p.locator('#product-grid > article:nth-child(1) > button.btn')),
      S('click', 'Open cart', (p) => p.locator('header.site > div.bar > nav > ul > li:nth-child(3) > a')),
      S('click', 'Proceed to checkout', (p) => p.locator('#cart-actions > a.btn')),
      S('fill', 'Full name', (p) => p.locator('#full-name'), 'Ada Lovelace'),
      S('fill', 'Email', (p) => p.locator('#email'), 'ada@example.com'),
      S('fill', 'Address', (p) => p.locator('#address'), '12 Analytical St'),
      S('fill', 'Card number', (p) => p.locator('#card'), '4242424242424242'),
      S('click', 'Place order', (p) => p.locator('#checkout-form > button.btn')),
    ],
  },
  xpath: {
    label: 'XPath (DevTools "Copy XPath")',
    steps: [
      S('click', 'Shop now', (p) => p.locator('xpath=/html/body/main/section[1]/a')),
      S('click', 'Add Trail Backpack', (p) => p.locator('xpath=//*[@id="product-grid"]/article[1]/button')),
      S('click', 'Open cart', (p) => p.locator('xpath=/html/body/header/div/nav/ul/li[3]/a')),
      S('click', 'Proceed to checkout', (p) => p.locator('xpath=//*[@id="cart-actions"]/a')),
      S('fill', 'Full name', (p) => p.locator('xpath=//*[@id="full-name"]'), 'Ada Lovelace'),
      S('fill', 'Email', (p) => p.locator('xpath=//*[@id="email"]'), 'ada@example.com'),
      S('fill', 'Address', (p) => p.locator('xpath=//*[@id="address"]'), '12 Analytical St'),
      S('fill', 'Card number', (p) => p.locator('xpath=//*[@id="card"]'), '4242424242424242'),
      S('click', 'Place order', (p) => p.locator('xpath=//*[@id="checkout-form"]/button')),
    ],
  },
  semantic: {
    label: 'Playwright getByRole / getByLabel (hand-written)',
    steps: [
      S('click', 'Shop now', (p) => p.getByRole('link', { name: 'Shop now' })),
      S('click', 'Add Trail Backpack', (p) => p.getByRole('button', { name: 'Add Trail Backpack to cart' })),
      S('click', 'Open cart', (p) => p.getByRole('link', { name: /^Cart/ })),
      S('click', 'Proceed to checkout', (p) => p.getByRole('link', { name: 'Proceed to checkout' })),
      S('fill', 'Full name', (p) => p.getByLabel('Full name'), 'Ada Lovelace'),
      S('fill', 'Email', (p) => p.getByLabel('Email'), 'ada@example.com'),
      S('fill', 'Address', (p) => p.getByLabel('Shipping address'), '12 Analytical St'),
      S('fill', 'Card number', (p) => p.getByLabel('Card number'), '4242424242424242'),
      S('click', 'Place order', (p) => p.getByRole('button', { name: 'Place order' })),
    ],
  },
};

export const ARM_LABELS = {
  css: ARMS.css.label,
  xpath: ARMS.xpath.label,
  semantic: ARMS.semantic.label,
  synthetix: 'Synthetix replay (saved locators, no healing)',
  heal: 'Synthetix + Healer (SAM 3.1 + Muse Spark)',
};
