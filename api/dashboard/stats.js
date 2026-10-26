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
