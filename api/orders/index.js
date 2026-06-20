// Vercel Serverless Function - Orders API
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

// ─── FIREBASE ADMIN INITIALIZATION ───
if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
      })
    });
    console.log('Firebase Admin Initialized');
  } catch (error) {
    console.error('Firebase Admin Init Error:', error);
  }
}

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

// ─── DELHIVERY B2C SHIPMENT CREATION ───
async function createDelhiveryShipment(order) {
  const DELHIVERY_TOKEN = process.env.DELHIVERY_TOKEN; 
  const DELHIVERY_URL = 'https://track.delhivery.com/api/cmu/create.json';

  if (!DELHIVERY_TOKEN) {
    console.log('Skipping Delhivery: No token found in Vercel env');
    return null;
  }

  const addr = order.shippingAddress || {};
  const fName = addr.firstName || addr.name || '';
  const lName = addr.lastName || '';
  const fullName = `${fName} ${lName}`.trim() || 'Customer';
  const fullAddress = `${addr.address || ''} ${addr.apartment || addr.address2 || ''}`.trim();

  const payload = {
    pickup_location: {
      name: "Domestic Pickup Location" // This now matches your Delhivery Dashboard exactly!
    },
    shipments: [
      {
        name: fullName,
        add: fullAddress,
        pin: addr.pincode || addr.zip || addr.zipcode,
        city: addr.city,
        state: addr.state,
        country: "India",
        phone: order.phone || addr.phone,
        order: order.orderId || order._id.toString(),
        payment_mode: order.paymentMethod === 'cod' ? 'COD' : 'Pre-paid',
        
        // We removed the return_ address block because your dashboard 
        // handles returns to the same origin automatically.
        
        products_desc: "KidoCart Products",
        hsn_code: "4820", 
        cod_amount: order.paymentMethod === 'cod' ? order.total : 0,
        order_date: new Date(order.createdAt).toISOString().split('T')[0],
        total_amount: order.total,
        seller_add: "KidoCart, Malegaon",
        seller_name: "KidoCart",
        seller_inv: "INV-" + (order.orderId || '').slice(-6),
        quantity: order.items.reduce((sum, item) => sum + (item.quantity || 1), 0)
      }
    ]
  };
  try {
    const bodyString = `format=json&data=${JSON.stringify(payload)}`;

    const response = await fetch(DELHIVERY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DELHIVERY_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: bodyString
    });

    const data = await response.json();
    
    if (data.success === true && data.packages && data.packages.length > 0) {
       console.log('Delhivery Success! AWB:', data.packages[0].waybill);
       return data.packages[0].waybill; 
    } else {
       console.error('Delhivery Rejected Order:', JSON.stringify(data, null, 2));
       return null;
    }
  } catch (error) {
    console.error('Delhivery API Crash:', error);
    return null;
  }
}

// ─── ORDER SCHEMA (FIXED: Added missing tracking and tracking/cancellation fields) ───
const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  userId: String,
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
  
  // FIXED: Explicitly added so Mongoose saves them to MongoDB
  trackingNumber: String, 
  cancelReason: String,   

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

// ─── TOKEN VERIFICATION ───
async function verifyToken(authHeader) {
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
      if (decoded) return decoded;
    } catch (e) {
      // Fall through to Firebase
    }

    if (admin.apps.length > 0) {
      try {
        const firebaseDecoded = await admin.auth().verifyIdToken(token);
        return { userId: firebaseDecoded.uid, email: firebaseDecoded.email };
      } catch (err) {
        return null;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ─── UTILITY: SEND FIREBASE MESSAGE ───
async function sendFirebaseMessage(phone, status, orderId) {
  if (!admin.apps.length) {
    console.log('Firebase not configured. Skipping SMS.');
    return;
  }

  const shortId = (orderId || '').slice(-6);
  let message = `Hi! Your KidoCart order #${shortId} is now ${status.toUpperCase()}.`;
  if (status === 'shipped') message += ` It is on its way!`;
  if (status === 'delivered') message += ` Enjoy your purchase!`;

  try {
    const db = admin.firestore();
    const formattedPhone = phone.startsWith('+') ? phone : '+91' + phone;

    await db.collection('messages').add({
      to: formattedPhone,
      body: message
    });
    console.log(`[FIREBASE] SMS queued in Firestore for ${formattedPhone}`);
  } catch (err) {
    console.error('[FIREBASE NOTIFICATION FAILED]', err);
  }
}

// ─── MAIN EXPORT ───
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connectToDatabase();

    const { id, orderId, admin: isAdmin } = req.query;
    const targetId = id || orderId; 

    const getSearchQuery = (searchStr) => {
       return mongoose.Types.ObjectId.isValid(searchStr) ? { _id: searchStr } : { orderId: searchStr };
    };

    // GET ORDERS
    if (req.method === 'GET') {
      const decoded = await verifyToken(req.headers.authorization);
      if (!decoded) return res.status(401).json({ error: 'Unauthorized: Invalid token' });

      if (isAdmin === 'true') {
        const orders = await Order.find()
          .populate('userId', 'name email')
          .sort({ createdAt: -1 });
        return res.status(200).json(orders);
      }

      if (targetId) {
        const order = await Order.findOne({ 
          ...getSearchQuery(targetId), 
          userId: decoded.userId 
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        return res.status(200).json(order);
      }

      const orders = await Order.find({ userId: decoded.userId }).sort({ createdAt: -1 });
      return res.status(200).json(orders);
    }

    // CREATE ORDER
    if (req.method === 'POST') {
      const decoded = await verifyToken(req.headers.authorization);
      if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

      const orderData = req.body;
      const newOrderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();

      const order = new Order({
        ...orderData,
        orderId: newOrderId,
        userId: decoded.userId
      });

      await order.save();
      return res.status(201).json(order);
    }

    // UPDATE ORDER STATUS (FIXED LOGIC BLOCK)
    if (req.method === 'PUT') {
      if (!targetId) return res.status(400).json({ error: 'Order ID required' });

      const updates = req.body;
      const order = await Order.findOne(getSearchQuery(targetId));
      if (!order) return res.status(404).json({ error: 'Order not found' });

      // Trigger Delhivery shipping if status switches to processing
      if (updates.status === 'processing' && !order.trackingNumber) {
         const awbNumber = await createDelhiveryShipment(order);
         if (awbNumber) {
            order.trackingNumber = awbNumber; 
         }
      }

      // Handle storefront cancellations securely vs standard admin updates
      if (req.url.includes('/cancel')) {
        if (['delivered', 'cancelled', 'shipped'].includes(order.status)) {
          return res.status(400).json({ error: 'Order cannot be cancelled at this stage' });
        }
        order.status = 'cancelled';
        if (updates.cancelReason) order.cancelReason = updates.cancelReason;
      } else {
        Object.assign(order, updates);
      }
      
      // FIXED: Ensures timestamp updates correctly on all execution paths
      order.updatedAt = new Date(); 
      await order.save();

      // FIXED: Looks directly at the finalized order status so cancellation SMS works
      if (order.status && order.shippingAddress && order.shippingAddress.phone) {
        sendFirebaseMessage(order.shippingAddress.phone, order.status, order.orderId);
      }

      return res.status(200).json(order);
    }

    // DELETE ORDER
    if (req.method === 'DELETE') {
      if (!targetId) return res.status(400).json({ error: 'Order ID required' });

      const order = await Order.findOneAndDelete(getSearchQuery(targetId));
      if (!order) return res.status(404).json({ error: 'Order not found' });

      return res.status(200).json({ message: 'Order deleted successfully' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
