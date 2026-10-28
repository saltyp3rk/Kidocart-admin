// ==========================================================================
// KIDOCART ADMIN PANEL - CORE CONTROLLER & SPA APPLICATION ENGINE
// Clean, Modern, Modular Architecture
// ==========================================================================

const API_BASE = 'https://admin.kidocart.shop';
const STOREFRONT_API = 'https://www.kidocart.shop';

// Global Data Store
let allProducts = [];
let allAdminOrders = [];
let allCustomers = [];
let allPromos = [];
let cachedImgbbKey = null;

// Filter & Search States
let currentOrderFilter = 'all';
let orderSearchQuery = '';
let currentProductCategory = 'all';
let currentProductStock = 'all';
let productSearchQuery = '';
let customerSearchQuery = '';

// Active Confirmation Callback
let activeConfirmCallback = null;

// Route Guard & Bootstrap
if (!localStorage.getItem('admin_token') && !window.location.href.includes('login.html')) {
  window.location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initRichEditor();
  initImageUploader();
  loadDashboardData();
});

// ──────────────────────────────────────────────────────────────────────────
// 1. UNIFIED AUTHENTICATED FETCH WRAPPER
// ──────────────────────────────────────────────────────────────────────────

async function authFetch(url, options = {}) {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    logout();
    return null;
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };

  try {
    const res = await fetch(url, { ...options, headers });
    
    // Check for expired or invalid token
    if (res.status === 401) {
      console.warn('Admin token expired or invalid (401). Redirecting to login...');
      localStorage.removeItem('admin_token');
      window.location.href = 'login.html?expired=true';
      return null;
    }
    
    return res;
  } catch (networkError) {
    console.error('Network request failed:', networkError);
    throw networkError;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 2. NAVIGATION & MOBILE DRAWER
// ──────────────────────────────────────────────────────────────────────────

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-target]');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('data-target');
      if (targetId) navigateToView(targetId);
    });
  });
}

function navigateToView(targetId) {
  // Support aliases (e.g. promo-view -> promos-view)
  if (targetId === 'promo-view') targetId = 'promos-view';

  const viewSections = document.querySelectorAll('.view-section');
  const allNavItems = document.querySelectorAll('.nav-item');

  viewSections.forEach(section => section.classList.remove('active'));
  allNavItems.forEach(nav => nav.classList.remove('active'));

  const targetSection = document.getElementById(targetId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  document.querySelectorAll(`.nav-item[data-target="${targetId}"]`).forEach(nav => {
    nav.classList.add('active');
  });

  // Lazy-load view data on activation
  if (targetId === 'dashboard-view') loadDashboardData();
  if (targetId === 'products-view') loadProductsData();
  if (targetId === 'orders-view') loadOrdersData();
  if (targetId === 'customers-view') loadCustomersData();
  if (targetId === 'promos-view') fetchPromoCodes();
  if (targetId === 'content-view') loadAppContent();
  if (targetId === 'notifications-view') loadNotificationStats();

  // Close mobile drawer if open
  closeMobileDrawer();
}

function toggleMobileDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const overlay = document.getElementById('mobile-drawer-overlay');
  if (!drawer || !overlay) return;

  const isOpen = drawer.classList.contains('active');
  if (isOpen) {
    drawer.classList.remove('active');
    overlay.classList.remove('active');
  } else {
    drawer.classList.add('active');
    overlay.classList.add('active');
  }
}

function closeMobileDrawer() {
  const drawer = document.getElementById('mobile-drawer');
  const overlay = document.getElementById('mobile-drawer-overlay');
  if (drawer) drawer.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
}

function logout() {
  localStorage.removeItem('admin_token');
  window.location.href = 'login.html';
}

