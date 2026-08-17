// ==========================================
// KidoCart Admin - Core Application Logic
// ==========================================

// Route Guard: If no token is found, automatically bounce back to login screen
if (!localStorage.getItem('admin_token') && !window.location.href.includes('login.html')) {
    window.location.href = 'login.html';
}

// Deployed admin backend. Absolute URL so the dashboard works both from Live
// Server (localhost:5500) during dev AND when hosted at admin.kidocart.shop.
const API_BASE = 'https://admin.kidocart.shop';
let allProducts = [];
let allAdminOrders = []; // NEW: Global state for sorting orders
let cachedImgbbKey = null;

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadDashboardData(); 
});

// ─── UTILITIES ───
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check' : 'fa-exclamation-triangle'}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ─── NAVIGATION ───
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const viewSections = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = item.getAttribute('data-target');
            
            viewSections.forEach(section => section.classList.remove('active'));
            navItems.forEach(nav => nav.classList.remove('active'));
            
            document.getElementById(targetId).classList.add('active');
            document.querySelectorAll(`.nav-item[data-target="${targetId}"]`).forEach(matchedNav => {
                matchedNav.classList.add('active');
            });

            if(targetId === 'dashboard-view') loadDashboardData();
            if(targetId === 'products-view') loadProductsData();
            if(targetId === 'customers-view') loadCustomersData();
            if(targetId === 'orders-view') loadOrdersData();
            if(targetId === 'content-view') loadAppContent();
        });
    });
}

function logout() {
    localStorage.removeItem('admin_token');
    window.location.href = 'login.html';
}

// ─── DASHBOARD ───
async function loadDashboardData() {
    document.getElementById('dash-sales').innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 20px;"></i>';
    document.getElementById('dash-pending').innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 20px;"></i>';
    document.getElementById('dash-stock').innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 20px;"></i>';

    try {
        const token = localStorage.getItem('admin_token'); 
        const headers = { 'Authorization': `Bearer ${token}` };

        const [prodRes, orderRes] = await Promise.all([
            fetch(`${API_BASE}/api/products`, { headers }),
            fetch(`${API_BASE}/api/orders?admin=true`, { headers }) 
        ]);

        if (!prodRes.ok) return;
        
        const products = await prodRes.json();
        const orders = orderRes.ok ? await orderRes.json() : [];

        const lowStockCount = products.filter(p => p.stock <= 10).length;
        const pendingOrders = orders.filter(o => o.status === 'pending').length;
        
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        
        const todaysSales = orders
            .filter(o => new Date(o.createdAt) >= startOfToday && o.status !== 'cancelled')
            .reduce((sum, order) => sum + (order.total || 0), 0);

        document.getElementById('dash-sales').textContent = `₹${todaysSales.toLocaleString('en-IN')}`;
        document.getElementById('dash-pending').textContent = pendingOrders;
        document.getElementById('dash-stock').textContent = lowStockCount;

    } catch (error) { 
        console.error("Dashboard Error:", error); 
        document.getElementById('dash-sales').textContent = "Error";
        document.getElementById('dash-pending').textContent = "Error";
        document.getElementById('dash-stock').textContent = "Error";
    }
}

// ─── CUSTOMERS ───
let allCustomers = [];

