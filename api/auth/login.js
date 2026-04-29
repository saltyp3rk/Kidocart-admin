const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const axios = require('axios');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// ==================== ENVIRONMENT VARIABLES ====================
const MONGODB_URI = process.env.MONGODB_URI;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

// ==================== INITIALIZE CLIENTS ====================
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// ==================== FIREBASE ADMIN INIT ====================
function getFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });

  return admin;
}

// ==================== MONGODB CONNECTION ====================
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;
  const client = await mongoose.connect(MONGODB_URI);
  cachedDb = client;
  return cachedDb;
}

// ==================== SCHEMAS ====================
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true },
  password: { type: String, select: true },
  name: String,
  phone: { type: String, unique: true, sparse: true },
  authProvider: String,
  googleId: String,
  firebaseUid: String,
  avatar: String,
  addresses: { type: Array, default: [] },
  createdAt: { type: Date, default: Date.now }
}, { strict: false });

const otpSchema = new mongoose.Schema({
  email: String,
  phone: String,
  otp: String,
  createdAt: { type: Date, expires: 300, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const OTP = mongoose.models.OTP || mongoose.model('OTP', otpSchema);

// ==================== EMAIL SENDER ====================
async function sendEmailOTP(email, otp) {
  const emailHTML = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; border: 1px solid #f0f0f0; border-radius: 12px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #FF6B35; font-size: 28px; margin: 0;">🛍️ KidoCart</h1>
      </div>
      <h2 style="color: #1e293b; font-size: 20px;">Your Verification Code</h2>
      <p style="color: #64748b;">Use the code below to verify your identity.</p>
      <div style="background: #fff7f5; border: 2px solid #FF6B35; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
        <p style="color: #64748b; font-size: 14px; margin: 0 0 8px 0;">Your OTP is</p>
        <h1 style="font-size: 48px; color: #FF6B35; letter-spacing: 12px; margin: 0; font-weight: 700;">
          ${otp}
        </h1>
      </div>
      <p style="color: #64748b; font-size: 14px;">
        ⏰ This code expires in <strong>5 minutes</strong>.
      </p>
      <p style="color: #94a3b8; font-size: 12px;">
        🔒 Do not share this code with anyone. KidoCart will never ask for your OTP.
      </p>
      <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 24px 0;">
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">
        © 2024 KidoCart. All rights reserved.
      </p>
    </div>
  `;

  // Try Gmail first
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: GMAIL_USER,
          pass: GMAIL_APP_PASSWORD
        }
      });

      await transporter.sendMail({
        from: `KidoCart <${GMAIL_USER}>`,
        to: email,
        subject: `${otp} is your KidoCart verification code`,
        html: emailHTML
      });

      console.log(`✅ Gmail OTP sent to ${email}`);
      return { success: true, method: 'gmail' };

    } catch (gmailError) {
      console.error('Gmail error:', gmailError.message);
    }
  }

  // Try Resend as fallback
  if (resend) {
    try {
      await resend.emails.send({
        from: 'KidoCart <onboarding@resend.dev>',
        to: [email],
        subject: `${otp} is your KidoCart verification code`,
        html: emailHTML
      });

      console.log(`✅ Resend OTP sent to ${email}`);
      return { success: true, method: 'resend' };

    } catch (resendError) {
      console.error('Resend error:', resendError.message);
    }
  }

  // Dev fallback
  console.log(`📧 DEV FALLBACK - OTP for ${email}: ${otp}`);
  return { success: false, method: 'console' };
}

// ==================== HANDLER FUNCTIONS ====================

// ----------------------------------------
// LOGIN (Email + Password)
// ----------------------------------------
async function handleLogin(req, res) {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    if (user.authProvider === 'google') {
      return res.status(400).json({ error: 'Please login with Google' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({ token, user });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ----------------------------------------
// SIGNUP (Email + Password)
// ----------------------------------------
async function handleSignup(req, res) {
  const { name, email, password, phone } = req.body;

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      phone: phone || null,
      password: hashedPassword,
      authProvider: 'email',
      addresses: []
    });

    const token = jwt.sign(
      { userId: user._id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({ token, user });

  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ----------------------------------------
// SIGNUP (Phone Only - legacy)
// ----------------------------------------
async function handleSignupPhone(req, res) {
  const { name, phone } = req.body;

  try {
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    const user = await User.create({
      name,
      phone,
      authProvider: 'phone',
      email: `${phone}@kidocart.local`,
      addresses: []
    });

    const token = jwt.sign(
      { userId: user._id, phone: user.phone, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({ token, user });

  } catch (error) {
    console.error('Signup phone error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ----------------------------------------
// GOOGLE AUTH
// ----------------------------------------
async function handleGoogle(req, res) {
  const { credential } = req.body;

  try {
    if (!googleClient) {
      return res.status(500).json({ error: 'Google auth not configured' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const { email, name, picture, sub: googleId } = ticket.getPayload();

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        email,
        name,
        avatar: picture,
        googleId,
        authProvider: 'google',
        addresses: []
      });
    } else {
      user.avatar = picture;
      await user.save();
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({ token, user });

  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(500).json({ error: 'Google authentication failed' });
  }
}

// ----------------------------------------
// CHECK IF USER EXISTS
// ----------------------------------------
async function handleCheckUser(req, res) {
  const { email, phone } = req.body;

  try {
    let user = null;

    if (phone) {
      user = await User.findOne({ phone });
    } else if (email) {
      user = await User.findOne({ email });
    } else {
      return res.status(400).json({ error: 'Email or phone required' });
    }

    return res.status(200).json({ exists: !!user });

  } catch (error) {
    console.error('Check user error:', error);
    return res.status(500).json({ exists: false });
  }
}

// ----------------------------------------
// SEND OTP (Email via Gmail OR Phone)
// ----------------------------------------
async function handleSendOTP(req, res) {
  const { email, phone } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'Email or phone is required' });
  }

  try {
    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');

    // Delete old OTP records
    if (email) {
      await OTP.deleteMany({ email });
    } else {
      await OTP.deleteMany({ phone });
    }

    // Save new OTP to database
    await OTP.create({
      ...(email && { email }),
      ...(phone && { phone }),
      otp: hashedOTP
    });

    // Send Email OTP
    if (email) {
      await sendEmailOTP(email, otp);

    // Send Phone OTP via MSG91
    } else if (phone && MSG91_AUTH_KEY) {
      try {
        await axios.post('https://api.msg91.com/apiv5/otp/send', {
          mobile: phone,
          message: `Your KidoCart verification code is ${otp}. Valid for 5 minutes.`,
          route: 'otp'
        }, {
          headers: {
            'authkey': MSG91_AUTH_KEY,
            'Content-Type': 'application/json'
          }
        });
      } catch (smsError) {
        console.error('MSG91 error:', smsError.message);
      }

    } else if (phone) {
      console.log(`📱 DEV MODE - OTP for ${phone}: ${otp}`);
    }

    return res.status(200).json({ message: 'OTP sent successfully' });

  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
}

// ----------------------------------------
// VERIFY OTP (Email or Phone)
// ----------------------------------------
async function handleVerifyOTP(req, res) {
  const { email, phone, otp, name } = req.body;

  if ((!email && !phone) || !otp) {
    return res.status(400).json({ error: 'Email/Phone and OTP are required' });
  }

  try {
    const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
    const query = email ? { email } : { phone };

    const record = await OTP.findOne(query);

    if (!record) {
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    if (record.otp !== hashedOTP) {
      return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
    }

    // Delete OTP - cannot be reused
    await OTP.deleteMany(query);

    // Find or create user
    let user = await User.findOne(query);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await User.create({
        ...(email && { email }),
        ...(phone && { phone }),
        name: name || (email ? email.split('@')[0] : `User${phone.slice(-4)}`),
        email: email || `${phone}@kidocart.local`,
        authProvider: 'otp',
        addresses: []
      });
      console.log(`✅ New user created: ${user._id}`);
    } else {
      console.log(`✅ Existing user logged in: ${user._id}`);
    }

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        phone: user.phone,
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      token,
      isNewUser,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar || null,
        authProvider: user.authProvider,
        addresses: user.addresses || [],
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ error: 'OTP verification failed' });
  }
}

// ----------------------------------------
// FIREBASE VERIFY (Phone OTP via Firebase)
// ----------------------------------------
async function handleFirebaseVerify(req, res) {
  const { idToken, name, phone, isSignup } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'Firebase token is required' });
  }

  try {
    const firebaseAdmin = getFirebaseAdmin();
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);

    const firebasePhone = decodedToken.phone_number;
    const firebaseUid = decodedToken.uid;

    if (!firebasePhone) {
      return res.status(400).json({ error: 'Phone number not found in Firebase token' });
    }

    const cleanPhone = firebasePhone.replace('+91', '').replace(/\D/g, '');
    console.log(`Firebase verified phone: ${firebasePhone} → clean: ${cleanPhone}`);

    let user = await User.findOne({ phone: cleanPhone });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await User.create({
        phone: cleanPhone,
        name: name || `User${cleanPhone.slice(-4)}`,
        email: `${cleanPhone}@kidocart.local`,
        authProvider: 'firebase-phone',
        firebaseUid: firebaseUid,
        addresses: [],
        createdAt: new Date()
      });
      console.log(`✅ New user created: ${user._id}`);
    } else {
      if (!user.firebaseUid) {
        user.firebaseUid = firebaseUid;
        await user.save();
      }
      console.log(`✅ Existing user logged in: ${user._id}`);
    }

    const token = jwt.sign(
      {
        userId: user._id,
        phone: user.phone,
        name: user.name,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      token,
      isNewUser,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatar: user.avatar || null,
        authProvider: user.authProvider,
        addresses: user.addresses || [],
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Firebase verify error:', error);

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Session expired. Please try again.' });
    }
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'Token revoked. Please login again.' });
    }
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Invalid token. Please try again.' });
    }
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Account already exists.' });
    }

    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await connectToDatabase();
    const { type } = req.query;

    switch (type) {
      case 'login':
        return await handleLogin(req, res);
      case 'signup':
        return await handleSignup(req, res);
      case 'signup-phone':
        return await handleSignupPhone(req, res);
      case 'google':
        return await handleGoogle(req, res);
      case 'check-user':
        return await handleCheckUser(req, res);
      case 'send-otp':
        return await handleSendOTP(req, res);
      case 'verify-otp':
        return await handleVerifyOTP(req, res);
      case 'firebase-verify':
        return await handleFirebaseVerify(req, res);
      default:
        return res.status(400).json({ error: `Invalid auth type: ${type}` });
    }

  } catch (error) {
    console.error('Auth handler error:', error);
    return res.status(500).json({ error: error.message });
  }
};
