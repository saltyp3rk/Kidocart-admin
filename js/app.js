// ==========================================
// KidoCart Admin - Core Application Logic
// ==========================================

const API_BASE = ''; 
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
        });
    });
}

function logout() {
    localStorage.removeItem('admin_token');
    window.location.href = 'login.html';
}

// ─── DASHBOARD ───
async function loadDashboardData() {
    // Show loading spinners visually
    document.getElementById('dash-sales').innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 20px;"></i>';
    document.getElementById('dash-pending').innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 20px;"></i>';
    document.getElementById('dash-stock').innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size: 20px;"></i>';

    try {
        const token = localStorage.getItem('admin_token'); 
        const headers = { 'Authorization': `Bearer ${token}` };

        // Fetch Products & Orders in parallel. (FIX APPLIED: Added ?admin=true to orders)
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
        
        // Grab ID safely
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
        
        // Handle images: If new ones selected, upload them.
        if (fileInput.files.length > 0) {
            for (let file of fileInput.files) {
                const url = await uploadToImgBB(file);
                imageUrls.push(url);
            }
        } else if (productId) {
            // If editing and no new images selected, keep existing images
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
        
        // Dynamically choose POST (create) or PUT (update)
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

        if (!res.ok) throw new Error("Database save failed. Ensure your token is valid.");

        showToast(productId ? 'Product updated successfully!' : 'Product added successfully!');
        closeProductModal();
        loadProductsData(); // Refresh the list

    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
});