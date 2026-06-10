// ==========================================
// KidoCart Admin - Core Application Logic
// ==========================================

// Route Guard: If no token is found, automatically bounce back to login screen
if (!localStorage.getItem('admin_token') && !window.location.href.includes('login.html')) {
    window.location.href = 'login.html';
}

const API_BASE = ''; // Blank because frontend and backend are hosted together
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
async function loadCustomersData() {
    const container = document.getElementById('customers-view');
    try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(`${API_BASE}/api/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error("Failed");
        const users = await res.json();
        
        container.innerHTML = `
            <div class="page-header"><h1>Customers</h1></div>
            <div class="product-grid">
                ${users.map(u => `
                    <div class="card">
                        <div style="font-weight:600">${u.name || 'No Name'}</div>
                        <div style="font-size:12px; color:var(--text-muted)">${u.email}</div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        showToast('Error loading customers', 'error');
    }
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

// Render the orders with the dynamic sorting buttons
window.renderOrdersList = function(filterStatus = 'all') {
    const container = document.getElementById('orders-view');

    // Filter logic
    const filteredOrders = filterStatus === 'all' 
        ? allAdminOrders 
        : allAdminOrders.filter(o => o.status === filterStatus);

    // Build the Sorting Header
    const filterHTML = `
        <div class="page-header"><h1>Orders</h1></div>
        <div style="display: flex; gap: 8px; margin-bottom: 20px; overflow-x: auto; padding-bottom: 5px;">
            <button class="btn-secondary" onclick="renderOrdersList('all')" style="${filterStatus === 'all' ? 'background:var(--black);color:black;' : 'border-radius: 20px;'} padding: 6px 16px; border-radius: 20px;">All</button>
            <button class="btn-secondary" onclick="renderOrdersList('pending')" style="${filterStatus === 'pending' ? 'background:var(--black);color:white;' : 'border-radius: 20px;'} padding: 6px 16px; border-radius: 20px;">Pending</button>
            <button class="btn-secondary" onclick="renderOrdersList('processing')" style="${filterStatus === 'processing' ? 'background:var(--black);color:white;' : 'border-radius: 20px;'} padding: 6px 16px; border-radius: 20px;">Processing</button>
            <button class="btn-secondary" onclick="renderOrdersList('shipped')" style="${filterStatus === 'shipped' ? 'background:var(--black);color:white;' : 'border-radius: 20px;'} padding: 6px 16px; border-radius: 20px;">Shipped</button>
            <button class="btn-secondary" onclick="renderOrdersList('delivered')" style="${filterStatus === 'delivered' ? 'background:var(--black);color:white;' : 'border-radius: 20px;'} padding: 6px 16px; border-radius: 20px;">Delivered</button>
            <button class="btn-secondary" onclick="renderOrdersList('cancelled')" style="${filterStatus === 'cancelled' ? 'background:var(--black);color:white;' : 'border-radius: 20px;'} padding: 6px 16px; border-radius: 20px;">Cancelled</button>
        </div>
    `;

    if (filteredOrders.length === 0) {
        container.innerHTML = filterHTML + `<div class="card empty-state"><i class="fas fa-receipt"></i><p>No orders found for this status</p></div>`;
        return;
    }

    const ordersHtml = filteredOrders.map(o => {
        // Time Parsing
        const dateObj = new Date(o.createdAt);
        const dateStr = dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

        // Name Formatting (Handles both old split names and new combined names)
        const custName = (o.shippingAddress && o.shippingAddress.name) 
            ? o.shippingAddress.name 
            : (o.shippingAddress && o.shippingAddress.firstName ? `${o.shippingAddress.firstName} ${o.shippingAddress.lastName}` : 'Guest Customer');
        const phone = (o.shippingAddress && o.shippingAddress.phone) ? o.shippingAddress.phone : 'N/A';

        // Transaction Badge
        const txBadge = o.paymentMethod === 'razorpay' 
            ? `<span style="background: #e0e7ff; color: #4338ca; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">Txn: ${o.transactionId || o.paymentId || 'Online'}</span>`
            : `<span style="background: #f3f4f6; color: #374151; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">COD</span>`;

        // Horizontal Status Pills
        const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
        let statusButtons = `<div style="display: flex; gap: 8px; margin-top: 16px; border-top: 1px solid #e5e5e5; padding-top: 16px; overflow-x: auto;">`;
        statuses.forEach(s => {
            let isActive = o.status === s 
                ? 'background: var(--accent); color: white; border: 1px solid var(--accent);' 
                : 'background: white; border: 1px solid #d4d4d4; color: #737373;';
            statusButtons += `<button onclick="updateOrderStatus('${o.orderId || o._id}', '${s}')" style="padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; text-transform: capitalize; transition: 0.2s; white-space: nowrap; ${isActive}">${s}</button>`;
        });
        statusButtons += `</div>`;

        return `
            <div class="card" style="margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div>
                        <h3 style="margin: 0; font-size: 16px; color: var(--black);">Order #${(o.orderId || '').replace('ORD-', '')}</h3>
                        <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--gray-500);">${dateStr} at ${timeStr}</p>
                    </div>
                    <div style="text-align: right;">
                        <h3 style="margin: 0; font-size: 16px; color: var(--black);">₹${(o.total || 0).toLocaleString('en-IN')}</h3>
                        <div style="margin-top: 6px;">${txBadge}</div>
                    </div>
                </div>
                
                <div style="font-size: 14px; color: var(--gray-700); line-height: 1.6;">
                    <strong>Customer:</strong> ${custName} <br>
                    <strong>Phone:</strong> ${phone} <br>
                    <strong>Items:</strong> ${o.items ? o.items.length : 0} items
                </div>
                ${statusButtons}
            </div>
        `;
    }).join('');

    container.innerHTML = filterHTML + `<div id="orders-list-container">${ordersHtml}</div>`;
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
                    <button class="icon-btn" style="color: var(--primary);" onclick="openEditModal('${pId}')"><i class="fas fa-edit"></i></button>
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