// ──────────────────────────────────────────────────────────────────────────
// 3. TOAST & CONFIRMATION MODAL HELPERS
// ──────────────────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';
  if (type === 'info') icon = 'fa-circle-info';

  toast.innerHTML = `<i class="fas ${icon}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function openConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-title');
  const msgEl = document.getElementById('confirm-message');
  const actionBtn = document.getElementById('confirm-action-btn');

  if (titleEl) titleEl.textContent = title || 'Confirm Action';
  if (msgEl) msgEl.textContent = message || 'Are you sure you want to proceed?';
  
  activeConfirmCallback = onConfirm;

  if (actionBtn) {
    actionBtn.onclick = async () => {
      const callback = activeConfirmCallback;
      closeConfirmModal();
      if (typeof callback === 'function') {
        await callback();
      }
    };
  }

  if (modal) modal.classList.add('active');
}

function closeConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.classList.remove('active');
  activeConfirmCallback = null;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ──────────────────────────────────────────────────────────────────────────
// 4. DASHBOARD VIEW CONTROLLER
// ──────────────────────────────────────────────────────────────────────────

async function loadDashboardData() {
  const salesEl = document.getElementById('dash-sales');
  const pendingEl = document.getElementById('dash-pending');
  const stockEl = document.getElementById('dash-stock');
  const totalOrdersEl = document.getElementById('dash-total-orders');
  const customersEl = document.getElementById('dash-customers');
  const recentOrdersWrap = document.getElementById('dash-recent-orders-container');

  if (salesEl) salesEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:18px;"></i>';
  if (pendingEl) pendingEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:18px;"></i>';
  if (stockEl) stockEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:18px;"></i>';
  if (totalOrdersEl) totalOrdersEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:18px;"></i>';
  if (customersEl) customersEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:18px;"></i>';

  try {
    // Attempt fast consolidated dashboard stats API first
    let statsData = null;
    try {
      const statsRes = await authFetch(`${API_BASE}/api/dashboard/stats`);
      if (statsRes && statsRes.ok) {
        statsData = await statsRes.json();
      }
    } catch (e) {
      console.warn('Dashboard stats endpoint unavailable, falling back to parallel fetch');
    }

    if (statsData && statsData.stats) {
      const s = statsData.stats;
      if (salesEl) salesEl.textContent = `₹${(s.todaySales || 0).toLocaleString('en-IN')}`;
      if (pendingEl) pendingEl.textContent = s.pendingOrders || 0;
      if (stockEl) stockEl.textContent = s.lowStockCount || 0;
      if (totalOrdersEl) totalOrdersEl.textContent = s.totalOrders || 0;
      if (customersEl) customersEl.textContent = s.totalCustomers || 0;

      if (recentOrdersWrap && statsData.recentOrders) {
        allAdminOrders = statsData.recentOrders;
        renderDashboardRecentOrders(statsData.recentOrders);
      }

      // Preload product catalog in the background so order detail images/names resolve instantly
      if (!allProducts || allProducts.length === 0) {
        authFetch(`${API_BASE}/api/products`)
          .then(r => r && r.ok ? r.json() : [])
          .then(prods => { if (Array.isArray(prods)) allProducts = prods; })
          .catch(() => {});
      }
      return;
    }

    // Fallback: Parallel requests to individual endpoints
    const [prodRes, orderRes, userRes] = await Promise.all([
      authFetch(`${API_BASE}/api/products`),
      authFetch(`${API_BASE}/api/orders?admin=true`),
      authFetch(`${API_BASE}/api/users`)
    ]);

    const products = (prodRes && prodRes.ok) ? await prodRes.json() : [];
    const orders = (orderRes && orderRes.ok) ? await orderRes.json() : [];
    const users = (userRes && userRes.ok) ? await userRes.json() : [];

    allProducts = products;
    allAdminOrders = orders;
    allCustomers = users;

    const lowStockCount = products.filter(p => Number(p.stock) <= 10).length;
    const pendingOrders = orders.filter(o => o.status === 'pending').length;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todaysSales = orders
      .filter(o => new Date(o.createdAt) >= startOfToday && o.status !== 'cancelled')
      .reduce((sum, order) => sum + (Number(order.total) || 0), 0);

    if (salesEl) salesEl.textContent = `₹${todaysSales.toLocaleString('en-IN')}`;
    if (pendingEl) pendingEl.textContent = pendingOrders;
    if (stockEl) stockEl.textContent = lowStockCount;
    if (totalOrdersEl) totalOrdersEl.textContent = orders.length;
    if (customersEl) customersEl.textContent = users.length;

    if (recentOrdersWrap) {
      renderDashboardRecentOrders(orders.slice(0, 6));
    }
  } catch (error) {
    console.error("Dashboard error:", error);
    if (salesEl) salesEl.textContent = "₹0";
    if (pendingEl) pendingEl.textContent = "0";
    if (stockEl) stockEl.textContent = "0";
    if (totalOrdersEl) totalOrdersEl.textContent = "0";
    if (customersEl) customersEl.textContent = "0";
    if (recentOrdersWrap) {
      recentOrdersWrap.innerHTML = `
        <div class="empty-state" style="padding: 24px;">
          <p>Could not refresh recent orders.</p>
          <button class="btn btn-secondary" onclick="loadDashboardData()"><i class="fas fa-rotate"></i> Retry</button>
        </div>`;
    }
  }
}

function renderDashboardRecentOrders(orders) {
  const container = document.getElementById('dash-recent-orders-container');
  if (!container) return;

  if (!orders || orders.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 24px;"><p>No orders recorded yet.</p></div>`;
    return;
  }

  const rows = orders.map(o => {
    const oid = o.orderId || o._id;
    const shortId = (o.orderId || String(oid)).replace('ORD-', '').slice(-8);
    const d = new Date(o.createdAt);
    const dateFormatted = isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const custName = getOrderCustomerName(o);
    const total = Number(o.total) || 0;
    const status = o.status || 'pending';

    return `
      <tr>
        <td><div class="cell-strong">#${escapeHtml(shortId)}</div></td>
        <td>${escapeHtml(dateFormatted)}</td>
        <td><div class="cell-strong">${escapeHtml(custName)}</div></td>
        <td class="cell-strong">₹${total.toLocaleString('en-IN')}</td>
        <td><span class="badge-pill st-${status}">${status}</span></td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11.5px;" onclick="viewOrderDetails('${oid}')">
            <i class="fas fa-eye"></i> Details
          </button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Order #</th>
            <th>Date</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ──────────────────────────────────────────────────────────────────────────
// 5. ORDERS VIEW CONTROLLER (BUG FIX & FULL DETAIL DRAWER)
// ──────────────────────────────────────────────────────────────────────────

async function loadOrdersData() {
  const container = document.getElementById('orders-view');
  if (!container) return;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Orders</h1>
        <span class="subtitle">Track fulfillments, customer deliveries and payment statuses</span>
      </div>
    </div>
    <div class="card empty-state">
      <i class="fas fa-spinner fa-spin empty-icon"></i>
      <h3>Loading orders</h3>
      <p>Fetching store orders securely...</p>
    </div>`;

  try {
    const fetchPromises = [authFetch(`${API_BASE}/api/orders?admin=true`)];
    if (!allProducts || allProducts.length === 0) {
      fetchPromises.push(authFetch(`${API_BASE}/api/products`).then(r => r && r.ok ? r.json() : []).catch(() => []));
    }

    const [res, prods] = await Promise.all(fetchPromises);
    if (!res || !res.ok) {
      throw new Error((res && res.statusText) || 'Failed to fetch orders from server');
    }

    if (Array.isArray(prods) && prods.length > 0) {
      allProducts = prods;
    }

    allAdminOrders = await res.json();
    renderOrdersList();
  } catch (error) {
    console.error('Orders Load Error:', error);
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h1>Orders</h1>
          <span class="subtitle">Track fulfillments, customer deliveries and payment statuses</span>
        </div>
      </div>
      <div class="card error-state">
        <i class="fas fa-circle-exclamation"></i>
        <h3 style="margin-bottom: 6px;">Unable to Load Orders</h3>
        <p style="margin-bottom: 16px; font-size: 13px;">${escapeHtml(error.message || 'Server error occurred while loading order records.')}</p>
        <button class="btn btn-primary" onclick="loadOrdersData()"><i class="fas fa-rotate"></i> Try Again</button>
      </div>`;
  }
}

const ORDER_STATUS_LIST = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

function getOrderCustomerName(o) {
  if (o.shippingAddress) {
    if (o.shippingAddress.name) return o.shippingAddress.name;
    const fn = o.shippingAddress.firstName || '';
    const ln = o.shippingAddress.lastName || '';
    const full = `${fn} ${ln}`.trim();
    if (full) return full;
  }
  if (o.userId && typeof o.userId === 'object' && o.userId.name) {
    return o.userId.name;
  }
  return 'Guest Customer';
}

function getOrderCustomerPhone(o) {
  if (o.shippingAddress && o.shippingAddress.phone) return o.shippingAddress.phone;
  if (o.phone) return o.phone;
  return '—';
}

function getOrderLocation(o) {
  if (o.shippingAddress) {
    const parts = [o.shippingAddress.city, o.shippingAddress.state].filter(Boolean);
    if (parts.length) return parts.join(', ');
  }
  return '—';
}

function renderOrdersList(filterStatus) {
  if (filterStatus !== undefined) currentOrderFilter = filterStatus;
  const container = document.getElementById('orders-view');
  if (!container) return;

  const counts = {
    all: allAdminOrders.length,
    pending: allAdminOrders.filter(o => o.status === 'pending').length,
    processing: allAdminOrders.filter(o => o.status === 'processing').length,
    shipped: allAdminOrders.filter(o => o.status === 'shipped').length,
    delivered: allAdminOrders.filter(o => o.status === 'delivered').length,
    cancelled: allAdminOrders.filter(o => o.status === 'cancelled').length
  };

  const tabs = ['all', ...ORDER_STATUS_LIST];

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Orders <span style="font-size: 14px; font-weight: 600; color: var(--text-muted);">(${allAdminOrders.length})</span></h1>
        <span class="subtitle">Review customer orders, update tracking numbers and dispatch fulfillments</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" onclick="loadOrdersData()" title="Refresh Orders"><i class="fas fa-rotate"></i></button>
      </div>
    </div>

    <div class="filters-row">
      <div class="search-box-wrapper">
        <i class="fas fa-magnifying-glass search-icon"></i>
        <input type="text" id="order-search" class="form-input" placeholder="Search by order #, phone, customer name..." value="${escapeHtml(orderSearchQuery)}" oninput="handleOrderSearch(this.value)">
      </div>
      <div class="filter-tabs">
        ${tabs.map(t => `
          <button class="filter-tab ${currentOrderFilter === t ? 'active' : ''}" onclick="renderOrdersList('${t}')">
            ${t.charAt(0).toUpperCase() + t.slice(1)}
            <span class="tab-count">${counts[t] || 0}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Date &amp; Time</th>
              <th>Customer</th>
              <th>Total Amount</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="orders-tbody"></tbody>
        </table>
      </div>
    </div>`;

  applyOrderRows();
}

function handleOrderSearch(value) {
  orderSearchQuery = value;
  applyOrderRows();
}

function getFilteredOrders() {
  let list = currentOrderFilter === 'all' 
    ? allAdminOrders 
    : allAdminOrders.filter(o => (o.status || 'pending') === currentOrderFilter);

  const q = orderSearchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(o => {
      const name = getOrderCustomerName(o).toLowerCase();
      const phone = getOrderCustomerPhone(o).toLowerCase();
      const oid = String(o.orderId || o._id || '').toLowerCase();
      const location = getOrderLocation(o).toLowerCase();
      return name.includes(q) || phone.includes(q) || oid.includes(q) || location.includes(q);
    });
  }

  return list;
}

function applyOrderRows() {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  const orders = getFilteredOrders();

  if (orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state" style="padding: 36px 20px;">
            <i class="fas fa-receipt empty-icon"></i>
            <h3>No orders found</h3>
            <p>No orders match the current search or status filter.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const oid = o.orderId || o._id;
    const shortId = (o.orderId || String(oid)).replace('ORD-', '').slice(-8);
    const d = new Date(o.createdAt);
    const dateStr = isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = isNaN(d) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const custName = getOrderCustomerName(o);
    const phone = getOrderCustomerPhone(o);
    const itemCount = Array.isArray(o.items) ? o.items.length : 0;
    const total = Number(o.total) || 0;
    const status = o.status || 'pending';

    const isOnline = (o.paymentMethod || '').toLowerCase() === 'razorpay' || (o.paymentMethod || '').toLowerCase() === 'online';
    const payBadge = isOnline
      ? `<span class="badge-pill pv-email">Online</span>`
      : `<span class="badge-pill" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1;">COD</span>`;

    const statusDropdown = `
      <select class="status-select st-${status}" onchange="updateOrderStatus('${oid}', this.value)">
        ${ORDER_STATUS_LIST.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
      </select>`;

    return `
      <tr>
        <td>
          <div class="cell-strong">#${escapeHtml(shortId)}</div>
          <div class="cell-sub">${itemCount} item(s)</div>
        </td>
        <td>
          <div>${escapeHtml(dateStr)}</div>
          <div class="cell-sub">${escapeHtml(timeStr)}</div>
        </td>
        <td>
          <div class="cell-strong">${escapeHtml(custName)}</div>
          <div class="cell-sub">${escapeHtml(phone)}</div>
        </td>
        <td class="cell-strong">₹${total.toLocaleString('en-IN')}</td>
        <td>${payBadge}</td>
        <td>${statusDropdown}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 5px 12px; font-size: 12px;" onclick="viewOrderDetails('${oid}')">
            <i class="fas fa-eye"></i> Details
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function updateOrderStatus(orderId, newStatus) {
  try {
    const res = await authFetch(`${API_BASE}/api/orders?orderId=${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res || !res.ok) throw new Error('Status update failed');

    // Update local state optimistically
    const local = allAdminOrders.find(o => (o.orderId || o._id) === orderId);
    if (local) local.status = newStatus;

    showToast(`Order marked as ${newStatus}`);
    applyOrderRows();
  } catch (error) {
    showToast(error.message || 'Failed to update order status', 'error');
    applyOrderRows(); // Revert display
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 6. ORDER DETAILS MODAL / DRAWER
// ──────────────────────────────────────────────────────────────────────────

// ─── BRANDED IMAGE FALLBACK & ERROR HANDLER ───
const BRAND_FALLBACK_SVG = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"%3E%3Crect width="60" height="60" fill="%23FFF5EE" rx="8"/%3E%3Cpath d="M22 25 L38 25 L36 43 L24 43 Z" fill="none" stroke="%23FF6B35" stroke-width="2"/%3E%3Cpath d="M26 25 C26 21 34 21 34 25" fill="none" stroke="%23FF6B35" stroke-width="2"/%3E%3Ctext x="50%" y="78%" font-family="sans-serif" font-size="7.5" font-weight="700" fill="%23FF6B35" text-anchor="middle"%3EKidoCart%3C/text%3E%3C/svg%3E';

function handleImgError(el) {
  if (!el) return;
  el.onerror = null;
  el.src = BRAND_FALLBACK_SVG;
}

// ─── ORDER ITEMS RESOLUTION & RENDERING ENGINE ───
function resolveOrderItem(item) {
  const pId = (item.productId && typeof item.productId === 'object' && item.productId._id)
    ? String(item.productId._id)
    : String(item.productId || item.id || (item.product && (item.product._id || item.product.id)) || '');

  const matched = (allProducts && allProducts.length > 0)
    ? allProducts.find(p => String(p._id || p.id) === pId || (pId && (String(p._id).includes(pId) || String(p.id).includes(pId))))
    : null;

  const itemObj = (item.product && typeof item.product === 'object') ? item.product : null;
  const prodObj = (item.productId && typeof item.productId === 'object') ? item.productId : null;

  // 1. Resolve Image
  let itemImg = item.image
    || (Array.isArray(item.images) && item.images[0])
    || (prodObj && prodObj.image)
    || (prodObj && Array.isArray(prodObj.images) && prodObj.images[0])
    || (itemObj && itemObj.image)
    || (itemObj && Array.isArray(itemObj.images) && itemObj.images[0])
    || (matched && matched.image)
    || (matched && Array.isArray(matched.images) && matched.images[0])
    || '';

  if (!itemImg || typeof itemImg !== 'string' || itemImg.trim() === '') {
    itemImg = BRAND_FALLBACK_SVG;
  }

  // 2. Resolve Name
  let itemName = item.name
    || (prodObj && prodObj.name)
    || (itemObj && itemObj.name)
    || (matched && matched.name)
    || (pId ? `Product #${pId.slice(-6)}` : 'Product Item');

  // 3. Resolve Brand/Category
  let itemMeta = item.brand
    || (prodObj && prodObj.brand)
    || (itemObj && itemObj.brand)
    || (matched && matched.brand)
    || (matched && matched.category)
    || '';

  return { itemImg, itemName, itemMeta };
}

function renderOrderItemsHtml(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="cell-sub" style="padding: 10px 0;">No items recorded in this order.</p>';
  }

  return items.map(item => {
    const { itemImg, itemName, itemMeta } = resolveOrderItem(item);
    const itemQty = item.quantity || 1;
    const itemPrice = Number(item.price) || 0;
    const sub = itemQty * itemPrice;

    return `
      <div class="order-item-row">
        <img src="${escapeHtml(itemImg)}" alt="${escapeHtml(itemName)}" class="order-item-thumb" onerror="handleImgError(this)">
        <div style="flex: 1; min-width: 0;">
          <div class="cell-strong" style="font-size: 13.5px; white-space: normal; line-height: 1.35;">${escapeHtml(itemName)}</div>
          <div class="cell-sub" style="margin-top: 3px;">
            ${itemMeta ? `<span style="color: var(--primary); font-weight: 500;">${escapeHtml(itemMeta)}</span> &bull; ` : ''}
            ${item.size ? `Size: <strong>${escapeHtml(item.size)}</strong> &bull; ` : ''}
            ${item.color ? `Color: <strong>${escapeHtml(item.color)}</strong> &bull; ` : ''}
            Qty: <strong>${itemQty}</strong> &times; ₹${itemPrice.toLocaleString('en-IN')}
          </div>
        </div>
        <div class="cell-strong" style="font-size: 14px; text-align: right; white-space: nowrap;">₹${sub.toLocaleString('en-IN')}</div>
      </div>`;
  }).join('');
}

function updateOrderDetailsItems(order) {
  const container = document.getElementById('od-items-container');
  if (container && order) {
    container.innerHTML = renderOrderItemsHtml(order.items || []);
  }
}

async function viewOrderDetails(orderId) {
  let order = allAdminOrders.find(o => String(o.orderId || o._id) === String(orderId));
  
  // If not found in memory, fetch fresh from server
  if (!order) {
    try {
      const res = await authFetch(`${API_BASE}/api/orders?orderId=${encodeURIComponent(orderId)}`);
      if (res && res.ok) {
        order = await res.json();
      }
    } catch (e) {}
  }

  if (!order) {
    showToast('Order details not found', 'error');
    return;
  }

  const modal = document.getElementById('order-details-modal');
  const titleEl = document.getElementById('od-title');
  const statusPill = document.getElementById('od-status-pill');
  const bodyEl = document.getElementById('order-details-body');

  const oid = order.orderId || order._id;
  const shortId = (order.orderId || String(oid)).replace('ORD-', '').slice(-8);

  if (titleEl) titleEl.textContent = `Order #${shortId}`;
  if (statusPill) {
    statusPill.className = `badge-pill st-${order.status || 'pending'}`;
    statusPill.textContent = (order.status || 'pending').toUpperCase();
  }

  const d = new Date(order.createdAt);
  const formattedDate = isNaN(d) ? '—' : d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const addr = order.shippingAddress || {};
  const fullAddress = [
    addr.address || addr.street,
    addr.address2 || addr.apartment,
    addr.city,
    addr.state,
    addr.zip || addr.zipcode || addr.pincode
  ].filter(Boolean).join(', ') || 'No address specified';

  const custName = getOrderCustomerName(order);
  const phone = getOrderCustomerPhone(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const tracking = order.trackingNumber || '';

  bodyEl.innerHTML = `
    <div class="order-detail-grid">
      <div class="order-info-card">
        <div class="order-info-card-title"><i class="fas fa-location-dot"></i> Delivery Address</div>
        <div class="cell-strong">${escapeHtml(custName)}</div>
        <div style="font-size: 12.5px; color: var(--text-body); margin: 4px 0;">${escapeHtml(fullAddress)}</div>
        <div class="cell-sub"><i class="fas fa-phone" style="font-size: 10px;"></i> ${escapeHtml(phone)}</div>
      </div>

      <div class="order-info-card">
        <div class="order-info-card-title"><i class="fas fa-credit-card"></i> Payment &amp; Logistics</div>
        <div style="font-size: 13px;">Method: <strong>${(order.paymentMethod || 'COD').toUpperCase()}</strong></div>
        <div style="font-size: 12.5px; color: var(--text-muted); margin: 3px 0;">Payment Status: <span style="text-transform: capitalize; font-weight:600;">${order.paymentStatus || 'Pending'}</span></div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">Placed: ${formattedDate}</div>
      </div>
    </div>

    <!-- Tracking Number Editor -->
    <div class="card" style="margin-bottom: 20px; padding: 14px;">
      <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 200px;">
          <label class="form-label" style="margin-bottom: 4px;">Tracking Number / Delhivery AWB</label>
          <input type="text" id="od-tracking-input" class="form-input" placeholder="e.g. 12837198273" value="${escapeHtml(tracking)}">
        </div>
        <button class="btn btn-primary" onclick="saveOrderTracking('${oid}')">
          <i class="fas fa-save"></i> Save Tracking
        </button>
      </div>
    </div>

    <!-- Items List -->
    <div style="margin-bottom: 12px;">
      <h4 style="font-size: 14px; font-weight: 700; color: var(--text-main);">Ordered Items (${items.length})</h4>
      <div class="order-items-list" id="od-items-container">${renderOrderItemsHtml(items)}</div>
    </div>

    <!-- Financial Summary -->
    <div class="order-summary-box">
      <div class="order-summary-row">
        <span>Subtotal</span>
        <span>₹${(Number(order.subtotal) || Number(order.total) || 0).toLocaleString('en-IN')}</span>
      </div>
      <div class="order-summary-row">
        <span>Shipping</span>
        <span>${(Number(order.shipping) > 0) ? `₹${Number(order.shipping)}` : 'FREE'}</span>
      </div>
      ${Number(order.discount) > 0 ? `
      <div class="order-summary-row" style="color: var(--success-text);">
        <span>Discount</span>
        <span>-₹${Number(order.discount).toLocaleString('en-IN')}</span>
      </div>` : ''}
      <div class="order-summary-row total">
        <span>Grand Total</span>
        <span>₹${(Number(order.total) || 0).toLocaleString('en-IN')}</span>
      </div>
    </div>`;

  if (modal) modal.classList.add('active');

  // If products were not yet loaded into memory, fetch them and live-update items list
  if (!allProducts || allProducts.length === 0) {
    authFetch(`${API_BASE}/api/products`)
      .then(r => r && r.ok ? r.json() : [])
      .then(prods => {
        if (Array.isArray(prods) && prods.length > 0) {
          allProducts = prods;
          updateOrderDetailsItems(order);
        }
      })
      .catch(() => {});
  }
}

function closeOrderDetailsModal() {
  const modal = document.getElementById('order-details-modal');
  if (modal) modal.classList.remove('active');
}

async function saveOrderTracking(orderId) {
  const input = document.getElementById('od-tracking-input');
  if (!input) return;
  const trackingNumber = input.value.trim();

  try {
    const res = await authFetch(`${API_BASE}/api/orders?orderId=${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingNumber })
    });

    if (!res || !res.ok) throw new Error('Failed to update tracking');

    const order = allAdminOrders.find(o => String(o.orderId || o._id) === String(orderId));
    if (order) order.trackingNumber = trackingNumber;

    showToast('Tracking number updated successfully');
  } catch (err) {
    showToast(err.message || 'Error updating tracking', 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 7. PRODUCTS VIEW CONTROLLER (CRUD & INVENTORY)
// ──────────────────────────────────────────────────────────────────────────

async function loadProductsData() {
  const list = document.getElementById('products-list');
  const countBadge = document.getElementById('products-count-badge');
  if (!list) return;

  list.innerHTML = `
    <div class="empty-state" style="grid-column: 1/-1;">
      <i class="fas fa-spinner fa-spin empty-icon"></i>
      <h3>Loading products</h3>
      <p>Fetching inventory catalog...</p>
    </div>`;

  try {
    const res = await authFetch(`${API_BASE}/api/products`);
    if (!res || !res.ok) throw new Error('Failed to load products');

    allProducts = await res.json();
    if (countBadge) countBadge.textContent = `(${allProducts.length})`;
    renderProducts(allProducts);
  } catch (error) {
    console.error('Products error:', error);
    list.innerHTML = `
      <div class="card error-state" style="grid-column: 1/-1;">
        <i class="fas fa-circle-exclamation"></i>
        <h3>Unable to Load Products</h3>
        <p style="margin-bottom: 16px;">${escapeHtml(error.message || 'Server error occurred.')}</p>
        <button class="btn btn-primary" onclick="loadProductsData()"><i class="fas fa-rotate"></i> Retry</button>
      </div>`;
  }
}

function renderProducts(products) {
  const list = document.getElementById('products-list');
  if (!list) return;

  if (!products || products.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <i class="fas fa-box-open empty-icon"></i>
        <h3>No products found</h3>
        <p>No products match your current search or category filter.</p>
        <button class="btn btn-primary" onclick="openProductModal()"><i class="fas fa-plus"></i> Add New Product</button>
      </div>`;
    return;
  }

  list.innerHTML = products.map(p => {
    const pId = p._id || p.id;
    const firstImg = (Array.isArray(p.images) && p.images.length > 0 && p.images[0]) 
      ? p.images[0] 
      : BRAND_FALLBACK_SVG;

    const stock = Number(p.stock) || 0;
    let stockTag = `<span class="product-stock-tag stock-in">In Stock (${stock})</span>`;
    if (stock <= 0) {
      stockTag = `<span class="product-stock-tag stock-out">Out of Stock</span>`;
    } else if (stock <= 10) {
      stockTag = `<span class="product-stock-tag stock-low">Low Stock (${stock})</span>`;
    }

    const price = Number(p.price) || 0;
    const origPrice = Number(p.originalPrice) || 0;

    const dims = p.dimensions || p.dimentions || {};
    const weightVal = p.weight ?? dims.weight;
    const pkgTag = (weightVal !== undefined && weightVal !== null && weightVal !== '')
      ? `<span class="product-stock-tag" style="background:#F1F5F9; color:#475569; border:1px solid #CBD5E1; margin-left:4px;" title="Package weight: ${weightVal}g"><i class="fas fa-box" style="font-size:9.5px; margin-right:3px;"></i>${weightVal}g</span>`
      : '';

    return `
      <div class="product-card">
        <img src="${escapeHtml(firstImg)}" alt="${escapeHtml(p.name)}" class="product-card-thumb" onerror="handleImgError(this)">
        <div class="product-card-body">
          <div class="product-card-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
          <div class="product-card-meta">
            ${escapeHtml(p.category || 'General')} ${p.brand ? `&bull; ${escapeHtml(p.brand)}` : ''}
          </div>
          <div class="product-card-pricing">
            <span class="product-price-current">₹${price.toLocaleString('en-IN')}</span>
            ${origPrice > price ? `<span class="product-price-original">₹${origPrice.toLocaleString('en-IN')}</span>` : ''}
          </div>
          <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
            ${stockTag}
            ${pkgTag}
          </div>
        </div>
        <div class="product-card-actions">
          <button class="icon-btn" onclick="openEditModal('${pId}')" title="Edit Product">
            <i class="fas fa-pen-to-square"></i>
          </button>
          <button class="icon-btn" style="color: var(--danger);" onclick="confirmDeleteProduct('${pId}', '${escapeHtml(p.name)}')" title="Delete Product">
            <i class="fas fa-trash-can"></i>
          </button>
        </div>
      </div>`;
  }).join('');
}

function filterProducts() {
  const searchInput = document.getElementById('product-search');
  const categorySelect = document.getElementById('product-category-filter');
  const stockSelect = document.getElementById('product-stock-filter');

  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const category = categorySelect ? categorySelect.value : 'all';
  const stock = stockSelect ? stockSelect.value : 'all';

  const filtered = allProducts.filter(p => {
    // 1. Text Search
    const matchesSearch = !query || 
      (p.name || '').toLowerCase().includes(query) ||
      (p.brand || '').toLowerCase().includes(query) ||
      (p.description || '').toLowerCase().includes(query);

    // 2. Category Filter
    const matchesCat = (category === 'all') || ((p.category || '').toLowerCase() === category.toLowerCase());

    // 3. Stock Filter
    const stockVal = Number(p.stock) || 0;
    let matchesStock = true;
    if (stock === 'in-stock') matchesStock = stockVal > 10;
    else if (stock === 'low-stock') matchesStock = stockVal > 0 && stockVal <= 10;
    else if (stock === 'out-of-stock') matchesStock = stockVal <= 0;

    return matchesSearch && matchesCat && matchesStock;
  });

  renderProducts(filtered);
}

function confirmDeleteProduct(productId, name) {
  openConfirmModal(
    'Delete Product',
    `Are you sure you want to delete "${name}"? This removes it permanently from both the mobile app and website storefront.`,
    async () => {
      try {
        showToast(`Deleting "${name}"...`, 'info');
        const res = await authFetch(`${API_BASE}/api/products?id=${encodeURIComponent(productId)}`, {
          method: 'DELETE'
        });

        if (!res || !res.ok) {
          const errData = res ? await res.json().catch(() => ({})) : {};
          throw new Error(errData.error || errData.message || 'Failed to delete product from database');
        }

        showToast('Product deleted successfully');
        await loadProductsData();
        loadDashboardData().catch(() => {});
      } catch (err) {
        showToast(err.message || 'Error deleting product', 'error');
      }
    }
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// 8. PRODUCT MODAL, RICH EDITOR & IMAGE GALLERY LOGIC
// ──────────────────────────────────────────────────────────────────────────

// Image preview state management
let existingProductImages = []; // String URLs already saved on backend
let pendingNewImages = []; // Objects: { id, file, previewUrl }

// Rich Text Editor State & Helpers
function setEditorContent(content) {
  const editor = document.getElementById('modal-description-editor');
  const hiddenInput = document.getElementById('modal-description');
  if (!editor) return;

  if (!content) {
    editor.innerHTML = '';
    if (hiddenInput) hiddenInput.value = '';
    return;
  }

  // If text contains HTML tags, use directly; otherwise convert newlines to paragraphs
  if (/<[a-z][\s\S]*>/i.test(content)) {
    editor.innerHTML = content;
  } else {
    const paragraphs = content.split(/\r?\n\r?\n/).map(block => {
      const trimmed = block.trim();
      return trimmed ? `<p>${escapeHtml(trimmed).replace(/\r?\n/g, '<br>')}</p>` : '';
    }).filter(Boolean);
    editor.innerHTML = paragraphs.length > 0 ? paragraphs.join('') : `<p>${escapeHtml(content)}</p>`;
  }

  if (hiddenInput) {
    hiddenInput.value = editor.innerText.trim() ? editor.innerHTML : '';
  }
}

function getEditorContent() {
  const editor = document.getElementById('modal-description-editor');
  if (!editor) return '';
  const text = editor.innerText.trim();
  if (!text) return '';
  return editor.innerHTML.trim();
}

function clearEditor() {
  const editor = document.getElementById('modal-description-editor');
  const hiddenInput = document.getElementById('modal-description');
  if (editor) editor.innerHTML = '';
  if (hiddenInput) hiddenInput.value = '';
  updateEditorToolbarState();
}

function syncEditorToInput() {
  const editor = document.getElementById('modal-description-editor');
  const hiddenInput = document.getElementById('modal-description');
  if (editor && hiddenInput) {
    const text = editor.innerText.trim();
    hiddenInput.value = text ? editor.innerHTML.trim() : '';
  }
}

function updateEditorToolbarState() {
  const commands = [
    { cmd: 'bold', selector: '.editor-btn[data-cmd="bold"]' },
    { cmd: 'italic', selector: '.editor-btn[data-cmd="italic"]' },
    { cmd: 'underline', selector: '.editor-btn[data-cmd="underline"]' },
    { cmd: 'strikeThrough', selector: '.editor-btn[data-cmd="strikeThrough"]' },
    { cmd: 'insertUnorderedList', selector: '.editor-btn[data-cmd="insertUnorderedList"]' },
    { cmd: 'insertOrderedList', selector: '.editor-btn[data-cmd="insertOrderedList"]' }
  ];

  commands.forEach(({ cmd, selector }) => {
    const btn = document.querySelector(selector);
    if (btn) {
      try {
        const isActive = document.queryCommandState(cmd);
        btn.classList.toggle('is-active', !!isActive);
      } catch {
        btn.classList.remove('is-active');
      }
    }
  });
}

function initRichEditor() {
  const toolbar = document.querySelector('.rich-editor-toolbar');
  const editor = document.getElementById('modal-description-editor');
  if (!toolbar || !editor) return;

  toolbar.querySelectorAll('.editor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      editor.focus();

      const cmd = btn.getAttribute('data-cmd');
      const val = btn.getAttribute('data-val');

      if (cmd === 'createLink') {
        const url = prompt('Enter link URL (e.g. https://example.com):', 'https://');
        if (url && url.trim() && url.trim() !== 'https://') {
          document.execCommand(cmd, false, url.trim());
        }
      } else if (cmd === 'formatBlock') {
        document.execCommand(cmd, false, `<${val}>`);
      } else if (cmd === 'removeFormat') {
        document.execCommand('removeFormat', false, null);
        document.execCommand('formatBlock', false, '<p>');
      } else {
        document.execCommand(cmd, false, val || null);
      }

      updateEditorToolbarState();
      syncEditorToInput();
    });
  });

  editor.addEventListener('input', () => {
    syncEditorToInput();
  });

  editor.addEventListener('blur', () => {
    syncEditorToInput();
  });

  editor.addEventListener('keyup', updateEditorToolbarState);
  editor.addEventListener('mouseup', updateEditorToolbarState);
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) {
      updateEditorToolbarState();
    }
  });
}

