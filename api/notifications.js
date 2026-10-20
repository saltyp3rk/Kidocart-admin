// Kidocart-admin/api/notifications.js - CommonJS
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

let cachedDb = null;
async function connectDB() {
  if (cachedDb && mongoose.connection.readyState >= 1) return cachedDb;
  const client = await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  cachedDb = client;
  return cachedDb;
}

const deviceTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: String, sparse: true, default: null },
  platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
  updatedAt: { type: Date, default: Date.now },
});

const DeviceToken = mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);

const notificationSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, enum: ['order', 'delivery', 'promo', 'wishlist', 'system'], default: 'system' },
  read: { type: Boolean, default: false },
  data: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
});

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

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

let firebaseAdmin = null;
function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
        const creds = typeof raw === 'string' ? JSON.parse(raw) : raw;
        admin.initializeApp({ credential: admin.credential.cert(creds) });
      } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
          })
        });
      } else {
        admin.initializeApp();
      }
    }
    firebaseAdmin = admin;
    return firebaseAdmin;
  } catch (err) {
    console.warn('[FCM-ADMIN] firebase-admin initialization failed:', err.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectDB();
    const { action } = req.query;

    // GET stats or recent notifications
    if (req.method === 'GET') {
      const [tokenCount, recent] = await Promise.all([
        DeviceToken.countDocuments(),
        Notification.find().sort({ createdAt: -1 }).limit(10).lean(),
      ]);
      return res.status(200).json({ registeredDevices: tokenCount, recentNotifications: recent });
    }

    // SEND NOTIFICATION
    if (req.method === 'POST') {
      if (!verifyAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized: Admin token required' });
      }

      const { title, body, type = 'promo', data = {}, targetUserId } = req.body || {};
      if (!title || !body) {
        return res.status(400).json({ error: 'Title and body are required' });
      }

      // 1. Save in MongoDB
      const notif = new Notification({
        userId: targetUserId || 'all',
        title: title.trim(),
        body: body.trim(),
        type,
        data,
      });
      await notif.save();

      // 2. Fetch device tokens
      const tokenQuery = targetUserId ? { userId: targetUserId } : {};
      const tokenDocs = await DeviceToken.find(tokenQuery).lean();
      const tokens = tokenDocs.map(d => d.token).filter(Boolean);

      let sentCount = 0;
      let failureCount = 0;
      let status = 'saved_in_db';

      // 3. Dispatch via FCM
      if (tokens.length > 0) {
        const adminMod = getFirebaseAdmin();
        if (adminMod && adminMod.messaging) {
          try {
            const fcmResponse = await adminMod.messaging().sendEachForMulticast({
              tokens,
              notification: { title: title.trim(), body: body.trim() },
              data: {
                ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
                type,
              },
            });
            sentCount = fcmResponse.successCount;
            failureCount = fcmResponse.failureCount;
            status = `Sent to ${sentCount} devices (${failureCount} failed)`;
          } catch (fcmErr) {
            console.error('[FCM-ADMIN] multicast error:', fcmErr.message);
            status = 'FCM Send Error: ' + fcmErr.message;
          }
        } else {
          status = 'Firebase Service Account not set on server. Device tokens registered: ' + tokens.length;
        }
      } else {
        status = 'No registered devices found in database';
      }

      return res.status(200).json({
        success: true,
        sentCount,
        failureCount,
        registeredDevices: tokens.length,
        status,
        notification: notif,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[NOTIF-ADMIN-ERROR]:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
};
