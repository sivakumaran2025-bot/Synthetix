// Shared logic for every page: product catalogue, cart (localStorage), header badge.
const PRODUCTS = [
  { id: 'backpack', name: 'Trail Backpack', price: 59.0, emoji: '🎒' },
  { id: 'bottle', name: 'Steel Water Bottle', price: 24.5, emoji: '🧴' },
  { id: 'headphones', name: 'Studio Headphones', price: 129.0, emoji: '🎧' },
  { id: 'lamp', name: 'Desk Lamp', price: 39.9, emoji: '💡' },
];
const CART_KEY = 'synthetix_cart';
const ORDER_KEY = 'synthetix_order';

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateBadge();
}
function updateBadge() {
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(getCart().reduce((n, i) => n + i.qty, 0));
}
function addToCart(id) {
  const cart = getCart();
  const found = cart.find((i) => i.id === id);
  if (found) found.qty += 1; else cart.push({ id, qty: 1 });
  saveCart(cart);
}
function removeFromCart(id) {
  saveCart(getCart().filter((i) => i.id !== id));
}
function money(n) { return '$' + n.toFixed(2); }
function productById(id) { return PRODUCTS.find((p) => p.id === id); }
function cartTotal() {
  return getCart().reduce((sum, i) => sum + (productById(i.id)?.price || 0) * i.qty, 0);
}

function renderProducts(filter = '') {
  const grid = document.getElementById('product-grid');
  if (!grid) return;
  const q = filter.trim().toLowerCase();
  const items = PRODUCTS.filter((p) => p.name.toLowerCase().includes(q));
  grid.innerHTML = items.length
    ? items.map((p) => `
      <article class="card">
        <div class="thumb" aria-hidden="true">${p.emoji}</div>
        <h2>${p.name}</h2>
        <span class="price">${money(p.price)}</span>
        <button class="btn" type="button" data-add="${p.id}" aria-label="Add ${p.name} to cart">Add to cart</button>
      </article>`).join('')
    : '<p class="muted">No products match your search.</p>';
  grid.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => {
      addToCart(btn.dataset.add);
      const s = document.getElementById('add-status');
      if (s) s.textContent = `${productById(btn.dataset.add).name} added to cart.`;
    }));
}

function renderCart() {
  const body = document.getElementById('cart-body');
  if (!body) return;
  const cart = getCart();
  document.getElementById('cart-empty').hidden = cart.length > 0;
  document.getElementById('cart-table').hidden = cart.length === 0;
  document.getElementById('cart-actions').hidden = cart.length === 0;
  body.innerHTML = cart.map((i) => {
    const p = productById(i.id);
    return `<tr>
      <td>${p.name}</td><td>${i.qty}</td><td>${money(p.price * i.qty)}</td>
      <td><button class="btn secondary" type="button" data-remove="${i.id}" aria-label="Remove ${p.name}">Remove</button></td>
    </tr>`;
  }).join('');
  document.getElementById('cart-total').textContent = money(cartTotal());
  body.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => { removeFromCart(b.dataset.remove); renderCart(); }));
}

function setupCheckout() {
  const form = document.getElementById('checkout-form');
  if (!form) return;
  document.getElementById('checkout-total').textContent = money(cartTotal());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const order = { id: 'SYN-' + Math.floor(100000 + Math.random() * 900000), total: cartTotal() };
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    localStorage.removeItem(CART_KEY);
    window.location.href = 'confirmation.html';
  });
}

function setupConfirmation() {
  const el = document.getElementById('order-number');
  if (!el) return;
  try { el.textContent = JSON.parse(localStorage.getItem(ORDER_KEY)).id; } catch { el.textContent = 'N/A'; }
}

function setupLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    document.getElementById('login-status').textContent = `Welcome back, ${email}!`;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateBadge();
  renderProducts();
  const search = document.getElementById('product-search');
  if (search) search.addEventListener('input', () => renderProducts(search.value));
  renderCart();
  setupCheckout();
  setupConfirmation();
  setupLogin();
});
