// api/config.js
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetches the key securely from Vercel's Environment Variables
    const imgbbKey = process.env.IMGBB_API_KEY;

    if (!imgbbKey) {
      return res.status(500).json({ error: 'IMGBB_API_KEY is not set in Vercel Environment Variables' });
    }

    return res.status(200).json({ imgbbKey });
  } catch (error) {
    console.error('Config API Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
