// Vercel Serverless Function - Orders API
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

// ─── FIREBASE ADMIN INITIALIZATION ───
// Requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in Vercel
if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // .replace is needed because Vercel sometimes escapes newlines in private keys
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
  // Add this to your Vercel Environment Variables
  const DELHIVERY_TOKEN = process.env.DELHIVERY_TOKEN; 
  
  // Use staging-express.delhivery.com for testing, track.delhivery.com for LIVE
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

  // Delhivery strictly demands this JSON structure
  const payload = {
    pickup_location: {
      name: "Farzan Online Services", // WARNING: Must exactly match the name registered in your Delhivery Dashboard!
      add: "Farzan Online Service Plot No. 47/B, Survey No. 105/A, Gulshane Masoom", 
      city: "Malegaon",
      pin: "423203",
      country: "India",
      phone: "9370538787" 
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
        return_pin: "423203",
        return_city: "Malegaon",
        return_phone: "9370538787",
        return_add: "Farzan Online Service Plot No. 47/B, Survey No. 105/A, Gulshane Masoom",
        return_state: "Maharashtra",
        return_country: "India",
        products_desc: "KidoCart Products",
        hsn_code: "4820", // Update with your actual GST HSN code
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
    // Delhivery's mandatory formatting quirk
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
    
    // If Delhivery accepts it, they return the Waybill (Tracking Number)
    if (data.success === true && data.packages && data.packages.length > 0) {
       console.log('Delhivery Success! AWB:', data.packages[0].waybill);
       return data.packages[0].waybill; 
    } else {
       console.error('Delhivery Rejected Order:', data);
       return null;
    }
  } catch (error) {
    console.error('Delhivery API Crash:', error);
    return null;
  }
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

// ─── Check the VIP Pass (FIXED for Admin Firebase Tokens) ───
async function verifyToken(authHeader) {
  if (!authHeader) return null;
  try {
    const token = authHeader.replace('Bearer ', '');
    
    // 1. Try Storefront JWT
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
      if (decoded) return decoded;
    } catch (e) {
      // Ignore and fall through to Firebase
    }

    // 2. Try Admin Firebase Token
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
    console.log('Firebase not configured in environment variables. Skipping SMS.');
    return;
  }

  const shortId = (orderId || '').slice(-6);
  let message = `Hi! Your KidoCart order #${shortId} is now ${status.toUpperCase()}.`;
  if (status === 'shipped') message += ` It is on its way!`;
  if (status === 'delivered') message += ` Enjoy your purchase!`;

  try {
    // If using Firebase "Send Messages" Extension:
    // Writing to this collection triggers the extension to send the text message.
    const db = admin.firestore();
    const formattedPhone = phone.startsWith('+') ? phone : '+91' + phone;

    await db.collection('messages').add({
      to: formattedPhone,
      body: message
    });
    console.log(`[FIREBASE] SMS queued in Firestore for ${formattedPhone}`);

    /* NOTE: If you actually meant Firebase Cloud Messaging (FCM Push Notifications), 
    you would use this code instead, but it requires saving device tokens in your DB:
    
    await admin.messaging().send({
        token: 'USER_DEVICE_TOKEN_HERE',
        notification: { title: 'Order Update', body: message }
    });
    */
  } catch (err) {
    console.error('[FIREBASE NOTIFICATION FAILED]', err);
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

    // Capture both 'id' and 'orderId' to ensure nothing is missed
    const { id, orderId, admin: isAdmin } = req.query;
    const targetId = id || orderId; 

    // SMART QUERY: Detects if frontend sent a Mongo _id or a custom ORD- id
    const getSearchQuery = (searchStr) => {
       return mongoose.Types.ObjectId.isValid(searchStr) ? { _id: searchStr } : { orderId: searchStr };
    };

    // GET ORDERS
    if (req.method === 'GET') {
      const decoded = await verifyToken(req.headers.authorization); // SURGICAL FIX: Added await
      if (!decoded) return res.status(401).json({ error: 'Unauthorized: Invalid token' });

      // Admin - get all orders
      if (isAdmin === 'true') {
        const orders = await Order.find()
          .populate('userId', 'name email')
          .sort({ createdAt: -1 });
        return res.status(200).json(orders);
      }

      // Single order
      if (targetId) {
        const order = await Order.findOne({ 
          ...getSearchQuery(targetId), 
          userId: decoded.userId 
        });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        return res.status(200).json(order);
      }

      // All user orders
      const orders = await Order.find({ userId: decoded.userId }).sort({ createdAt: -1 });
      return res.status(200).json(orders);
    }

    // CREATE ORDER
    if (req.method === 'POST') {
      const decoded = await verifyToken(req.headers.authorization); // SURGICAL FIX: Added await
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

// UPDATE ORDER STATUS (Admin & Storefront Cancellations)
    if (req.method === 'PUT') {
      if (!targetId) return res.status(400).json({ error: 'Order ID required' });

      const updates = req.body;
      updates.updatedAt = new Date();
      
      const order = await Order.findOne(getSearchQuery(targetId));
      if (!order) return res.status(404).json({ error: 'Order not found' });

      // If the admin changes the status to processing, create the Delhivery shipment!
      if (updates.status === 'processing' && !order.trackingNumber) {
         const awbNumber = await createDelhiveryShipment(order);
         if (awbNumber) {
            updates.trackingNumber = awbNumber; // Save tracking number to DB
         }
      }

      // Handle storefront cancellations securely
      if (req.url.includes('/cancel')) {
        if (['delivered', 'cancelled', 'shipped'].includes(order.status)) {
          return res.status(400).json({ error: 'Order cannot be cancelled at this stage' });
        }
        order.status = 'cancelled';
        if (req.body.cancelReason) order.cancelReason = req.body.cancelReason;
      } else {
        // Standard admin updates
        Object.assign(order, updates);
      }
      
      await order.save();

      // FIRE THE FIREBASE TEXT MESSAGE
      if (updates.status && order.shippingAddress && order.shippingAddress.phone) {
        sendFirebaseMessage(order.shippingAddress.phone, updates.status, order.orderId);
      }

      return res.status(200).json(order);
    }

    // DELETE ORDER (Admin)
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
