// Vercel Serverless Function - Users API
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
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

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  phone: String,
  provider: { type: String, default: 'local' },
  googleId: String,
  picture: String,
  addresses: [{
    id: Number,
    name: String, // Added to support your new checkout logic
    firstName: String,
    lastName: String,
    phone: String,
    address: String,
    street: String, // Added to support your new checkout logic
    apartment: String,
    address2: String,
    city: String,
    state: String,
    zip: String,
    zipcode: String, // Added to support your new checkout logic
    country: String,
    isDefault: Boolean
  }],
  createdAt: { type: Date, default: Date.now }
}, { strict: false });

const User = mongoose.models.User || mongoose.model('User', userSchema);

const addressSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  firstName: String,
  lastName: String,
  name: String,
  phone: String,
  address: String,
  street: String,
  apartment: String,
  address2: String,
  city: String,
  state: String,
  pincode: String,
  zip: String,
  zipcode: String,
  country: { type: String, default: 'India' },
  isDefault: Boolean,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { strict: false });

const Address = mongoose.models.Address || mongoose.model('Address', addressSchema);

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
    const { action, admin } = req.query;

    // ─── ADMIN DASHBOARD: GET ALL CUSTOMERS (ENRICHED WITH MOBILE & ORDER ADDRESSES) ───
    if (req.method === 'GET' && (!action || admin === 'true')) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
      }

      try {
        const token = authHeader.replace('Bearer ', '');
        jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');

        const allUsers = await User.find().select('-password').sort({ createdAt: -1 }).lean();

        // 1. Fetch all addresses from standalone Address collection (used by mobile app)
        let allStandaloneAddresses = [];
        try {
          allStandaloneAddresses = await Address.find({}).sort({ isDefault: -1, createdAt: -1 }).lean();
        } catch (addrErr) {
          console.warn('[ADMIN-USERS] Failed to fetch standalone addresses:', addrErr.message);
        }

        // 2. Fetch shipping addresses from recent orders as fallback
        let recentOrders = [];
        try {
          recentOrders = await mongoose.connection.collection('orders')
            .find({}, { projection: { userId: 1, shippingAddress: 1, phone: 1, createdAt: 1 } })
            .sort({ createdAt: -1 })
            .toArray();
        } catch (ordErr) {
          console.warn('[ADMIN-USERS] Failed to fetch order addresses:', ordErr.message);
        }

        // Group standalone addresses by userId variants
        const standaloneByUserId = new Map();
        for (const addr of allStandaloneAddresses) {
          const uId = String(addr.userId || '').trim();
          if (uId) {
            if (!standaloneByUserId.has(uId)) standaloneByUserId.set(uId, []);
            standaloneByUserId.get(uId).push(addr);
          }
        }

        // Group order shipping addresses by userId
        const orderAddressesByUserId = new Map();
        for (const ord of recentOrders) {
          const uId = String(ord.userId || '').trim();
          if (uId && ord.shippingAddress && !orderAddressesByUserId.has(uId)) {
            orderAddressesByUserId.set(uId, ord.shippingAddress);
          }
        }

        const enrichedUsers = allUsers.map(user => {
          const idKey1 = String(user._id || '');
          const idKey2 = String(user.userId || '');
          const idKey3 = String(user.id || '');

          // Get all matching standalone addresses
          const standalone = [
            ...(standaloneByUserId.get(idKey1) || []),
            ...(idKey2 && idKey2 !== idKey1 ? (standaloneByUserId.get(idKey2) || []) : []),
            ...(idKey3 && idKey3 !== idKey1 && idKey3 !== idKey2 ? (standaloneByUserId.get(idKey3) || []) : [])
          ];

          // Get embedded addresses
          const embedded = Array.isArray(user.addresses) ? user.addresses : [];

          // Merge addresses avoiding duplicate entries
          const mergedAddresses = [...embedded];
          for (const s of standalone) {
            const sIdStr = s._id ? s._id.toString() : '';
            const isDuplicate = mergedAddresses.some(m => {
              const mIdStr = m._id ? m._id.toString() : (m.id ? String(m.id) : '');
              if (sIdStr && mIdStr && sIdStr === mIdStr) return true;
              return m.address && s.address && m.address.trim().toLowerCase() === s.address.trim().toLowerCase() && (m.pincode === s.pincode || m.zipcode === s.pincode);
            });

            if (!isDuplicate) {
              const cleanFullName = `${s.firstName || ''} ${s.lastName || ''}`.trim();
              mergedAddresses.push({
                _id: s._id,
                id: sIdStr || s.id,
                name: s.name || cleanFullName || user.name,
                firstName: s.firstName,
                lastName: s.lastName,
                phone: s.phone || user.phone,
                address: s.address || s.street,
                street: s.address || s.street,
                apartment: s.apartment || s.address2,
                city: s.city,
                state: s.state,
                pincode: s.pincode || s.zip || s.zipcode,
                zip: s.pincode || s.zip || s.zipcode,
                zipcode: s.pincode || s.zip || s.zipcode,
                country: s.country || 'India',
                isDefault: !!s.isDefault,
                createdAt: s.createdAt || new Date()
              });
            }
          }

          // If still no addresses, fallback to the address used on their most recent order
          if (mergedAddresses.length === 0) {
            const orderAddr = orderAddressesByUserId.get(idKey1) || 
                              (idKey2 ? orderAddressesByUserId.get(idKey2) : null) || 
                              (idKey3 ? orderAddressesByUserId.get(idKey3) : null);
            if (orderAddr) {
              mergedAddresses.push({
                name: orderAddr.name || `${orderAddr.firstName || ''} ${orderAddr.lastName || ''}`.trim() || user.name,
                firstName: orderAddr.firstName,
                lastName: orderAddr.lastName,
                phone: orderAddr.phone || user.phone,
                address: orderAddr.address || orderAddr.street,
                street: orderAddr.address || orderAddr.street,
                apartment: orderAddr.apartment || orderAddr.address2,
                city: orderAddr.city,
                state: orderAddr.state,
                pincode: orderAddr.pincode || orderAddr.zip || orderAddr.zipcode,
                zip: orderAddr.pincode || orderAddr.zip || orderAddr.zipcode,
                zipcode: orderAddr.pincode || orderAddr.zip || orderAddr.zipcode,
                country: orderAddr.country || 'India',
                isDefault: true,
                fromOrderHistory: true
              });
            }
          }

          // Compute accurate joined date if missing on mobile signup
          let resolvedCreatedAt = user.createdAt;
          if (!resolvedCreatedAt || isNaN(new Date(resolvedCreatedAt).getTime())) {
            if (user._id) {
              const idStr = String(user._id);
              if (/^[0-9a-fA-F]{24}$/.test(idStr)) {
                const sec = parseInt(idStr.substring(0, 8), 16);
                if (!isNaN(sec) && sec > 1500000000) resolvedCreatedAt = new Date(sec * 1000);
              }
            }
            if ((!resolvedCreatedAt || isNaN(new Date(resolvedCreatedAt).getTime())) && user.userId) {
              const match = String(user.userId).match(/^user-(\d{10,13})$/);
              if (match) {
                const ts = parseInt(match[1], 10);
                resolvedCreatedAt = new Date(ts < 10000000000 ? ts * 1000 : ts);
              }
            }
            if ((!resolvedCreatedAt || isNaN(new Date(resolvedCreatedAt).getTime())) && user.updatedAt) {
              resolvedCreatedAt = user.updatedAt;
            }
          }

          return {
            ...user,
            createdAt: resolvedCreatedAt || user.createdAt,
            addresses: mergedAddresses
          };
        });

        return res.status(200).json(enrichedUsers);
      } catch (error) {
        console.error('Token Verification Error:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }
    }

    // ─── STOREFRONT: REGISTER ───
    if (req.method === 'POST' && action === 'register') {
      const { name, email, password, phone } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Please provide name, email, and password' });
      }

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = new User({
        name,
        email,
        password: hashedPassword,
        phone,
        provider: 'local'
      });

      await user.save();

      const token = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET || 'fallback-secret-key',
        { expiresIn: '7d' }
      );

      console.log('User registered:', user.email);

      return res.status(201).json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone
        }
      });
    }

    // ─── STOREFRONT: LOGIN ───
    if (req.method === 'POST' && action === 'login') {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Please provide email and password' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (user.provider === 'google' && !user.password) {
        return res.status(401).json({ error: 'Please login with Google' });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET || 'fallback-secret-key',
        { expiresIn: '7d' }
      );

      console.log('User logged in:', user.email);

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          addresses: user.addresses
        }
      });
    }

    // ─── STOREFRONT: GOOGLE LOGIN ───
    if (req.method === 'POST' && action === 'google') {
      const { googleId, email, name, picture } = req.body;

      if (!googleId || !email || !name) {
        return res.status(400).json({ error: 'Invalid Google data' });
      }

      let user = await User.findOne({ email });

      if (!user) {
        user = new User({
          name,
          email,
          googleId,
          picture,
          provider: 'google'
        });
        await user.save();
        console.log('New Google user:', email);
      } else if (!user.googleId) {
        user.googleId = googleId;
        user.picture = picture;
        await user.save();
        console.log('Google account linked:', email);
      }

      const token = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET || 'fallback-secret-key',
        { expiresIn: '7d' }
      );

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          picture: user.picture,
          addresses: user.addresses
        }
      });
    }

    // ─── STOREFRONT: GET PROFILE ───
    if (req.method === 'GET' && action === 'profile') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
      const user = await User.findById(decoded.userId).select('-password');

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json(user);
    }

    // ─── STOREFRONT: UPDATE PROFILE ───
    if (req.method === 'PUT' && action === 'profile') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
      
      const updates = req.body;
      delete updates.password; 

      const user = await User.findByIdAndUpdate(
        decoded.userId,
        updates,
        { new: true }
      ).select('-password');

      console.log('Profile updated:', user.email);

      return res.status(200).json(user);
    }

    // ─── STOREFRONT: ADD ADDRESS (Triggered during checkout) ───
    if (req.method === 'POST' && action === 'add-address') {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'No token provided' });

      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
      
      const user = await User.findById(decoded.userId || decoded.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const newAddress = req.body;
      if (newAddress.isDefault && user.addresses) {
        user.addresses.forEach(a => a.isDefault = false);
      }
      
      if (!user.addresses) user.addresses = [];
      user.addresses.push(newAddress);
      
      await user.save();
      return res.status(200).json(user);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