// Image Gallery & Upload Helpers
function handleImageSelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const previewUrl = URL.createObjectURL(file);
    pendingNewImages.push({
      id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      file,
      previewUrl
    });
  });

  // Reset file input so selecting the same file again triggers change event
  event.target.value = '';
  renderImagePreviews();
}

function removeExistingProductImage(index) {
  if (index >= 0 && index < existingProductImages.length) {
    existingProductImages.splice(index, 1);
    const fileInput = document.getElementById('modal-images');
    if (fileInput) fileInput.value = '';
    renderImagePreviews();
  }
}

function removePendingProductImage(id) {
  const index = pendingNewImages.findIndex(img => img.id === id);
  if (index !== -1) {
    const item = pendingNewImages[index];
    try {
      URL.revokeObjectURL(item.previewUrl);
    } catch {}
    pendingNewImages.splice(index, 1);
    const fileInput = document.getElementById('modal-images');
    if (fileInput) fileInput.value = '';
    renderImagePreviews();
  }
}

function cleanupPendingImages() {
  pendingNewImages.forEach(img => {
    try {
      URL.revokeObjectURL(img.previewUrl);
    } catch {}
  });
  pendingNewImages = [];
  const fileInput = document.getElementById('modal-images');
  if (fileInput) fileInput.value = '';
}

