// Runs INSIDE the browser, injected into every shop page when a mutation is switched on.
// It simulates what front-end developers do to a live site. It must stay self-contained (it is serialised).
//   wrappers       : every control gets an extra layout <div> around it (DOM structure changes, looks identical)
//   hashed-classes : every CSS class is renamed to a random hash in the stylesheet AND the markup (looks identical)
//   rename-text    : button, link and field wording changes ("Place order" -> "Complete purchase")
//   reorder-products : the product cards appear in reverse order (position-based tests now hit the wrong item)
export function pageMutator(mutations) {
  const has = (m) => mutations.includes(m);
  const rand = () => 'x' + Math.random().toString(36).slice(2, 8);

  // ---------- hashed-classes ----------
  const classMap = new Map();
  if (has('hashed-classes')) {
    const link = document.querySelector('link[rel="stylesheet"]');
    if (link) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', link.href, false); // synchronous on purpose: the page is never seen half-styled
      xhr.send();
      const css = xhr.responseText.replace(/\.([A-Za-z_][\w-]*)/g, (m, name) => {
        if (!classMap.has(name)) classMap.set(name, rand());
        return '.' + classMap.get(name);
      });
      const style = document.createElement('style');
      style.textContent = css;
      link.replaceWith(style);
    }
  }
  const hashClasses = (root) => {
    if (!classMap.size) return;
    const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('[class]')] : [];
    for (const el of els) {
      if (!el.getAttribute || !el.getAttribute('class')) continue;
      const next = el.getAttribute('class').split(/\s+/).map((c) => classMap.get(c) || c).join(' ');
      if (next !== el.getAttribute('class')) el.setAttribute('class', next);
    }
  };

  // ---------- wrappers ----------
  const wrapControls = (root) => {
    if (!has('wrappers') || root.nodeType !== 1) return;
    const controls = [...(root.matches('button, a, input, textarea, select') ? [root] : []), ...root.querySelectorAll('button, a, input, textarea, select')];
    for (const el of controls) {
      if (el.parentElement && el.parentElement.dataset.mutated) continue;
      const w = document.createElement('div');
      w.dataset.mutated = 'wrapper';
      w.className = rand();
      w.style.display = 'contents'; // changes the DOM tree, not the picture
      el.parentNode.insertBefore(w, el);
      w.appendChild(el);
    }
  };

  // ---------- rename-text ----------
  const RENAMES = [
    [/^Add (.+) to cart$/, 'Add $1 to basket'],
    [/^Add to cart$/, 'Add to basket'],
    [/^Shop now$/, 'Start shopping'],
    [/^Cart\b/, 'Basket'],
    [/^Proceed to checkout$/, 'Go to checkout'],
    [/^Place order$/, 'Complete purchase'],
    [/^Full name$/, 'Your name'],
    [/^Shipping address$/, 'Delivery address'],
    [/^Sign in$/, 'Log in'],
  ];
  const rename = (s) => {
    const lead = s.match(/^\s*/)[0];
    const trail = s.match(/\s*$/)[0];
    let core = s.trim();
    for (const [re, to] of RENAMES) if (re.test(core)) { core = core.replace(re, to); break; }
    return lead + core + trail;
  };
  const renameText = (root) => {
    if (!has('rename-text')) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) { const next = rename(n.nodeValue); if (next !== n.nodeValue) n.nodeValue = next; }
    const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('[aria-label], [placeholder], [title]')] : [];
    for (const el of els) {
      for (const attr of ['aria-label', 'placeholder', 'title']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) { const next = rename(v); if (next !== v) el.setAttribute(attr, next); }
      }
    }
  };

  // ---------- reorder-products ----------
  const CANONICAL = ['backpack', 'bottle', 'headphones', 'lamp'];
  const reorderGrid = () => {
    if (!has('reorder-products')) return;
    const grid = document.getElementById('product-grid');
    if (!grid) return;
    const idOf = (card) => { const b = card.querySelector('[data-add]'); return b ? b.dataset.add : null; };
    const cards = [...grid.children].filter((c) => idOf(c));
    const target = [...cards].sort((a, b) => CANONICAL.indexOf(idOf(b)) - CANONICAL.indexOf(idOf(a)));
    if (cards.some((c, i) => c !== target[i])) target.forEach((c) => grid.appendChild(c));
  };

  const apply = (root) => { hashClasses(root); wrapControls(root); renameText(root); };
  apply(document.body);
  reorderGrid();
  // The shop draws products and cart rows with JavaScript after load: mutate those too.
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && !(n.dataset && n.dataset.mutated)) apply(n);
    reorderGrid();
  }).observe(document.body, { childList: true, subtree: true });
}

export const MUTATION_NAMES = ['wrappers', 'hashed-classes', 'rename-text', 'reorder-products'];
// "all" keeps meaning the original three, so earlier phases behave exactly as before.
const ALL = ['wrappers', 'hashed-classes', 'rename-text'];

export function parseMutations(spec) {
  if (!spec) return [];
  const names = Array.isArray(spec) ? spec : String(spec).split(',').map((s) => s.trim()).filter(Boolean);
  const out = names.flatMap((n) => (n === 'all' ? ALL : [n]));
  const bad = out.filter((n) => !MUTATION_NAMES.includes(n));
  if (bad.length) throw new Error(`Unknown mutation "${bad[0]}". Choose from: ${MUTATION_NAMES.join(', ')}, all`);
  return [...new Set(out)];
}
