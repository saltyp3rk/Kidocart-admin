// Vercel Serverless Function - Products API
const mongoose = require('mongoose');

// MongoDB connection
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }
  
  const client = await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  
  cachedDb = client;
  return cachedDb;
}

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
    date: {type: Date, default: Date.now }
  }],
  dimentions: {
    length: Number,
    width: Number,
    height: Number,
    weight: Number,
    unit: {type: String, default: 'cm'}
  },
  sizes: [String],
  colors: [String],
  badge: String,
  featured: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

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
    await connectToDatabase();

    const { id } = req.query;

    // GET - Fetch products
    if (req.method === 'GET') {
      if (id) {
        // Get single product
        const product = await Product.findById(id);
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
      if (!id) {
        return res.status(400).json({ error: 'Product ID required' });
      }
      
      const updates = req.body;
      
      // Ensure images is an array
      if (updates.images && !Array.isArray(updates.images)) {
        updates.images = [updates.images];
      }
      
      updates.updatedAt = new Date();
      
      const product = await Product.findByIdAndUpdate(id, updates, { new: true });
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      console.log('Product updated:', product._id);
      return res.status(200).json(product);
    }

    // DELETE - Remove product
    if (req.method === 'DELETE') {
      if (!id) {
        return res.status(400).json({ error: 'Product ID required' });
      }
      
      const product = await Product.findByIdAndDelete(id);
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      console.log('Product deleted:', id);
      return res.status(200).json({ message: 'Product deleted successfully' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
