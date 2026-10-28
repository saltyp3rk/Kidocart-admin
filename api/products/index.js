// Vercel Serverless Function - Products API
const mongoose = require('mongoose');

// ─── Bulletproof Serverless MongoDB Connection ───
const connectDB = async () => {
  // Checks the actual live connection state, not a stale cache variable
  if (mongoose.connection.readyState >= 1) return;
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
};

// Product Schema with multiple images
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  originalPrice: Number,
  category: String,
  ageGroup: String,
  brand: String,
  images: [String], // Array of image URLs
  stock: { type: Number, default: 0 },
  availability: { type: Boolean, default: true },
  rating: { type: Number, default: 4.5 },
  reviewCount: { type: Number, default: 0 },
  reviews: [{
    userName: String,
    rating: Number,
    comment: String,
    date: { type: Date, default: Date.now }
  }],
  weight: Number,
  dimensions: {
    length: Number,
    width: Number,
    height: Number,
    weight: Number,
    unit: { type: String, default: 'cm' }
  },
  dimentions: {
    length: Number,
    width: Number,
    height: Number,
    weight: Number,
    unit: { type: String, default: 'cm' }
  },
  sizes: [String],
  colors: [String],
  badge: String,
  featured: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { strict: false }); // Added to prevent crashes if frontend sends unexpected fields

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connectDB(); // Safely connect using the new logic

    const targetId = req.query.id || req.query.productId || (req.body && (req.body.id || req.body.productId));

    // GET - Fetch products
    if (req.method === 'GET') {
      if (targetId) {
        // Get single product
        let product = null;
        if (mongoose.Types.ObjectId.isValid(targetId)) {
          product = await Product.findById(targetId);
        }
        if (!product) {
          product = await Product.findOne({ $or: [{ id: targetId }, { _id: targetId }] });
        }
        if (!product) {
          return res.status(404).json({ error: 'Product not found' });
        }
        return res.status(200).json(product);
      } else {
        // Get all products with filters
        const { category, ageGroup, brand, featured, availability, search } = req.query;
        let query = {};
        
        if (category) query.category = category;
        if (ageGroup) query.ageGroup = ageGroup;
        if (brand) query.brand = brand;
        if (featured) query.featured = featured === 'true';
        if (availability) query.availability = availability === 'true';
        if (search) {
          query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { brand: { $regex: search, $options: 'i' } }
          ];
        }
        
        const products = await Product.find(query).sort({ createdAt: -1 });
        return res.status(200).json(products);
      }
    }

    // POST - Create product
    if (req.method === 'POST') {
      const productData = req.body;
      
      // Ensure images is an array
      if (productData.images && !Array.isArray(productData.images)) {
        productData.images = [productData.images];
      }
      
      const product = new Product(productData);
      await product.save();
      
      console.log('Product created:', product._id);
      return res.status(201).json(product);
    }

    // PUT - Update product
    if (req.method === 'PUT') {
      if (!targetId) {
        return res.status(400).json({ error: 'Product ID required' });
      }
      
      const updates = req.body;
      
      // Ensure images is an array
      if (updates.images && !Array.isArray(updates.images)) {
        updates.images = [updates.images];
      }
      
      updates.updatedAt = new Date();
      
      let product = null;
      if (mongoose.Types.ObjectId.isValid(targetId)) {
        product = await Product.findByIdAndUpdate(targetId, updates, { new: true });
      }
      if (!product) {
        product = await Product.findOneAndUpdate({ $or: [{ id: targetId }, { _id: targetId }] }, updates, { new: true });
      }

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      console.log('Product updated:', product._id);
      return res.status(200).json(product);
    }

    // DELETE - Remove product
    if (req.method === 'DELETE') {
      if (!targetId) {
        return res.status(400).json({ error: 'Product ID required' });
      }
      
      let product = null;
      if (mongoose.Types.ObjectId.isValid(targetId)) {
        product = await Product.findByIdAndDelete(targetId);
      }
      if (!product) {
        product = await Product.findOneAndDelete({ $or: [{ id: targetId }, { _id: targetId }] });
      }

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      console.log('Product deleted:', targetId);
      return res.status(200).json({ message: 'Product deleted successfully', id: targetId });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
