// Vercel Serverless Function - Orders API
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

// ─── FIREBASE ADMIN INITIALIZATION ───
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
      const creds = typeof raw === 'string' ? JSON.parse(raw) : raw;
      admin.initializeApp({ credential: admin.credential.cert(creds) });
      console.log('Firebase Admin Initialized with FIREBASE_SERVICE_ACCOUNT');
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
        })
      });
      console.log('Firebase Admin Initialized with PROJECT_ID');
    } else {
      admin.initializeApp();
    }
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
  const DELHIVERY_TOKEN = process.env.DELHIVERY_TOKEN || 'bab3ac4ad2d47c981a6061eadc0512841af12c57'; 
  const WAREHOUSE_NAME = process.env.DELHIVERY_WAREHOUSE_NAME || 'Farzan Online Services';
  const DELHIVERY_URL = 'https://track.delhivery.com/api/cmu/create.json';

  if (!DELHIVERY_TOKEN) {
    console.error('Skipping Delhivery: No token found in environment');
    return { success: false, error: 'DELHIVERY_TOKEN missing in server environment' };
  }

  const addr = order.shippingAddress || {};
  const fName = addr.firstName || addr.name || '';
  const lName = addr.lastName || '';
  const fullName = `${fName} ${lName}`.trim() || 'Customer';
  const fullAddress = `${addr.address || ''} ${addr.apartment || addr.address2 || ''}`.trim();
  const phone = String(order.phone || addr.phone || '').replace(/[^0-9]/g, '').slice(-10);
  const pin = String(addr.pincode || addr.zip || addr.zipcode || '').replace(/[^0-9]/g, '');

  if (!pin || pin.length !== 6) {
    return { success: false, error: `Invalid destination PIN code: "${pin}"` };
  }
  if (!phone || phone.length !== 10) {
    return { success: false, error: `Invalid customer phone number: "${phone}"` };
  }

  const itemCount = Array.isArray(order.items) 
    ? order.items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)
    : 1;

  // Weight in grams: approximate 500g per item if not specified
  const totalWeight = Array.isArray(order.items)
    ? order.items.reduce((sum, item) => sum + ((Number(item.weight) || 500) * (Number(item.quantity) || 1)), 0)
    : 500;

  const payload = {
    pickup_location: {
      name: WAREHOUSE_NAME
    },
    shipments: [
      {
        name: fullName,
        add: fullAddress,
        pin: pin,
        city: addr.city || 'Pune',
        state: addr.state || 'Maharashtra',
        country: "India",
        phone: phone,
        order: order.orderId || (order._id ? order._id.toString() : ''),
        payment_mode: order.paymentMethod === 'cod' ? 'COD' : 'Pre-paid',
        products_desc: "KidoCart Products",
        hsn_code: "4820", 
        cod_amount: order.paymentMethod === 'cod' ? Number(order.total) || 0 : 0,
        order_date: new Date(order.createdAt || Date.now()).toISOString().split('T')[0],
        total_amount: Number(order.total) || 0,
        weight: totalWeight,
        seller_add: "KidoCart, Malegaon",
        seller_name: "KidoCart",
        seller_inv: "INV-" + (order.orderId || '').slice(-6),
        quantity: itemCount
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
       const pkg = data.packages[0];
       console.log('Delhivery Success! AWB:', pkg.waybill);
       return {
         success: true,
         waybill: pkg.waybill,
         refnum: pkg.refnum,
         status: pkg.status,
         sortCode: pkg.sort_code,
         raw: data
       };
    } else {
       console.error('Delhivery Rejected Order:', JSON.stringify(data, null, 2));
       const errorRemark = (data.packages && data.packages[0] && data.packages[0].remarks && data.packages[0].remarks[0])
         || data.rmk
         || 'Delhivery shipment booking was rejected';
       return {
         success: false,
         error: errorRemark,
         raw: data
       };
    }
  } catch (error) {
    console.error('Delhivery API Crash:', error);
    return {
      success: false,
      error: error.message || 'Network exception while connecting to Delhivery API'
    };
  }
}

