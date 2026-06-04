export default async function handler(req, res) {
  // CORS Headers so VS Code can talk to it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Pulls the key secretly from Vercel's Vault
    const imgbbKey = process.env.IMGBB_API_KEY;

    if (!imgbbKey) {
      return res.status(500).json({ error: 'IMGBB_API_KEY is not set in Vercel' });
    }

    // Hands it back to your app.js
    return res.status(200).json({ imgbbKey });
  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
