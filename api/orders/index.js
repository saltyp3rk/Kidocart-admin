// Vercel Serverless Function - Orders API
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// MongoDB connection
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  cachedDb = client;
  return cachedDb;
}

// Order Schema
const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [{
    productId: String,
    name: String,
    price: Number,
    quantity: Number,
    size: String,
    color: String,
    image: String
  }],
  subtotal: Number,
  shipping: Number,
  discount: Number,
  tax: Number,
  total: Number,
  shippingAddress: {
    firstName: String,
    lastName: String,
    phone: String,
    address: String,
    address2: String,
    city: String,
    state: String,
    zip: String,
    country: String
  },
  paymentMethod: String,
  paymentId: String,
  paymentStatus: { type: String, default: 'pending' },
  status: { type: String, default: 'confirmed' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

// Verify JWT token
function verifyToken(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connectToDatabase();

    const { id, admin } = req.query;

    // GET ORDERS
    if (req.method === 'GET') {
      // Admin - get all orders
      if (admin === 'true') {
        const orders = await Order.find()
          .populate('userId', 'name email')
          .sort({ createdAt: -1 });
        
        console.log('Admin fetched orders:', orders.length);
        return res.status(200).json(orders);
      }

      // User - get own orders
      const decoded = verifyToken(req.headers.authorization);
      if (!decoded) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (id) {
        // Single order
        const order = await Order.findOne({ 
          orderId: id,
          userId: decoded.userId 
        });
        if (!order) {
          return res.status(404).json({ error: 'Order not found' });
        }
        return res.status(200).json(order);
      }

      // All user orders
      const orders = await Order.find({ userId: decoded.userId })
        .sort({ createdAt: -1 });
      
      console.log('User fetched orders:', orders.length);
      return res.status(200).json(orders);
    }

    // CREATE ORDER
    if (req.method === 'POST') {
      const decoded = verifyToken(req.headers.authorization);
      if (!decoded) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const orderData = req.body;
      
      // Generate order ID
      const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();

      const order = new Order({
        ...orderData,
        orderId,
        userId: decoded.userId
      });

      await order.save();

      console.log('Order created:', orderId);

      return res.status(201).json(order);
    }

    // UPDATE ORDER STATUS (Admin)
    if (req.method === 'PUT') {
      if (!id) {
        return res.status(400).json({ error: 'Order ID required' });
      }

      const updates = req.body;
      updates.updatedAt = new Date();
      
      const order = await Order.findOneAndUpdate(
        { orderId: id },
        updates,
        { new: true }
      );

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      console.log('Order updated:', id, 'Status:', updates.status);

      return res.status(200).json(order);
    }

    // DELETE ORDER (Admin)
    if (req.method === 'DELETE') {
      if (!id) {
        return res.status(400).json({ error: 'Order ID required' });
      }

      const order = await Order.findOneAndDelete({ orderId: id });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      console.log('Order deleted:', id);

      return res.status(200).json({ message: 'Order deleted successfully' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
