// Vercel Serverless Function - Dashboard Analytics API
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

let cachedDb = null;
async function connectDB() {
  if (cachedDb && mongoose.connection.readyState >= 1) return cachedDb;
  const client = await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  cachedDb = client;
  return cachedDb;
}

const orderSchema = new mongoose.Schema({}, { strict: false });
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

const productSchema = new mongoose.Schema({}, { strict: false });
const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.models.User || mongoose.model('User', userSchema);

function verifyAdmin(req) {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  try {
    const decoded = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'fallback-secret-key');
    return decoded && (decoded.role === 'admin' || decoded.isAdmin);
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized: Admin access required' });
  }

  try {
    await connectDB();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      allOrders,
      totalProducts,
      lowStockCount,
      outOfStockCount,
      totalCustomers,
      recentOrders
    ] = await Promise.all([
      Order.find({}).select('total status createdAt items shippingAddress paymentMethod orderId').lean(),
      Product.countDocuments(),
      Product.countDocuments({ stock: { $lte: 10, $gt: 0 } }),
      Product.countDocuments({ stock: { $lte: 0 } }),
      User.countDocuments(),
      Order.find({}).sort({ createdAt: -1 }).limit(6).lean()
    ]);

    // Enrich recent orders with product images and details
    try {
      const pidSet = new Set();
      recentOrders.forEach(o => {
        if (Array.isArray(o.items)) {
          o.items.forEach(it => {
            const raw = (it.productId && typeof it.productId === 'object' && it.productId._id)
              ? it.productId._id
              : (it.productId || it.id);
            if (raw) pidSet.add(String(raw));
          });
        }
      });
      if (pidSet.size > 0) {
        const allIds = Array.from(pidSet);
        const objIds = allIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
        const prods = await Product.find({
          $or: [{ _id: { $in: objIds } }, { id: { $in: allIds } }]
        }).select('name images image price brand category').lean();

        const pMap = new Map();
        prods.forEach(p => {
          pMap.set(String(p._id), p);
          if (p.id) pMap.set(String(p.id), p);
        });

        recentOrders.forEach(o => {
          if (Array.isArray(o.items)) {
            o.items.forEach(it => {
              const raw = (it.productId && typeof it.productId === 'object' && it.productId._id)
                ? String(it.productId._id)
                : String(it.productId || it.id || '');
              const p = pMap.get(raw);
              if (p) {
                const img = (Array.isArray(p.images) && p.images[0]) || p.image || '';
                if (!it.name && p.name) it.name = p.name;
                if (!it.image && img) it.image = img;
                if (!it.images && p.images) it.images = p.images;
                if (!it.brand && p.brand) it.brand = p.brand;
                if (!it.product) it.product = { _id: p._id, name: p.name, images: p.images, image: img, brand: p.brand };
              }
            });
          }
        });
      }
    } catch (enrichErr) {
      console.warn('Dashboard recent orders product enrichment error:', enrichErr.message);
    }

    let todaySales = 0;
    let totalSales = 0;
    let pendingOrders = 0;
    let processingOrders = 0;
    let shippedOrders = 0;
    let deliveredOrders = 0;
    let cancelledOrders = 0;

    for (const order of allOrders) {
      const orderTotal = Number(order.total) || 0;
      const isCancelled = order.status === 'cancelled';

      if (!isCancelled) {
        totalSales += orderTotal;
        if (new Date(order.createdAt) >= startOfToday) {
          todaySales += orderTotal;
        }
      }

      switch (order.status) {
        case 'pending':
          pendingOrders++;
          break;
        case 'processing':
          processingOrders++;
          break;
        case 'shipped':
          shippedOrders++;
          break;
        case 'delivered':
          deliveredOrders++;
          break;
        case 'cancelled':
          cancelledOrders++;
          break;
      }
    }

    return res.status(200).json({
      success: true,
      stats: {
        todaySales,
        totalSales,
        totalOrders: allOrders.length,
        pendingOrders,
        processingOrders,
        shippedOrders,
        deliveredOrders,
        cancelledOrders,
        totalProducts,
        lowStockCount,
        outOfStockCount,
        totalCustomers
      },
      recentOrders
    });
  } catch (error) {
    console.error('[DASHBOARD-STATS-ERROR]:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