function renderImagePreviews() {
  const container = document.getElementById('modal-image-previews');
  const countBadge = document.getElementById('image-count-badge');
  if (!container) return;

  const totalCount = existingProductImages.length + pendingNewImages.length;
  if (countBadge) {
    countBadge.textContent = `${totalCount} ${totalCount === 1 ? 'image' : 'images'}`;
  }

  if (totalCount === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'grid';
  let html = '';

  // Render existing backend images
  existingProductImages.forEach((url, idx) => {
    const isCover = idx === 0;
    html += `
      <div class="image-preview-card" title="Server image #${idx + 1}">
        <img src="${escapeHtml(url)}" alt="Product Image ${idx + 1}" class="preview-thumb" onerror="handleImgError(this)">
        ${isCover ? '<span class="preview-badge-cover">Cover</span>' : ''}
        <button type="button" class="preview-remove-btn" onclick="removeExistingProductImage(${idx})" title="Remove image" aria-label="Remove image">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
  });

  // Render pending newly selected images
  pendingNewImages.forEach((item, pIdx) => {
    const isCover = existingProductImages.length === 0 && pIdx === 0;
    html += `
      <div class="image-preview-card" title="${escapeHtml(item.file.name)}">
        <img src="${item.previewUrl}" alt="${escapeHtml(item.file.name)}" class="preview-thumb">
        ${isCover ? '<span class="preview-badge-cover">Cover</span>' : '<span class="preview-badge-status">New</span>'}
        <button type="button" class="preview-remove-btn" onclick="removePendingProductImage('${item.id}')" title="Remove image" aria-label="Remove image">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
  });

  container.innerHTML = html;
}

function initImageUploader() {
  const fileInput = document.getElementById('modal-images');
  if (fileInput) {
    fileInput.addEventListener('change', handleImageSelection);
  }

  const dropzone = document.getElementById('image-dropzone');
  if (dropzone) {
    ['dragenter', 'dragover'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.style.borderColor = 'var(--primary)';
        dropzone.style.background = 'rgba(255, 107, 53, 0.08)';
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.style.borderColor = '';
        dropzone.style.background = '';
      });
    });
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt ? Array.from(dt.files) : [];
      if (!files.length) return;
      files.forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const previewUrl = URL.createObjectURL(file);
        pendingNewImages.push({
          id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          file,
          previewUrl
        });
      });
      renderImagePreviews();
    });
  }
}