async function loadCustomersData() {
    const container = document.getElementById('customers-view');
    container.innerHTML = `
        <div class="page-header"><h1>Customers</h1></div>
        <div class="card empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading customers...</p></div>`;
    try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`${API_BASE}/api/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed');
        allCustomers = await res.json();
        renderCustomers(allCustomers);
    } catch (error) {
        container.innerHTML = `<div class="page-header"><h1>Customers</h1></div><div class="card empty-state">Error loading customers</div>`;
    }
}

function renderCustomers(users) {
    const container = document.getElementById('customers-view');
    const header = `
        <div class="page-header"><h1>Customers <span style="font-size:14px;color:var(--text-muted);font-weight:500;">(${users.length})</span></h1></div>
        <div style="margin-bottom:20px;">
            <input type="text" id="customer-search" placeholder="🔍 Search by name, email or phone..." onkeyup="filterCustomers()" class="form-input">
        </div>`;

    if (!users.length) {
        container.innerHTML = header + `<div class="card empty-state"><i class="fas fa-users"></i><p>No customers yet</p></div>`;
        return;
    }

    const rows = users.map(u => {
        const initial = (u.name || u.email || 'K').trim().charAt(0).toUpperCase();
        const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'}) : '—';
        const addr = (u.addresses && u.addresses.length) ? u.addresses[u.addresses.length - 1] : null;
        const city = addr ? [addr.city, addr.state].filter(Boolean).join(', ') : '—';
        const provider = u.authProvider || (u.phone && !u.email ? 'phone' : 'email');
        return `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:12px;">
                <span class="cell-avatar">${initial}</span>
                <div><div class="cell-strong">${u.name || 'No Name'}</div><div class="cell-sub">${(u.addresses||[]).length} address(es)</div></div>
              </div>
            </td>
            <td><div style="word-break:break-all;">${u.email || '—'}</div><div class="cell-sub">${u.phone || '—'}</div></td>
            <td>${city}</td>
            <td><span class="badge-pill pv-${provider}" style="text-transform:capitalize;">${provider}</span></td>
            <td>${joined}</td>
        </tr>`;
    }).join('');

    container.innerHTML = header + `
        <div class="table-wrap"><div class="table-scroll"><table class="data-table">
            <thead><tr><th>Customer</th><th>Contact</th><th>Location</th><th>Signup</th><th>Joined</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div></div>`;
}

function filterCustomers() {
    const q = document.getElementById('customer-search').value.toLowerCase();
    renderCustomers(allCustomers.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.phone || '').includes(q)
    ));
}

// ─── ORDERS (UPGRADED UI & LOGIC) ───
async function loadOrdersData() {
    const list = document.getElementById('orders-view');
    list.innerHTML = `
        <div class="page-header"><h1>Orders</h1></div>
        <div class="card empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading orders...</p></div>
    `;

    try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`${API_BASE}/api/orders?admin=true`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error("Failed to load orders");
        allAdminOrders = await res.json();
        renderOrdersList('all');
    } catch (error) {
        list.innerHTML = `<div class="page-header"><h1>Orders</h1></div><div class="card empty-state">Error loading orders</div>`;
    }
}

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
function statusClass(s) { return 'st-' + (s || 'pending'); }

// Render orders as a structured table with colour-coded status dropdowns
window.renderOrdersList = function(filterStatus = 'all') {
    const container = document.getElementById('orders-view');
    const filtered = filterStatus === 'all'
        ? allAdminOrders
        : allAdminOrders.filter(o => o.status === filterStatus);

    const tabs = ['all', ...ORDER_STATUSES];
    const filterHTML = `
        <div class="page-header"><h1>Orders <span style="font-size:14px;color:var(--text-muted);font-weight:500;">(${allAdminOrders.length})</span></h1></div>
        <div class="filter-tabs">
            ${tabs.map(t => `<button class="filter-tab ${filterStatus === t ? 'active' : ''}" onclick="renderOrdersList('${t}')">${t}</button>`).join('')}
        </div>`;

    if (!filtered.length) {
        container.innerHTML = filterHTML + `<div class="card empty-state"><i class="fas fa-receipt"></i><p>No orders found for this status</p></div>`;
        return;
    }

    const rows = filtered.map(o => {
        const d = new Date(o.createdAt);
        const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const custName = (o.shippingAddress && o.shippingAddress.name)
            ? o.shippingAddress.name
            : (o.shippingAddress && o.shippingAddress.firstName ? `${o.shippingAddress.firstName} ${o.shippingAddress.lastName || ''}` : 'Guest');
        const phone = (o.shippingAddress && o.shippingAddress.phone) ? o.shippingAddress.phone : 'N/A';
        const pay = o.paymentMethod === 'razorpay'
            ? `<span class="badge-pill pv-email" style="text-transform:none;">Online</span>`
            : `<span class="badge-pill" style="background:#f3f4f6;color:#374151;text-transform:none;">COD</span>`;
        const oid = o.orderId || o._id;
        const shortId = (o.orderId || '').replace('ORD-', '').slice(-8) || String(oid).slice(-8);
        const sel = `<select class="status-select ${statusClass(o.status)}" onchange="updateOrderStatus('${oid}', this.value)">
            ${ORDER_STATUSES.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>`;
        return `<tr>
            <td><div class="cell-strong">#${shortId}</div><div class="cell-sub">${o.items ? o.items.length : 0} item(s)</div></td>
            <td>${dateStr}<div class="cell-sub">${timeStr}</div></td>
            <td><div class="cell-strong">${custName}</div><div class="cell-sub">${phone}</div></td>
            <td class="cell-strong">₹${(o.total || 0).toLocaleString('en-IN')}</td>
            <td>${pay}</td>
            <td>${sel}</td>
        </tr>`;
    }).join('');

    container.innerHTML = filterHTML + `
        <div class="table-wrap"><div class="table-scroll"><table class="data-table">
            <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div></div>`;
}

async function updateOrderStatus(orderId, newStatus) {
    try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`${API_BASE}/api/orders?orderId=${orderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: newStatus })
        });

        if (!res.ok) throw new Error("Failed to update status");
        showToast(`Order marked as ${newStatus}`);
        loadOrdersData(); // Refresh list to show new active pill
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ─── PRODUCTS & UI ───
async function loadProductsData() {
    const list = document.getElementById('products-list');
    list.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></div>';

    try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`${API_BASE}/api/products`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error("Failed");
        allProducts = await res.json();
        renderProducts(allProducts);
    } catch (error) {
        list.innerHTML = '<div class="empty-state">Error loading products</div>';
    }
}

