
// ==========================================
// ADMIN PRODUCTS JS - Secure ImgBB Integration
// ==========================================

let deleteProductId = null;
let allProducts = [];
let existingImageUrls = [];
let cachedImgbbKey = null; // Caches the key so we only fetch it once

if (!localStorage.getItem('kidsstore_adminLoggedIn') || localStorage.getItem('kidsstore_adminLoggedIn') !== 'true') {
    window.location.href = 'login.html';
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function updateSyncStatus(status) {
    const el = document.getElementById('sync-status');
    if (status === 'syncing') {
        el.className = 'sync-status syncing';
        el.innerHTML = '<div class="loading-spinner" style="width: 16px; height: 16px;"></div> Syncing...';
    } else if (status === 'error') {
        el.className = 'sync-status error';
        el.innerHTML = '<i class="fas fa-exclamation-circle"></i> Sync Error';
    } else {
        el.className = 'sync-status';
        el.innerHTML = '<i class="fas fa-check-circle"></i> MongoDB Connected';
    }
}

function adminLogout() {
    localStorage.removeItem('kidsstore_adminLoggedIn');
    window.location.href = 'login.html';
}

async function loadProducts() {
    try {
        updateSyncStatus('syncing');
        const response = await fetch('/api/products');
        if (response.ok) {
            allProducts = await response.json();
            renderProducts(allProducts);
            updateStats();
            updateSyncStatus('connected');
        } else {
            throw new Error('Failed to fetch products');
        }
    } catch (error) {
        updateSyncStatus('error');
        showToast('Failed to load products from database', 'error');
    }
}

function updateStats() {
    const inStock = allProducts.filter(p => p.availability && p.stock > 10);
    const lowStock = allProducts.filter(p => p.stock > 0 && p.stock <= 10);
    const outOfStock = allProducts.filter(p => p.stock === 0 || !p.availability);

    document.getElementById('stat-total').textContent = allProducts.length;
    document.getElementById('stat-instock').textContent = inStock.length;
    document.getElementById('stat-lowstock').textContent = lowStock.length;
    document.getElementById('stat-outofstock').textContent = outOfStock.length;
}

function renderProducts(products) {
    const tbody = document.getElementById('products-tbody');
    const emptyState = document.getElementById('empty-state');
    const table = document.getElementById('products-table');

    if (products.length === 0) {
        table.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    emptyState.style.display = 'none';

    tbody.innerHTML = products.map(product => {
        let stockClass = 'stock-good';
        let stockText = product.stock;
        if (product.stock === 0) {
            stockClass = 'stock-out';
            stockText = 'Out of stock';
        } else if (product.stock <= 10) {
            stockClass = 'stock-low';
            stockText = `${product.stock} left`;
        }

        const badgeHtml = product.badge ? `<span class="badge-preview badge-${product.badge}">${product.badge}</span>` : '';
        const productId = product._id || product.id;
        
        let firstImage = '/placeholder.jpg';
        if (product.images && product.images.length > 0) firstImage = product.images[0];

        return `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="${firstImage}" class="product-thumb" onerror="this.src='https://via.placeholder.com/60'">
                        <div>
                            <strong style="display: block; margin-bottom: 3px;">${product.name.substring(0, 40)}</strong>
                            ${badgeHtml}
                            <small style="color: var(--gray); display: block;">${product.brand || 'No brand'}</small>
                        </div>
                    </div>
                </td>
                <td><span style="text-transform: capitalize;">${product.category}</span></td>
                <td>${product.ageGroup}</td>
                <td>
                    <strong style="color: var(--primary);">₹${parseFloat(product.price).toFixed(0)}</strong>
                </td>
                <td><span class="${stockClass}">${stockText}</span></td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" ${product.availability ? 'checked' : ''} onchange="toggleAvailability('${productId}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td>
                    <div class="action-btns">
                        <button class="btn-edit" onclick="editProduct('${productId}')" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-delete" onclick="openDeleteModal('${productId}')" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterProducts() {
    const search = document.getElementById('search').value.toLowerCase();
    const category = document.getElementById('filter-category').value;
    const age = document.getElementById('filter-age').value;

    let filtered = allProducts;
    if (search) filtered = filtered.filter(p => p.name.toLowerCase().includes(search) || (p.brand && p.brand.toLowerCase().includes(search)));
    if (category) filtered = filtered.filter(p => p.category === category);
    if (age) filtered = filtered.filter(p => p.ageGroup === age);

    renderProducts(filtered);
}

async function toggleAvailability(productId, availability) {
    try {
        updateSyncStatus('syncing');
        const response = await fetch(`/api/products?id=${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ availability })
        });
        if (response.ok) {
            showToast(`Product ${availability ? 'enabled' : 'disabled'}`, 'success');
            await loadProducts();
        } else throw new Error('Failed');
    } catch (error) {
        showToast('Failed to update availability', 'error');
        updateSyncStatus('error');
    }
}

function openAddModal() {
    document.getElementById('modal-title').innerHTML = '<i class="fas fa-plus-circle"></i> Add New Product';
    document.getElementById('product-form').reset();
    document.getElementById('product-id').value = '';
    document.getElementById('product-availability').checked = true;
    document.getElementById('availability-text').textContent = 'Available';
    document.getElementById('submit-btn-text').textContent = 'Save Product';
    
    document.getElementById('image-preview-container').innerHTML = '';
    existingImageUrls = [];
    
    document.getElementById('product-modal').classList.add('active');
}

