module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-File-Name, X-File-Size, X-File-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { endpoint } = req.query;
  const SHOP_URL = process.env.SHOPIFY_STORE_URL || 'dosantimed.myshopify.com';
  const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!TOKEN) {
    return res.status(500).json({ error: 'Missing SHOPIFY_ACCESS_TOKEN' });
  }

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  try {
    const url = `https://${SHOP_URL}/admin/api/2024-10/${endpoint}.json`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Shopify API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch from Shopify', 
      message: error.message 
    });
  }
};
