const jwt = require('jsonwebtoken');

module.exports = function requireAdmin(req, res) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return false;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // login.js signs the token with { role: 'admin' } — accept that (and the
    // legacy isAdmin flag) so authenticated admins aren't wrongly 403'd.
    if (decoded.role !== 'admin' && !decoded.isAdmin) {
      res.status(403).json({ error: 'Forbidden: Admin access required' });
      return false;
    }

    return decoded;
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    return false;
  }
};
