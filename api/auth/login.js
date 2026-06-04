const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  // CORS Headers so your local VS Code app can communicate with it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body;

    // Pull credentials securely from Vercel Environment Variables
    const expectedUsername = process.env.ADMIN_USERNAME;
    const expectedPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Verify username match
    if (username !== expectedUsername) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    // Verify password match using bcrypt against the saved hash
    const isMatch = await bcrypt.compare(password, expectedPasswordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    // Generate the secure token
    const token = jwt.sign(
      { role: 'admin', username: username },
      jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(200).json({ success: true, token });

  } catch (error) {
    console.error('Login API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