function openProductModal() {
  const form = document.getElementById('product-form');
  if (form) form.reset();

  document.getElementById('modal-product-id').value = '';
  document.getElementById('modal-title').textContent = 'Add New Product';

  clearEditor();
  cleanupPendingImages();
  existingProductImages = [];
  renderImagePreviews();

  if (document.getElementById('modal-weight')) document.getElementById('modal-weight').value = '';
  if (document.getElementById('modal-length')) document.getElementById('modal-length').value = '';
  if (document.getElementById('modal-width')) document.getElementById('modal-width').value = '';
  if (document.getElementById('modal-height')) document.getElementById('modal-height').value = '';

  document.getElementById('product-modal').classList.add('active');
}

function openEditModal(productId) {
  const product = allProducts.find(p => (p._id || p.id) === productId);
  if (!product) return;

  document.getElementById('modal-title').textContent = 'Edit Product';
  document.getElementById('modal-product-id').value = productId;
  document.getElementById('modal-name').value = product.name || '';
  document.getElementById('modal-category').value = product.category || 'clothing';
  document.getElementById('modal-brand').value = product.brand || '';
  document.getElementById('modal-original-price').value = product.originalPrice || '';
  document.getElementById('modal-price').value = product.price || '';
  document.getElementById('modal-stock').value = product.stock || 0;

  // Initialize description in Rich Text Editor
  setEditorContent(product.description || '');

  // Populate Images
  cleanupPendingImages();
  const rawImgs = (Array.isArray(product.images) && product.images.length > 0)
    ? product.images
    : (product.image ? [product.image] : []);
  existingProductImages = [...rawImgs];
  renderImagePreviews();

  // Populate Package & Delivery Details
  const dims = product.dimensions || product.dimentions || {};
  const weight = product.weight ?? dims.weight ?? '';
  const length = dims.length ?? '';
  const width = dims.width ?? '';
  const height = dims.height ?? '';

  if (document.getElementById('modal-weight')) document.getElementById('modal-weight').value = weight;
  if (document.getElementById('modal-length')) document.getElementById('modal-length').value = length;
  if (document.getElementById('modal-width')) document.getElementById('modal-width').value = width;
  if (document.getElementById('modal-height')) document.getElementById('modal-height').value = height;

  document.getElementById('product-modal').classList.add('active');
}

