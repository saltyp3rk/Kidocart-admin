
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
    firstName: String,
    lastName: String,
    phone: String,
    address: String,
    address2: String,
    city: String,
    state: String,
    zip: String,
    country: String,
    isDefault: Boolean
  }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

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

    const { action } = req.query;

    // REGISTER
    if (req.method === 'POST' && action === 'register') {
      const { name, email, password, phone } = req.body;

      // Validate input
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Please provide name, email, and password' });
      }

      // Check if user exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = new User({
        name,
        email,
        password: hashedPassword,
        phone,
        provider: 'local'
      });

      await user.save();

      // Generate token
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

    // LOGIN
    if (req.method === 'POST' && action === 'login') {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Please provide email and password' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if user registered with Google
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

    // GOOGLE LOGIN
    if (req.method === 'POST' && action === 'google') {
      const { googleId, email, name, picture } = req.body;

      if (!googleId || !email || !name) {
        return res.status(400).json({ error: 'Invalid Google data' });
      }

      let user = await User.findOne({ email });

      if (!user) {
        // Create new user
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
        // Link Google account
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

    // GET PROFILE
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

    // UPDATE PROFILE
    if (req.method === 'PUT' && action === 'profile') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
      
      const updates = req.body;
      delete updates.password; // Don't allow password update here

      const user = await User.findByIdAndUpdate(
        decoded.userId,
        updates,
        { new: true }
      ).select('-password');

      console.log('Profile updated:', user.email);

      return res.status(200).json(user);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
