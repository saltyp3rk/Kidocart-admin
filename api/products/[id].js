// Vercel dynamic route handler for /api/products/[id]
const productsHandler = require('./index.js');

module.exports = async (req, res) => {
  if (!req.query) req.query = {};
  if (!req.query.id) {
    const segments = req.url.split('?')[0].split('/').filter(Boolean);
    const lastSeg = segments[segments.length - 1];
    if (lastSeg && lastSeg !== 'products' && lastSeg !== '[id]') {
      req.query.id = lastSeg;
    }
  }
  return productsHandler(req, res);
};
