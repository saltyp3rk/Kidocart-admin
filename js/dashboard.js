// js/dashboard.js

document.addEventListener('DOMContentLoaded', function () {
  if (!requireAuth()) return;

  loadDashboard();

  // Auto-refresh every 30 seconds
  setInterval(loadDashboard, 30000);
});

function updateSyncStatus(status, message) {
  const el = document.getElementById('sync-status');
  if (!el) return;

  if (status === 'syncing') {
    el.className = 'sync-status syncing';
    el.innerHTML = `<div class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></div> ${message || 'Syncing...'}`;
  } else if (status === 'error') {
    el.className = 'sync-status error';
    el.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message || 'Connection Error'}`;
  } else {
    el.className = 'sync-status';
    el.innerHTML = `<i class="fas fa-check-circle"></i> ${message || 'Connected'}`;
  }
}

async function loadDashboard() {
  updateSyncStatus('syncing', 'Loading data...');

  try {
    const [productsRes, ordersRes] = await Promise.all([
      authFetch('/api/products'),
      authFetch('/api/orders'),
    ]);

    const products = productsRes.ok ? await productsRes.json() : [];
    const orders   = ordersRes.ok  ? await ordersRes.json()   : [];

    updateStats(products, orders);
    updateRecentOrders(orders);
    updateLowStock(products);
    updateTopProducts(products);
    updateDatabaseStatus(products.length, orders.length);

    const el = document.getElementById('last-updated');
    if (el) el.textContent = 'Updated: ' + new Date().toLocaleTimeString();

    updateSyncStatus('connected', 'MongoDB Connected');

  } catch (err) {
    console.error('Dashboard load error:', err);
    updateSyncStatus('error', 'Failed to load');
  }
}

function updateStats(products, orders) {
  setText('total-products', products.length);
  setText('products-change', `${products.filter(p => p.availability).length} active`);

  setText('total-orders', orders.length);
  const pending = orders.filter(o => ['confirmed','processing'].includes(o.status)).length;
  setText('orders-change', `${pending} pending`);

  const revenue = orders
    .filter(o => o.status !== 'cancelled')
    .reduce((sum, o) => sum + (o.total || 0), 0);
  setText('total-revenue', '₹' + Math.round(revenue));

  const now = new Date();
  const monthRevenue = orders
    .filter(o => {
      const d = new Date(o.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, o) => sum + (o.total || 0), 0);
  setText('revenue-change', `↑ ₹${Math.round(monthRevenue)} this month`);

  const lowStock  = products.filter(p => p.stock > 0 && p.stock <= 10).length;
  const outOfStock = products.filter(p => p.stock === 0).length;
  setText('low-stock', lowStock + outOfStock);
}

function updateRecentOrders(orders) {
  const tbody = document.getElementById('recent-orders');
  if (!tbody) return;

  const recent = [...orders].reverse().slice(0, 5);

  if (!recent.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--gray);">No orders yet</td></tr>`;
    return;
  }

  const statusClass = { confirmed: 'pending', processing: 'pending', shipped: 'active', delivered: 'active', cancelled: 'inactive' };

  tbody.innerHTML = recent.map(o => {
    const name = o.shippingAddress
      ? `${o.shippingAddress.firstName || ''} ${o.shippingAddress.lastName || ''}`.trim()
      : 'Unknown';
    return `
      <tr>
        <td><strong>${o.orderId || o._id}</strong></td>
        <td>${name}</td>
        <td>₹${Math.round(o.total || 0)}</td>
        <td><span class="status-badge status-${statusClass[o.status] || 'pending'}">${o.status || 'pending'}</span></td>
        <td>${new Date(o.createdAt).toLocaleDateString()}</td>
      </tr>`;
  }).join('');
}

function updateLowStock(products) {
  const tbody = document.getElementById('low-stock-products');
  if (!tbody) return;

  const items = products.filter(p => p.stock <= 10).sort((a, b) => a.stock - b.stock).slice(0, 5);

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--success);">All products well stocked!</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(p => {
    const img = (p.images && p.images[0]) || 'https://via.placeholder.com/50';
    return `
      <tr>
        <td style="display:flex;align-items:center;gap:0.5rem;">
          <img src="${img}" class="product-thumb" alt="${p.name}" onerror="this.src='https://via.placeholder.com/50'">
          <span>${p.name.substring(0, 28)}${p.name.length > 28 ? '...' : ''}</span>
        </td>
        <td>${p.category}</td>
        <td><strong style="color:${p.stock === 0 ? 'var(--danger)' : 'var(--warning)'};">${p.stock}</strong></td>
        <td><span class="status-badge ${p.stock === 0 ? 'status-inactive' : 'status-pending'}">${p.stock === 0 ? 'Out of Stock' : 'Low Stock'}</span></td>
      </tr>`;
  }).join('');
}

function updateTopProducts(products) {
  const el = document.getElementById('top-products');
  if (!el) return;

  const top = products
    .filter(p => p.availability && p.stock > 0)
    .sort((a, b) => (b.rating * b.reviewCount) - (a.rating * a.reviewCount))
    .slice(0, 4);

  if (!top.length) {
    el.innerHTML = `<p style="text-align:center;color:var(--gray);padding:1rem;">No products yet</p>`;
    return;
  }

  el.innerHTML = top.map((p, i) => {
    const img = (p.images && p.images[0]) || 'https://via.placeholder.com/40';
    return `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;${i < top.length - 1 ? 'border-bottom:1px solid var(--light);' : ''}">
        <span style="width:20px;font-weight:700;color:var(--primary);">#${i + 1}</span>
        <img src="${img}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;" onerror="this.src='https://via.placeholder.com/40'">
        <div style="flex:1;min-width:0;">
          <strong style="display:block;font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</strong>
          <small style="color:var(--gray);"><i class="fas fa-star" style="color:var(--warning);"></i> ${p.rating || 0} (${p.reviewCount || 0})</small>
        </div>
        <strong style="color:var(--primary);">₹${Math.round(p.price)}</strong>
      </div>`;
  }).join('');
}

function updateDatabaseStatus(productsCount, ordersCount) {
  setText('db-products', productsCount);
  setText('db-orders', ordersCount);
  const el = document.getElementById('db-connection');
  if (el) {
    el.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
    el.style.color = 'var(--success)';
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function refreshDashboard() {
  await loadDashboard();
}
