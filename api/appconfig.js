// Vercel Serverless Function - App Content Config API
// Stores admin-controllable mobile content (announcement/marquee, and later
// carousel + flash-sale) in a single MongoDB document. The mobile app reads
// this (GET, public); the admin dashboard writes it (POST/PUT, token-gated).
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) return;
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
};

const appConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  announcement: {
    enabled: { type: Boolean, default: true },
    messages: { type: [String], default: [] },
  },
  flashSale: {
    enabled: { type: Boolean, default: false },
    title: { type: String, default: 'Flash Sale' },
    subtitle: { type: String, default: '' },
    endTime: { type: Date, default: null },
  },
  updatedAt: { type: Date, default: Date.now },
}, { strict: false }); // strict:false so we can add carousel later

const AppConfig = mongoose.models.AppConfig || mongoose.model('AppConfig', appConfigSchema);

const DEFAULTS = {
  key: 'main',
  announcement: {
    enabled: true,
    messages: [
      'Free Shipping over ₹499',
      'Flash Sale — Live Now',
      'Buy 2 Get 1 Free',
      'Weekend Deals Unlocked',
    ],
  },
};

function verifyAdmin(req) {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  try {
    jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'fallback-secret-key');
    return true;
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectDB();

    // READ — public (mobile app + admin dashboard)
    if (req.method === 'GET') {
      let cfg = await AppConfig.findOne({ key: 'main' }).lean();
      if (!cfg) cfg = DEFAULTS; // never 404 — always return usable content
      return res.status(200).json(cfg);
    }

    // WRITE — admin only
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!verifyAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

      const { announcement, flashSale } = req.body || {};
      const update = { updatedAt: new Date() };
      if (announcement) {
        update.announcement = {
          enabled: announcement.enabled !== false,
          messages: Array.isArray(announcement.messages)
            ? announcement.messages.map(m => String(m).trim()).filter(Boolean)
            : [],
        };
      }
      if (flashSale) {
        update.flashSale = {
          enabled: !!flashSale.enabled,
          title: (flashSale.title || 'Flash Sale').toString().trim(),
          subtitle: (flashSale.subtitle || '').toString().trim(),
          endTime: flashSale.endTime ? new Date(flashSale.endTime) : null,
        };
      }

      const cfg = await AppConfig.findOneAndUpdate(
        { key: 'main' },
        { $set: update, $setOnInsert: { key: 'main' } },
        { new: true, upsert: true },
      ).lean();

      return res.status(200).json({ success: true, config: cfg });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[APPCONFIG-ERROR]:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