function editProduct(productId) {
    const product = allProducts.find(p => (p._id || p.id) === productId);
    if (!product) return;

    document.getElementById('modal-title').innerHTML = '<i class="fas fa-edit"></i> Edit Product';
    document.getElementById('product-id').value = productId;
    document.getElementById('product-name').value = product.name;
    document.getElementById('product-description').value = product.description || '';
    document.getElementById('product-category').value = product.category;
    document.getElementById('product-age').value = product.ageGroup;
    document.getElementById('product-brand').value = product.brand || '';
    document.getElementById('product-badge').value = product.badge || '';
    document.getElementById('product-price').value = product.price;
    document.getElementById('product-original-price').value = product.originalPrice || '';
    document.getElementById('product-stock').value = product.stock;
    document.getElementById('product-availability').checked = product.availability;
    document.getElementById('availability-text').textContent = product.availability ? 'Available' : 'Unavailable';
    document.getElementById('product-sizes').value = product.sizes ? product.sizes.join(', ') : '';
    document.getElementById('product-colors').value = product.colors ? product.colors.join(', ') : '';
    document.getElementById('product-featured').checked = product.featured || false;
    document.getElementById('submit-btn-text').textContent = 'Update Product';

    existingImageUrls = product.images || [];
    const previewContainer = document.getElementById('image-preview-container');
    previewContainer.innerHTML = '';
    existingImageUrls.forEach(url => {
        previewContainer.innerHTML += `<img src="${url}" title="Existing Image">`;
    });

    document.getElementById('product-modal').classList.add('active');
}

function closeModal() { document.getElementById('product-modal').classList.remove('active'); }
function openDeleteModal(productId) { deleteProductId = productId; document.getElementById('delete-modal').classList.add('active'); }
function closeDeleteModal() { deleteProductId = null; document.getElementById('delete-modal').classList.remove('active'); }

async function confirmDelete() {
    if (!deleteProductId) return;
    try {
        updateSyncStatus('syncing');
        const response = await fetch(`/api/products?id=${deleteProductId}`, { method: 'DELETE' });
        if (response.ok) {
            closeDeleteModal();
            showToast('Product deleted successfully', 'success');
            await loadProducts();
        } else throw new Error('Failed');
    } catch (error) {
        showToast('Failed to delete product', 'error');
        updateSyncStatus('error');
    }
}

document.getElementById('product-availability').addEventListener('change', function() {
    document.getElementById('availability-text').textContent = this.checked ? 'Available' : 'Unavailable';
});

// ─── SECURE IMGBB UPLOAD LOGIC ───
async function fetchImgbbKey() {
    if (cachedImgbbKey) return cachedImgbbKey;
    
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Could not retrieve API key from server');
    
    const data = await res.json();
    cachedImgbbKey = data.imgbbKey;
    return cachedImgbbKey;
}

async function uploadToImgBB(file) {
    const key = await fetchImgbbKey(); // securely fetched from backend
    const formData = new FormData();
    formData.append('image', file);
    
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
        method: 'POST',
        body: formData
    });
    
    const result = await response.json();
    if (result.success) return result.data.url;
    throw new Error('Image upload failed');
}

// ─── FORM SUBMISSION ───
document.getElementById('product-form').addEventListener('submit', async function(e) {
    e.preventDefault(); 

    const productId = document.getElementById('product-id').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    submitBtn.innerHTML = '<div class="loading-spinner"></div> Saving...';
    submitBtn.disabled = true;

    try {
        updateSyncStatus('syncing');
        
        let finalImageUrls = [...existingImageUrls];
        const fileInput = document.getElementById('product-images-upload');

        if (fileInput.files.length > 0) {
            finalImageUrls = []; 
            for (let file of fileInput.files) {
                const url = await uploadToImgBB(file);
                finalImageUrls.push(url);
            }
        }

        if (!productId && finalImageUrls.length === 0) {
            throw new Error("Please upload at least one image.");
        }

        const productData = {
            name: document.getElementById('product-name').value.trim(),
            description: document.getElementById('product-description').value.trim(),
            category: document.getElementById('product-category').value,
            ageGroup: document.getElementById('product-age').value,
            brand: document.getElementById('product-brand').value,
            badge: document.getElementById('product-badge').value || null,
            price: parseFloat(document.getElementById('product-price').value),
            originalPrice: document.getElementById('product-original-price').value ? parseFloat(document.getElementById('product-original-price').value) : null,
            stock: parseInt(document.getElementById('product-stock').value),
            availability: document.getElementById('product-availability').checked,
            images: finalImageUrls,
            sizes: document.getElementById('product-sizes').value ? document.getElementById('product-sizes').value.split(',').map(s => s.trim()).filter(s => s) : null,
            colors: document.getElementById('product-colors').value ? document.getElementById('product-colors').value.split(',').map(c => c.trim()).filter(c => c) : null,
            featured: document.getElementById('product-featured').checked,
        };

        const method = productId ? 'PUT' : 'POST';
        const url = productId ? `/api/products?id=${productId}` : '/api/products';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(productData)
        });

        if (response.ok) {
            showToast(productId ? 'Product updated!' : 'Product added!', 'success');
            closeModal();
            await loadProducts();
        } else {
            throw new Error('Failed to save to database');
        }
    } catch (error) {
        showToast(error.message, 'error');
        updateSyncStatus('error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
});

document.getElementById('product-modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
document.getElementById('delete-modal').addEventListener('click', function(e) { if (e.target === this) closeDeleteModal(); });

document.addEventListener('DOMContentLoaded', function() {
    loadProducts();
    setInterval(loadProducts, 30000);
});