// ─── DELHIVERY SHIPMENT CANCELLATION ───
async function cancelDelhiveryShipment(waybill) {
  const DELHIVERY_TOKEN = process.env.DELHIVERY_TOKEN || 'bab3ac4ad2d47c981a6061eadc0512841af12c57';
  if (!DELHIVERY_TOKEN || !waybill) {
    return { success: false, error: 'Missing token or waybill' };
  }

  try {
    const response = await fetch('https://track.delhivery.com/api/p/edit', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DELHIVERY_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        waybill: String(waybill).trim(),
        cancellation: 'true'
      })
    });

    const data = await response.json();
    return {
      success: data.status === true,
      data
    };
  } catch (error) {
    console.error('Delhivery cancellation error:', error);
    return { success: false, error: error.message };
  }
}

// ─── PRODUCT SCHEMA & MODEL ───
const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  originalPrice: Number,
  images: [String],
  image: String,
  category: String,
  brand: String,
  stock: Number
}, { strict: false });
const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

// ─── ORDER SCHEMA (FIXED: Added missing tracking and tracking/cancellation fields) ───
const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  userId: String,
  items: [{
    productId: { type: mongoose.Schema.Types.Mixed },
    name: String,
    price: Number,
    quantity: Number,
    size: String,
    color: String,
    image: String,
    images: [String],
    product: { type: Object }
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
  
  // Logistics & Delivery Integration (Delhivery)
  courier: { type: String, default: 'Delhivery' },
  trackingNumber: String, 
  shipmentId: String,
  deliveryStatus: { type: String, default: 'unbooked' },
  shipmentBookingError: String,
  cancelReason: String,   

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

// ─── ENRICH ORDERS WITH PRODUCT DETAILS (Images, Names, Brands) ───
async function enrichOrdersWithProducts(orders) {
  if (!orders) return orders;
  const isArray = Array.isArray(orders);
  const list = isArray ? orders : [orders];

  const idSet = new Set();
  for (const o of list) {
    if (Array.isArray(o.items)) {
      for (const item of o.items) {
        if (!item) continue;
        const pid = (item.productId && typeof item.productId === 'object' && item.productId._id)
          ? item.productId._id
          : (item.productId || item.id || (item.product && (item.product._id || item.product.id)));
        if (pid) idSet.add(String(pid));
      }
    }
  }

  if (idSet.size > 0) {
    try {
      const allIds = Array.from(idSet);
      const objectIds = allIds
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

      const queryConds = [{ id: { $in: allIds } }];
      if (objectIds.length > 0) {
        queryConds.push({ _id: { $in: objectIds } });
      }

      const products = await Product.find({ $or: queryConds })
        .select('name images image price brand category')
        .lean();

      const productMap = new Map();
      for (const p of products) {
        productMap.set(String(p._id), p);
        if (p.id) productMap.set(String(p.id), p);
      }

      for (const o of list) {
        if (Array.isArray(o.items)) {
          for (const item of o.items) {
            if (!item) continue;
            const pid = (item.productId && typeof item.productId === 'object' && item.productId._id)
              ? String(item.productId._id)
              : String(item.productId || item.id || (item.product && (item.product._id || item.product.id)) || '');

            const prod = productMap.get(pid) || (item.product && typeof item.product === 'object' ? item.product : null);
            if (prod) {
              const primaryImg = (Array.isArray(prod.images) && prod.images[0]) || prod.image || (Array.isArray(item.images) && item.images[0]) || item.image || '';
              if (!item.name && prod.name) item.name = prod.name;
              if (!item.image && primaryImg) item.image = primaryImg;
              if (!item.images && prod.images) item.images = prod.images;
              if (!item.brand && prod.brand) item.brand = prod.brand;
              if (!item.product) {
                item.product = {
                  _id: prod._id,
                  name: prod.name,
                  images: prod.images || (primaryImg ? [primaryImg] : []),
                  image: primaryImg,
                  price: prod.price,
                  brand: prod.brand
                };
              }
            }
          }
        }
      }
    } catch (enrichErr) {
      console.error('[ORDERS ENRICHMENT ERROR]:', enrichErr);
    }
  }

  return isArray ? list : list[0];
}

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

// ─── DEVICE TOKEN & NOTIFICATION MODELS ───
const deviceTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: String, sparse: true, default: null },
  platform: { type: String, default: 'android' },
  updatedAt: { type: Date, default: Date.now },
});
const DeviceToken = mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);

const notificationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, default: 'order' },
  read: { type: Boolean, default: false },
  data: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
});
const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

async function sendFcmOrderNotification(order, status) {
  const shortId = (order.orderId || order._id.toString()).slice(-6);
  const statusUpper = String(status || order.status || '').toUpperCase();
  let title = `Order Update: #${shortId}`;
  let body = `Your order #${shortId} status has been updated to ${statusUpper}.`;

  if (status === 'shipped') {
    title = `Order Shipped! #${shortId}`;
    body = `Great news! Your KidoCart order #${shortId} is on the way.`;
  } else if (status === 'delivered') {
    title = `Order Delivered! #${shortId}`;
    body = `Your KidoCart order #${shortId} has been delivered. Enjoy!`;
  } else if (status === 'cancelled') {
    title = `Order Cancelled #${shortId}`;
    body = `Your order #${shortId} has been cancelled.`;
  } else if (status === 'processing') {
    title = `Order Processing #${shortId}`;
    body = `We're preparing your order #${shortId} for dispatch.`;
  } else if (status === 'confirmed') {
    title = `Order Confirmed! #${shortId}`;
    body = `Thank you! Your order #${shortId} has been confirmed.`;
  }

  // 1. Save in-app notification in DB
  try {
    const notif = new Notification({
      userId: order.userId || 'all',
      title,
      body,
      type: 'order',
      data: { orderId: String(order._id), status: String(status) },
    });
    await notif.save();
    console.log('[PUSH] In-app notification saved for user:', order.userId);
  } catch (err) {
    console.warn('[PUSH] Failed to save in-app notification:', err.message);
  }

  // 2. Query FCM device tokens
  let tokens = [];
  try {
    if (order.userId) {
      const userTokens = await DeviceToken.find({ userId: order.userId }).lean();
      tokens = userTokens.map(t => t.token).filter(Boolean);
    }
    if (!tokens.length) {
      const recentTokens = await DeviceToken.find().sort({ updatedAt: -1 }).limit(10).lean();
      tokens = recentTokens.map(t => t.token).filter(Boolean);
    }
  } catch (err) {
    console.error('[PUSH] Failed to fetch device tokens:', err.message);
  }

  if (!tokens.length) {
    console.log('[PUSH] No FCM device tokens found in database');
    return;
  }

  // 3. Dispatch multicast via Firebase Admin with rich Android notification styling
  if (admin.apps.length > 0 && admin.messaging) {
    try {
      const firstItemImage = order.items?.[0]?.image || order.items?.[0]?.images?.[0] || null;
      const imageUrl = (firstItemImage && typeof firstItemImage === 'string' && firstItemImage.startsWith('http')) ? firstItemImage : undefined;

      const resp = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title,
          body,
          ...(imageUrl ? { imageUrl } : {}),
        },
        android: {
          priority: 'high',
          notification: {
            title,
            body,
            icon: 'ic_notification',
            color: '#FF6B35',
            channelId: 'kidocart_orders',
            sound: 'default',
            defaultSound: true,
            defaultVibrateTimings: true,
            tag: `order_${shortId}`,
            ...(imageUrl ? { imageUrl } : {}),
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
        data: {
          orderId: String(order._id),
          type: 'order',
          status: String(status),
        },
      });
      console.log(`[PUSH] FCM sent successfully to ${resp.successCount} devices (${resp.failureCount} failed)`);
    } catch (fcmErr) {
      console.error('[PUSH] FCM multicast error:', fcmErr.message);
    }
  } else {
    console.log('[PUSH] Firebase Admin messaging not initialized');
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

      if (isAdmin === 'true' || decoded.role === 'admin' || decoded.isAdmin) {
        const orders = await Order.find()
          .sort({ createdAt: -1 })
          .lean();
        const enrichedOrders = await enrichOrdersWithProducts(orders);
        return res.status(200).json(enrichedOrders);
      }

      if (targetId) {
        const order = await Order.findOne({ 
          ...getSearchQuery(targetId), 
          userId: decoded.userId 
        }).lean();
        if (!order) return res.status(404).json({ error: 'Order not found' });
        const enrichedOrder = await enrichOrdersWithProducts(order);
        return res.status(200).json(enrichedOrder);
      }

      const orders = await Order.find({ userId: decoded.userId }).sort({ createdAt: -1 }).lean();
      const enrichedOrders = await enrichOrdersWithProducts(orders);
      return res.status(200).json(enrichedOrders);
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

      let shipmentResult = null;

      // Trigger Delhivery shipment creation if status switches to processing OR if explicit booking requested
      const wantsBooking = (updates.status === 'processing' || updates.bookShipment === true || updates.action === 'book_delhivery');
      const isPlaceholderAwb = order.trackingNumber === '1123213123123';
      const hasConfirmedBooking = order.trackingNumber && !isPlaceholderAwb && order.deliveryStatus === 'booked';

      if (wantsBooking && !hasConfirmedBooking && updates.status !== 'cancelled') {
        console.log(`[DELHIVERY] Initiating shipment creation for order ${order.orderId}...`);
        shipmentResult = await createDelhiveryShipment(order);
        
        if (shipmentResult.success && shipmentResult.waybill) {
          order.trackingNumber = shipmentResult.waybill;
          order.shipmentId = shipmentResult.waybill;
          order.courier = 'Delhivery';
          order.deliveryStatus = 'booked';
          order.shipmentBookingError = null;
          console.log(`[DELHIVERY] Order ${order.orderId} booked successfully! AWB: ${shipmentResult.waybill}`);
        } else {
          order.deliveryStatus = 'booking_failed';
          order.shipmentBookingError = shipmentResult.error || 'Failed to create Delhivery shipment';
          console.error(`[DELHIVERY] Booking failed for order ${order.orderId}:`, shipmentResult.error);
        }
      }

      // Handle cancellations securely vs standard admin updates
      if (req.url.includes('/cancel') || updates.status === 'cancelled') {
        if (['delivered'].includes(order.status)) {
          return res.status(400).json({ error: 'Order cannot be cancelled at this stage' });
        }
        order.status = 'cancelled';
        if (updates.cancelReason) order.cancelReason = updates.cancelReason;

        // If order had an active Delhivery shipment, cancel it with Delhivery
        if (order.trackingNumber && !isPlaceholderAwb && order.courier === 'Delhivery') {
          console.log(`[DELHIVERY] Cancelling shipment ${order.trackingNumber} with Delhivery...`);
          cancelDelhiveryShipment(order.trackingNumber).then(cancelRes => {
            console.log(`[DELHIVERY] Shipment cancellation response:`, cancelRes);
          }).catch(err => {
            console.error(`[DELHIVERY] Cancellation error:`, err);
          });
          order.deliveryStatus = 'cancelled';
        }
      } else {
        // If shipment booking succeeded, ensure manual trackingNumber does not overwrite the real AWB
        if (shipmentResult && shipmentResult.success && shipmentResult.waybill) {
          delete updates.trackingNumber;
        }
        Object.assign(order, updates);
      }
      
      // FIXED: Ensures timestamp updates correctly on all execution paths
      order.updatedAt = new Date(); 
      await order.save();

      // FIXED: Looks directly at the finalized order status so cancellation SMS works
      if (order.status && order.shippingAddress && order.shippingAddress.phone) {
        sendFirebaseMessage(order.shippingAddress.phone, order.status, order.orderId);
      }

      // Dispatch push notification to customer's mobile app via FCM
      await enrichOrdersWithProducts(order).catch(() => {});
      await sendFcmOrderNotification(order, order.status).catch(err => {
        console.error('[PUSH-TRIGGER-ERROR]:', err.message);
      });

      const responsePayload = order.toObject ? order.toObject() : order;
      if (shipmentResult) {
        responsePayload.shipmentResult = shipmentResult;
      }
      return res.status(200).json(responsePayload);
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