function closeProductModal() {
  const modal = document.getElementById('product-modal');
  if (modal) modal.classList.remove('active');
  cleanupPendingImages();
  existingProductImages = [];
  clearEditor();
}

async function fetchImgbbKey() {
  if (cachedImgbbKey) return cachedImgbbKey;
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const data = await res.json();
    if (data.imgbbKey) cachedImgbbKey = data.imgbbKey;
    return cachedImgbbKey;
  } catch {
    return null;
  }
}

async function uploadToImgBB(file) {
  const key = await fetchImgbbKey();
  if (!key) throw new Error('Image host API key not configured on server');

  const formData = new FormData();
  formData.append('image', file);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  if (result.success && result.data && result.data.url) {
    return result.data.url;
  }
  throw new Error('Image upload failed');
}

// Product Form Submit Handler
const productForm = document.getElementById('product-form');
if (productForm) {
  productForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('btn-save-product');
    const originalText = submitBtn.innerHTML;

    // Validate Rich Description
    const descHtml = getEditorContent();
    const descText = descHtml.replace(/<[^>]*>/g, '').trim();
    if (!descText) {
      showToast('Product description is required', 'error');
      const editorEl = document.getElementById('modal-description-editor');
      if (editorEl) {
        editorEl.focus();
        editorEl.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.3)';
        setTimeout(() => { editorEl.style.boxShadow = ''; }, 2500);
      }
      return;
    }

    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    submitBtn.disabled = true;

    try {
      const productId = document.getElementById('modal-product-id').value;

      // Upload any pending new images
      const uploadedUrls = [];
      if (pendingNewImages.length > 0) {
        submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Uploading images (${pendingNewImages.length})...`;
        for (let i = 0; i < pendingNewImages.length; i++) {
          const url = await uploadToImgBB(pendingNewImages[i].file);
          uploadedUrls.push(url);
        }
      }

      // Combine existing images (minus removed ones) + new uploads
      const finalImages = [...existingProductImages, ...uploadedUrls];

      // Package & Delivery Details
      const weightRaw = document.getElementById('modal-weight')?.value?.trim();
      const lengthRaw = document.getElementById('modal-length')?.value?.trim();
      const widthRaw = document.getElementById('modal-width')?.value?.trim();
      const heightRaw = document.getElementById('modal-height')?.value?.trim();

      const weight = weightRaw ? Math.max(0, parseFloat(weightRaw)) : null;
      const length = lengthRaw ? Math.max(0, parseFloat(lengthRaw)) : null;
      const width = widthRaw ? Math.max(0, parseFloat(widthRaw)) : null;
      const height = heightRaw ? Math.max(0, parseFloat(heightRaw)) : null;

      const dimensionsObj = {
        weight,
        length,
        width,
        height,
        unit: 'cm'
      };

      const productPayload = {
        name: document.getElementById('modal-name').value.trim(),
        category: document.getElementById('modal-category').value,
        brand: document.getElementById('modal-brand').value.trim(),
        description: descHtml,
        originalPrice: document.getElementById('modal-original-price').value ? parseFloat(document.getElementById('modal-original-price').value) : null,
        price: parseFloat(document.getElementById('modal-price').value),
        stock: parseInt(document.getElementById('modal-stock').value, 10),
        weight,
        dimensions: dimensionsObj,
        dimentions: dimensionsObj,
        images: finalImages,
        image: finalImages[0] || '',
        availability: true
      };

      const method = productId ? 'PUT' : 'POST';
      const url = productId 
        ? `${API_BASE}/api/products?id=${encodeURIComponent(productId)}` 
        : `${API_BASE}/api/products`;

      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productPayload)
      });

      if (!res || !res.ok) {
        const errData = res ? await res.json().catch(() => ({})) : {};
        throw new Error(errData.error || errData.message || 'Database save operation failed');
      }

      showToast(productId ? 'Product updated successfully' : 'New product created successfully');
      closeProductModal();
      await loadProductsData();
      loadDashboardData().catch(() => {});
    } catch (err) {
      showToast(err.message || 'Error saving product', 'error');
    } finally {
      submitBtn.innerHTML = originalText;
      submitBtn.disabled = false;
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 9. CUSTOMERS VIEW CONTROLLER
// ──────────────────────────────────────────────────────────────────────────

async function loadCustomersData() {
  const container = document.getElementById('customers-view');
  if (!container) return;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Customers</h1>
        <span class="subtitle">Customer accounts, delivery addresses and registration channels</span>
      </div>
    </div>
    <div class="card empty-state">
      <i class="fas fa-spinner fa-spin empty-icon"></i>
      <h3>Loading customers</h3>
      <p>Retrieving customer registry from database...</p>
    </div>`;

  try {
    const res = await authFetch(`${API_BASE}/api/users`);
    if (!res || !res.ok) throw new Error('Failed to load customers');

    allCustomers = await res.json();
    renderCustomers(allCustomers);
  } catch (error) {
    console.error('Customers error:', error);
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-text">
          <h1>Customers</h1>
          <span class="subtitle">Customer accounts, delivery addresses and registration channels</span>
        </div>
      </div>
      <div class="card error-state">
        <i class="fas fa-circle-exclamation"></i>
        <h3>Unable to Load Customers</h3>
        <p style="margin-bottom: 16px;">${escapeHtml(error.message || 'Server error occurred.')}</p>
        <button class="btn btn-primary" onclick="loadCustomersData()"><i class="fas fa-rotate"></i> Retry</button>
      </div>`;
  }
}

function renderCustomers(users) {
  const container = document.getElementById('customers-view');
  if (!container) return;

  const headerHtml = `
    <div class="page-header">
      <div class="page-header-text">
        <h1>Customers <span style="font-size: 14px; font-weight: 600; color: var(--text-muted);">(${users.length})</span></h1>
        <span class="subtitle">Customer accounts, verified phone numbers and default addresses</span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" onclick="loadCustomersData()" title="Refresh Customers"><i class="fas fa-rotate"></i></button>
      </div>
    </div>
    <div class="filters-row">
      <div class="search-box-wrapper" style="max-width: 100%;">
        <i class="fas fa-magnifying-glass search-icon"></i>
        <input type="text" id="customer-search" placeholder="Search by name, email or phone number..." value="${escapeHtml(customerSearchQuery)}" oninput="filterCustomers(this.value)" class="form-input">
      </div>
    </div>`;

  if (!users || users.length === 0) {
    container.innerHTML = headerHtml + `
      <div class="card empty-state">
        <i class="fas fa-user-group empty-icon"></i>
        <h3>No registered customers</h3>
        <p>Customer accounts created in the app will appear here.</p>
      </div>`;
    return;
  }

  const rows = users.map(u => {
    const uId = u._id || u.userId || u.id;
    const initial = (u.name || u.email || 'K').trim().charAt(0).toUpperCase();
    let d = u.createdAt ? new Date(u.createdAt) : null;
    if (!d || isNaN(d.getTime())) {
      const idStr = String(u._id || '');
      if (/^[0-9a-fA-F]{24}$/.test(idStr)) {
        const sec = parseInt(idStr.substring(0, 8), 16);
        if (!isNaN(sec) && sec > 1500000000) d = new Date(sec * 1000);
      }
      if ((!d || isNaN(d.getTime())) && u.userId) {
        const match = String(u.userId).match(/^user-(\d{10,13})$/);
        if (match) {
          const ts = parseInt(match[1], 10);
          d = new Date(ts < 10000000000 ? ts * 1000 : ts);
        }
      }
    }
    const joined = (d && !isNaN(d.getTime())) 
      ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) 
      : '—';

    const addrs = Array.isArray(u.addresses) ? u.addresses : [];
    const addr = addrs.find(a => a.isDefault) || (addrs.length ? addrs[addrs.length - 1] : null);
    
    let locationText = '—';
    if (addr) {
      const parts = [addr.city, addr.state].filter(Boolean);
      if (parts.length) locationText = parts.join(', ');
      else if (addr.pincode || addr.zipcode || addr.zip) locationText = `PIN: ${addr.pincode || addr.zipcode || addr.zip}`;
      else if (addr.address || addr.street) locationText = (addr.address || addr.street).slice(0, 30);
    }

    const provider = u.authProvider || u.provider || (u.phone && !u.email ? 'phone' : 'email');
    const addrCount = addrs.length;

    const addressSubtitle = addrCount > 0
      ? `<span class="cell-sub" style="cursor: pointer; color: var(--primary); font-weight: 600;" onclick="viewCustomerAddresses('${uId}')" title="Click to view addresses"><i class="fas fa-location-dot"></i> ${addrCount} saved address(es)</span>`
      : `<div class="cell-sub">0 saved address(es)</div>`;

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 12px;">
            <span class="cell-avatar">${escapeHtml(initial)}</span>
            <div>
              <div class="cell-strong" style="cursor: pointer;" onclick="viewCustomerAddresses('${uId}')">${escapeHtml(u.name || 'Unnamed Customer')}</div>
              ${addressSubtitle}
            </div>
          </div>
        </td>
        <td>
          <div>${escapeHtml(u.email || '—')}</div>
          <div class="cell-sub">${escapeHtml(u.phone || '—')}</div>
        </td>
        <td>${escapeHtml(locationText)}</td>
        <td><span class="badge-pill pv-${escapeHtml(provider)}">${escapeHtml(provider)}</span></td>
        <td>${escapeHtml(joined)}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 5px 12px; font-size: 12px;" onclick="viewCustomerAddresses('${uId}')">
            <i class="fas fa-address-book"></i> Addresses
          </button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = headerHtml + `
    <div class="table-wrap">
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact Details</th>
              <th>Location</th>
              <th>Channel</th>
              <th>Joined Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function viewCustomerAddresses(customerId) {
  const user = allCustomers.find(u => String(u._id || u.userId || u.id) === String(customerId));
  if (!user) {
    showToast('Customer record not found', 'error');
    return;
  }

  const modal = document.getElementById('customer-modal');
  const nameEl = document.getElementById('cust-modal-name');
  const countEl = document.getElementById('cust-modal-count');
  const bodyEl = document.getElementById('cust-modal-body');

  const addrs = Array.isArray(user.addresses) ? user.addresses : [];

  if (nameEl) nameEl.textContent = `${user.name || 'Customer'}'s Addresses`;
  if (countEl) countEl.textContent = `${addrs.length} Saved Address${addrs.length === 1 ? '' : 'es'}`;

  if (!addrs.length) {
    bodyEl.innerHTML = `
      <div class="empty-state" style="padding: 30px 20px;">
        <i class="fas fa-map-location-dot empty-icon"></i>
        <h3>No addresses on file</h3>
        <p>This customer has not saved any shipping addresses in their mobile app or web profile yet.</p>
      </div>`;
  } else {
    bodyEl.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${addrs.map((a, idx) => {
          const isDef = !!a.isDefault;
          const fullName = a.name || `${a.firstName || ''} ${a.lastName || ''}`.trim() || user.name || 'Recipient';
          const fullAddress = [
            a.address || a.street,
            a.apartment || a.address2,
            a.city,
            a.state,
            a.pincode || a.zipcode || a.zip,
            a.country || 'India'
          ].filter(Boolean).join(', ');

          const phone = a.phone || user.phone || '—';

          return `
            <div class="order-info-card" style="border: 1px solid var(--border); background: var(--surface-card);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div class="cell-strong" style="font-size: 14px;">${escapeHtml(fullName)}</div>
                ${isDef ? `<span class="badge-pill st-delivered"><i class="fas fa-star" style="font-size: 9px;"></i> Default Address</span>` : `<span class="cell-sub">Address #${idx + 1}</span>`}
              </div>
              <div style="font-size: 13px; color: var(--text-body); line-height: 1.5; margin-bottom: 6px;">
                ${escapeHtml(fullAddress)}
              </div>
              <div class="cell-sub" style="display: flex; gap: 16px; align-items: center;">
                <span><i class="fas fa-phone" style="font-size: 10px;"></i> ${escapeHtml(phone)}</span>
                ${a.fromOrderHistory ? `<span class="badge-pill" style="background:#F1F5F9; color:#64748B; font-size:10.5px;">From Recent Order</span>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  if (modal) modal.classList.add('active');
}

function closeCustomerModal() {
  const modal = document.getElementById('customer-modal');
  if (modal) modal.classList.remove('active');
}

function filterCustomers(query) {
  customerSearchQuery = query;
  const q = query.toLowerCase().trim();
  const filtered = allCustomers.filter(u =>
    (u.name || '').toLowerCase().includes(q) ||
    (u.email || '').toLowerCase().includes(q) ||
    (u.phone || '').includes(q)
  );
  renderCustomers(filtered);
}

// ──────────────────────────────────────────────────────────────────────────
// 10. PROMO CODES VIEW CONTROLLER
// ──────────────────────────────────────────────────────────────────────────

const API_PROMO_URL = `${STOREFRONT_API}/api/promo`;

async function fetchPromoCodes() {
  const container = document.getElementById('promo-list-container');
  if (!container) return;

  container.innerHTML = `<div class="empty-state" style="padding: 24px;"><i class="fas fa-spinner fa-spin empty-icon"></i><p>Loading promo codes...</p></div>`;

  try {
    const res = await fetch(API_PROMO_URL);
    if (!res.ok) throw new Error('Could not fetch promos from storefront');

    allPromos = await res.json();
    renderPromosList(allPromos);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 24px;">
        <p style="color: var(--danger-text);">Failed to load active promo codes.</p>
        <button class="btn btn-secondary" onclick="fetchPromoCodes()"><i class="fas fa-rotate"></i> Retry</button>
      </div>`;
  }
}

function renderPromosList(promos) {
  const container = document.getElementById('promo-list-container');
  if (!container) return;

  if (!promos || promos.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 24px;"><p>No active promo codes found. Create one above!</p></div>`;
    return;
  }

  const rows = promos.map(p => {
    let valStr = '';
    if (p.discountType === 'percentage') valStr = `${p.discountValue}% OFF`;
    else if (p.discountType === 'flat') valStr = `₹${p.discountValue} OFF`;
    else valStr = 'FREE DELIVERY';

    const typeStr = (p.discountType || 'voucher').replace('_', ' ').toUpperCase();

    return `
      <tr>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="badge-pill" style="background: var(--primary-light); color: var(--primary); font-size: 13px; font-weight: 700; letter-spacing: 0.05em; font-family: monospace;">
              ${escapeHtml(p.code)}
            </span>
            <button class="icon-btn" style="width: 28px; height: 28px; font-size: 11px;" onclick="copyPromoCode('${escapeHtml(p.code)}')" title="Copy Code">
              <i class="fas fa-copy"></i>
            </button>
          </div>
        </td>
        <td><span class="cell-sub" style="font-weight: 600;">${escapeHtml(typeStr)}</span></td>
        <td><span class="cell-strong" style="color: var(--success-text);">${escapeHtml(valStr)}</span></td>
        <td>
          <button class="icon-btn" style="color: var(--danger);" onclick="confirmDeletePromo('${p._id || p.id}', '${escapeHtml(p.code)}')" title="Delete Promo">
            <i class="fas fa-trash-can"></i>
          </button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Coupon Code</th>
            <th>Type</th>
            <th>Discount Benefit</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function copyPromoCode(code) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code)
      .then(() => showToast(`Code "${code}" copied to clipboard!`))
      .catch(() => showToast(`Code: ${code}`, 'info'));
  } else {
    showToast(`Code: ${code}`, 'info');
  }
}

function handlePromoTypeChange() {
  const type = document.getElementById('promo-type').value;
  const valueGroup = document.getElementById('promo-value-group');
  const valueInput = document.getElementById('promo-value');
  const label = document.getElementById('promo-value-label');

  if (type === 'free_shipping') {
    if (valueGroup) valueGroup.style.display = 'none';
    if (valueInput) valueInput.value = '0';
  } else {
    if (valueGroup) valueGroup.style.display = 'block';
    if (label) {
      label.innerHTML = type === 'percentage' 
        ? 'Discount Percentage (%) <span class="req">*</span>' 
        : 'Flat Discount Amount (₹) <span class="req">*</span>';
    }
  }
}

function generateRandomPromoCodeName() {
  const prefixes = ['KIDO', 'SAVE', 'DEAL', 'BABY', 'JOY', 'CART'];
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num = Math.floor(10 + Math.random() * 89);
  const input = document.getElementById('promo-code-input');
  if (input) input.value = `${p}${num}`;
}

async function handleCreatePromo(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-create-promo');
  const type = document.getElementById('promo-type').value;
  let code = document.getElementById('promo-code-input').value.trim().toUpperCase();
  const value = document.getElementById('promo-value').value || 0;

  if (type !== 'free_shipping' && (!value || Number(value) <= 0)) {
    showToast('Please enter a valid discount value', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

  try {
    const payload = {
      discountType: type,
      discountValue: Number(value)
    };
    if (code) payload.code = code;

    const res = await fetch(API_PROMO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create promo voucher');

    showToast(`Created promo code: ${data.code || code}`);
    document.getElementById('promo-create-form').reset();
    handlePromoTypeChange();
    fetchPromoCodes();
  } catch (err) {
    showToast(err.message || 'Error creating promo', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Create Promo Code';
  }
}

function confirmDeletePromo(id, code) {
  openConfirmModal(
    'Delete Promo Code',
    `Are you sure you want to delete "${code}"? Shoppers will immediately no longer be able to apply this discount.`,
    async () => {
      try {
        const res = await fetch(`${API_PROMO_URL}?id=${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
        if (!res.ok) throw new Error('Deletion failed on server');

        showToast(`Promo "${code}" deleted`);
        fetchPromoCodes();
      } catch (err) {
        showToast(err.message || 'Could not delete promo', 'error');
      }
    }
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 11. APP CONTENT (MARQUEE, FLASH SALE & HERO CAROUSEL)
// ──────────────────────────────────────────────────────────────────────────

const APPCONFIG_URL = `${API_BASE}/api/appconfig`;
let appConfig = null;
let carouselBanners = [];
const BANNER_CATEGORIES = ['', 'clothing', 'toys', 'feeding', 'diapers', 'furniture', 'gear', 'bath', 'books'];

function toLocalInput(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

async function loadAppContent() {
  try {
    const res = await fetch(APPCONFIG_URL);
    appConfig = res.ok ? await res.json() : {};
  } catch {
    appConfig = {};
  }

  // 1. Announcement Marquee
  const ann = appConfig.announcement || {};
  const enabledEl = document.getElementById('ann-enabled');
  if (enabledEl) enabledEl.checked = ann.enabled !== false;
  const msgs = (ann.messages && ann.messages.length)
    ? ann.messages
    : ['Free Shipping over ₹499', 'Flash Sale — Live Now', 'Buy 2 Get 1 Free'];
  renderMessageRows(msgs);
  updateAnnPreview();

  // 2. Flash Sale
  const fs = appConfig.flashSale || {};
  const fsEnabledEl = document.getElementById('fs-enabled');
  if (fsEnabledEl) {
    fsEnabledEl.checked = !!fs.enabled;
    document.getElementById('fs-title').value = fs.title || 'Flash Sale';
    document.getElementById('fs-subtitle').value = fs.subtitle || 'Ends in — grab them fast!';
    document.getElementById('fs-end').value = fs.endTime ? toLocalInput(fs.endTime) : '';
  }

  // 3. Carousel Banners
  carouselBanners = Array.isArray(appConfig.carousel) ? appConfig.carousel.map(b => ({ ...b })) : [];
  renderCarousel();
}

function renderCarousel() {
  const wrap = document.getElementById('carousel-list');
  if (!wrap) return;

  if (!carouselBanners.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding: 24px;"><i class="fas fa-image empty-icon"></i><p>No carousel banners added yet. Tap "Add Banner" to upload hero promotional sliders.</p></div>`;
    return;
  }

  wrap.innerHTML = carouselBanners.map((b, i) => `
    <div class="banner-row">
      <label class="banner-thumb" style="${b.image ? `background-image:url('${escapeHtml(b.image)}')` : ''}">
        ${b.image ? '' : '<i class="fas fa-cloud-arrow-up"></i>'}
        <input type="file" accept="image/*" onchange="uploadBannerImage(${i}, this)" style="display:none;">
      </label>
      <div style="flex: 1; min-width: 0;">
        <input class="form-input" style="margin-bottom: 8px;" placeholder="Banner Title (e.g. Summer Essentials)" value="${escapeHtml(b.title || '')}" oninput="carouselBanners[${i}].title=this.value">
        <input class="form-input" style="margin-bottom: 8px;" placeholder="Subtitle / Offer tag" value="${escapeHtml(b.subtitle || '')}" oninput="carouselBanners[${i}].subtitle=this.value">
        <select class="form-input" onchange="carouselBanners[${i}].category=this.value">
          ${BANNER_CATEGORIES.map(c => `<option value="${c}" ${b.category === c ? 'selected' : ''}>${c ? 'Deep links to: ' + c : 'No link action'}</option>`).join('')}
        </select>
      </div>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <label class="switch" title="Enable or Disable Banner">
          <input type="checkbox" ${b.enabled !== false ? 'checked' : ''} onchange="carouselBanners[${i}].enabled=this.checked">
          <span class="switch-track"></span>
        </label>
        <button class="icon-btn" style="color: var(--danger); width: 32px; height: 32px;" onclick="removeCarouselBanner(${i})" title="Remove Banner">
          <i class="fas fa-trash-can"></i>
        </button>
      </div>
    </div>`).join('');
}

function addCarouselBanner() {
  carouselBanners.push({ image: '', title: '', subtitle: '', category: '', enabled: true });
  renderCarousel();
}

function removeCarouselBanner(i) {
  carouselBanners.splice(i, 1);
  renderCarousel();
}

async function uploadBannerImage(i, input) {
  if (!input.files || !input.files[0]) return;
  showToast('Uploading banner image...');
  try {
    const url = await uploadToImgBB(input.files[0]);
    carouselBanners[i].image = url;
    renderCarousel();
    showToast('Banner image uploaded!');
  } catch (e) {
    showToast('Image upload failed', 'error');
  }
}

function renderMessageRows(msgs) {
  const container = document.getElementById('ann-messages');
  if (!container) return;
  container.innerHTML = msgs.map(m => messageRowHTML(m)).join('');
}

function messageRowHTML(val = '') {
  return `
    <div class="ann-msg-row">
      <input class="form-input" value="${escapeHtml(val)}" oninput="updateAnnPreview()" placeholder="e.g. Free Express Delivery over ₹499">
      <button class="icon-btn" style="color: var(--danger); width: 34px; height: 34px; flex-shrink: 0;" onclick="this.parentElement.remove(); updateAnnPreview()" title="Delete Message">
        <i class="fas fa-trash-can"></i>
      </button>
    </div>`;
}

function addMessageRow() {
  const container = document.getElementById('ann-messages');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', messageRowHTML(''));
}

function getMessages() {
  return [...document.querySelectorAll('#ann-messages input')].map(i => i.value.trim()).filter(Boolean);
}

function updateAnnPreview() {
  const track = document.getElementById('ann-preview-track');
  if (!track) return;
  const msgs = getMessages();
  const seq = msgs.length ? msgs : ['Announcement preview ticker text'];
  track.innerHTML = [...seq, ...seq].map(m => `<span>${escapeHtml(m)}</span>`).join('');
}

async function saveAppContent() {
  const annEl = document.getElementById('ann-enabled');
  const fsEl = document.getElementById('fs-enabled');

  const body = {
    announcement: {
      enabled: annEl ? annEl.checked : true,
      messages: getMessages()
    }
  };

  if (fsEl) {
    const endVal = document.getElementById('fs-end').value;
    body.flashSale = {
      enabled: fsEl.checked,
      title: document.getElementById('fs-title').value.trim() || 'Flash Sale',
      subtitle: document.getElementById('fs-subtitle').value.trim(),
      endTime: endVal ? new Date(endVal).toISOString() : null
    };
  }

  body.carousel = carouselBanners.filter(b => b.image);

  try {
    const res = await authFetch(APPCONFIG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res || !res.ok) throw new Error('Failed to publish content config to server');

    showToast('Published configuration to mobile app!');
  } catch (e) {
    showToast(e.message || 'Error saving app content', 'error');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 12. PUSH NOTIFICATIONS BROADCAST
// ──────────────────────────────────────────────────────────────────────────

async function loadNotificationStats() {
  const el = document.getElementById('notif-device-count');
  if (!el) return;

  el.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 18px;"></i>';

  try {
    const res = await authFetch(`${API_BASE}/api/notifications`);
    if (!res || !res.ok) throw new Error('Failed to load notification stats');

    const data = await res.json();
    el.textContent = data.registeredDevices || 0;
  } catch (e) {
    el.textContent = '0';
    console.warn('Notification stats error:', e.message);
  }
}

async function handleSendPushNotification(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-send-notif');
  const statusBox = document.getElementById('notif-status-box');
  const title = document.getElementById('notif-title').value.trim();
  const body = document.getElementById('notif-body').value.trim();
  const type = document.getElementById('notif-type').value;
  const url = document.getElementById('notif-url').value.trim();

  if (!title || !body) {
    showToast('Please enter both title and body', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Broadcasting...';
  if (statusBox) statusBox.style.display = 'none';

  try {
    const res = await authFetch(`${API_BASE}/api/notifications?action=send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        body,
        type,
        data: { url }
      })
    });

    const data = await res.json();
    if (!res || !res.ok) throw new Error(data.error || 'Failed to dispatch notification');

    showToast('Push notification broadcasted successfully!');
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.style.background = 'var(--success-light)';
      statusBox.style.color = 'var(--success-text)';
      statusBox.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      statusBox.innerHTML = `<strong>Broadcast Result:</strong> ${escapeHtml(data.status)} &bull; ${data.sentCount || 0} device(s) notified`;
    }

    document.getElementById('push-notification-form').reset();
    loadNotificationStats();
  } catch (err) {
    showToast(err.message || 'Error sending notification', 'error');
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.style.background = 'var(--danger-light)';
      statusBox.style.color = 'var(--danger-text)';
      statusBox.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      statusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message)}`;
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Push Notification';
  }
}