function renderProducts(products) {
    const list = document.getElementById('products-list');
    if (products.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><p>No products found</p></div>';
        return;
    }

    list.innerHTML = products.map(p => {
        let firstImg = (p.images && p.images.length > 0) ? p.images[0] : 'https://via.placeholder.com/70?text=No+Img';
        let stockClass = p.stock <= 10 ? 'low' : '';
        let oldPriceHtml = p.originalPrice ? `<span style="text-decoration: line-through; color: var(--text-muted); font-size: 11px; margin-right: 5px;">₹${p.originalPrice}</span>` : '';
        
        const pId = p._id || p.id;

        return `
            <div class="product-card">
                <img src="${firstImg}" alt="${p.name}">
                <div class="product-info">
                    <div class="product-title">${p.name}</div>
                    <div class="product-meta">
                        <span style="text-transform: capitalize;">${p.category || 'Uncategorized'}</span>
                        ${p.brand ? ` • ${p.brand}` : ''}
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div class="product-price">${oldPriceHtml}₹${parseFloat(p.price).toFixed(0)}</div>
                        <div class="product-stock ${stockClass}">Stock: ${p.stock}</div>
                    </div>
                </div>
                <div class="product-actions">
                    <button class="icon-btn" style="color: var(--primary);" onclick="openEditModal('${pId}')" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="icon-btn" style="color: var(--danger, #EF4444);" onclick="deleteProduct('${pId}', '${(p.name || '').replace(/'/g, "\\'")}')" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    }).join('');
}

function filterProducts() {
    const search = document.getElementById('product-search').value.toLowerCase();
    const filtered = allProducts.filter(p =>
        p.name.toLowerCase().includes(search) ||
        (p.brand && p.brand.toLowerCase().includes(search))
    );
    renderProducts(filtered);
}

async function deleteProduct(productId, name) {
    if (!confirm(`Delete "${name || 'this product'}"? This removes it from the store permanently and cannot be undone.`)) return;
    try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`${API_BASE}/api/products?id=${productId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to delete product');
        showToast('Product deleted');
        loadProductsData();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ─── MODAL & IMGBB LOGIC ───
function openProductModal() {
    document.getElementById('product-form').reset();
    document.getElementById('modal-product-id').value = '';
    document.getElementById('modal-title').textContent = 'Add Product';
    document.getElementById('product-modal').classList.add('active');
}

function openEditModal(productId) {
    const product = allProducts.find(p => (p._id || p.id) === productId);
    if (!product) return;

    document.getElementById('modal-title').textContent = 'Edit Product';
    document.getElementById('modal-product-id').value = productId;
    
    document.getElementById('modal-name').value = product.name;
    document.getElementById('modal-category').value = product.category;
    document.getElementById('modal-brand').value = product.brand || '';
    document.getElementById('modal-description').value = product.description || '';
    document.getElementById('modal-original-price').value = product.originalPrice || '';
    document.getElementById('modal-price').value = product.price;
    document.getElementById('modal-stock').value = product.stock;

    document.getElementById('product-modal').classList.add('active');
}

function closeProductModal() {
    document.getElementById('product-modal').classList.remove('active');
}

async function fetchImgbbKey() {
    if (cachedImgbbKey) return cachedImgbbKey;
    const res = await fetch(`${API_BASE}/api/config`);
    const data = await res.json();
    if(data.imgbbKey) cachedImgbbKey = data.imgbbKey;
    return cachedImgbbKey;
}

async function uploadToImgBB(file) {
    const key = await fetchImgbbKey();
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, { method: 'POST', body: formData });
    const result = await response.json();
    if (result.success) return result.data.url;
    throw new Error('Image upload failed');
}

// ─── ADD / EDIT PRODUCT SUBMISSION ───
document.getElementById('product-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    submitBtn.disabled = true;

    try {
        const productId = document.getElementById('modal-product-id').value;
        let imageUrls = [];
        const fileInput = document.getElementById('modal-images');
        
        if (fileInput.files.length > 0) {
            for (let file of fileInput.files) {
                const url = await uploadToImgBB(file);
                imageUrls.push(url);
            }
        } else if (productId) {
            const existingProduct = allProducts.find(p => (p._id || p.id) === productId);
            imageUrls = existingProduct.images || [];
        }

        const productData = {
            name: document.getElementById('modal-name').value.trim(),
            category: document.getElementById('modal-category').value,
            brand: document.getElementById('modal-brand').value.trim(),
            description: document.getElementById('modal-description').value.trim(),
            originalPrice: document.getElementById('modal-original-price').value ? parseFloat(document.getElementById('modal-original-price').value) : null,
            price: parseFloat(document.getElementById('modal-price').value),
            stock: parseInt(document.getElementById('modal-stock').value),
            images: imageUrls,
            availability: true
        };

        const token = localStorage.getItem('admin_token');
        const method = productId ? 'PUT' : 'POST';
        const url = productId ? `${API_BASE}/api/products?id=${productId}` : `${API_BASE}/api/products`;

        const res = await fetch(url, {
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(productData)
        });

        if (!res.ok) throw new Error("Database save failed.");

        showToast(productId ? 'Product updated successfully!' : 'Product added successfully!');
        closeProductModal();
        loadProductsData();

    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
});

// ══════════════════════════════════════════════════════════
// APP CONTENT — announcement/marquee + flash sale (drives the mobile app)
// ══════════════════════════════════════════════════════════
const APPCONFIG_URL = `${API_BASE}/api/appconfig`;
let appConfig = null;

function toLocalInput(iso) {
    const d = new Date(iso);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

async function loadAppContent() {
    try {
        const res = await fetch(APPCONFIG_URL);
        appConfig = res.ok ? await res.json() : {};
    } catch { appConfig = {}; }

    // Announcement
    const ann = appConfig.announcement || {};
    const enabledEl = document.getElementById('ann-enabled');
    if (enabledEl) enabledEl.checked = ann.enabled !== false;
    const msgs = (ann.messages && ann.messages.length)
        ? ann.messages
        : ['Free Shipping over ₹499', 'Flash Sale — Live Now', 'Buy 2 Get 1 Free'];
    renderMessageRows(msgs);
    updateAnnPreview();

    // Flash sale
    const fs = appConfig.flashSale || {};
    if (document.getElementById('fs-enabled')) {
        document.getElementById('fs-enabled').checked = !!fs.enabled;
        document.getElementById('fs-title').value = fs.title || 'Flash Sale';
        document.getElementById('fs-subtitle').value = fs.subtitle || 'Ends in — grab them fast!';
        document.getElementById('fs-end').value = fs.endTime ? toLocalInput(fs.endTime) : '';
    }
}

function renderMessageRows(msgs) {
    document.getElementById('ann-messages').innerHTML = msgs.map(m => messageRowHTML(m)).join('');
}
function messageRowHTML(val = '') {
    const safe = (val || '').replace(/"/g, '&quot;');
    return `<div class="ann-msg-row">
        <input class="form-input" value="${safe}" oninput="updateAnnPreview()" placeholder="e.g. Free Shipping over ₹499">
        <button class="del" onclick="this.parentElement.remove(); updateAnnPreview()" title="Remove"><i class="fas fa-trash"></i></button>
    </div>`;
}
function addMessageRow() {
    document.getElementById('ann-messages').insertAdjacentHTML('beforeend', messageRowHTML(''));
}
function getMessages() {
    return [...document.querySelectorAll('#ann-messages input')].map(i => i.value.trim()).filter(Boolean);
}
function updateAnnPreview() {
    const msgs = getMessages();
    const seq = msgs.length ? msgs : ['Your announcement preview'];
    document.getElementById('ann-preview-track').innerHTML = [...seq, ...seq].map(m => `<span>${m}</span>`).join('');
}

async function saveAppContent() {
    const body = {
        announcement: {
            enabled: document.getElementById('ann-enabled').checked,
            messages: getMessages(),
        },
    };
    if (document.getElementById('fs-enabled')) {
        const endVal = document.getElementById('fs-end').value;
        body.flashSale = {
            enabled: document.getElementById('fs-enabled').checked,
            title: document.getElementById('fs-title').value.trim() || 'Flash Sale',
            subtitle: document.getElementById('fs-subtitle').value.trim(),
            endTime: endVal ? new Date(endVal).toISOString() : null,
        };
    }
    try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(APPCONFIG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Save failed');
        showToast('Published to the app');
    } catch (e) {
        showToast(e.message, 'error');
    }
}
