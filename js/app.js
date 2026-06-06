// ==========================================
// KidoCart Admin - Core Application Logic
// ==========================================

// Route Guard: If no token is found, automatically bounce back to login screen
if (!localStorage.getItem('admin_token') && !window.location.href.includes('login.html')) {
    window.location.href = 'login.html';
}

const API_BASE = ''; // Blank because frontend and backend are hosted together
let allProducts = [];
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
            if(targetId === 'orders-view') loadOrdersData(); // RESTORED ORDERS TRIGGER
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

// ─── ORDERS (RESTORED) ───
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
        const orders = await res.json();
        renderOrders(orders);
    } catch (error) {
        list.innerHTML = `<div class="page-header"><h1>Orders</h1></div><div class="card empty-state">Error loading orders</div>`;
    }
}

function renderOrders(orders) {
    const list = document.getElementById('orders-view');
    if (orders.length === 0) {
        list.innerHTML = `
            <div class="page-header"><h1>Orders</h1></div>
            <div class="card empty-state"><i class="fas fa-receipt"></i><p>No orders found</p></div>
        `;
        return;
    }

    const ordersHtml = orders.map(o => {
        const date = new Date(o.createdAt).toLocaleDateString('en-IN');
        let statusColor = o.status === 'pending' ? 'var(--warning)' : (o.status === 'delivered' ? 'var(--success)' : 'var(--primary)');
        let orderIdDisplay = o.orderId || (o._id ? o._id.substring(0,8).toUpperCase() : 'N/A');

        return `
            <div class="card" style="margin-bottom: 15px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <strong>Order #${orderIdDisplay}</strong>
                    <span style="color: ${statusColor}; font-weight: bold; text-transform: capitalize;">${o.status}</span>
                </div>
                <div style="font-size: 14px; color: var(--text-muted); margin-bottom: 15px;">
                    <div>Date: ${date}</div>
                    <div>Total: ₹${o.total}</div>
                    ${o.shippingAddress ? `<div>Customer: ${o.shippingAddress.firstName} ${o.shippingAddress.lastName}</div>` : ''}
                </div>
                <div style="display: flex; gap: 10px;">
                    <select class="form-input" style="padding: 8px; font-size: 14px; flex: 1;" onchange="updateOrderStatus('${o._id}', this.value)">
                        <option value="" disabled selected>Update Status</option>
                        <option value="pending">Pending</option>
                        <option value="processing">Processing</option>
                        <option value="shipped">Shipped</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
            </div>
        `;
    }).join('');

    list.innerHTML = `
        <div class="page-header"><h1>Orders</h1></div>
        ${ordersHtml}
    `;
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
        showToast("Order status updated!");
        loadOrdersData(); // Refresh list to show new colors
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
