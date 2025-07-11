import { connectDB } from '../utils/connectDB.js';

// कॉन्फ़िगरेशन कॉन्स्टेंट्स
const COLLECTION_NAME = 'welcome_note';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [];
const API_KEY = process.env.API_KEY;

// सुरक्षित बॉडी पार्सिंग यूटिलिटी
async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
  });
}

// ऑथेंटिकेशन मिडलवेयर
function authenticate(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  return authHeader.split(' ')[1] === API_KEY;
}

// CORS कॉन्फिगरेशन
function configureCors(req, res) {
  const origin = req.headers.origin;
  
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// डेटा वैलिडेशन
function validateWelcomeData(data) {
  if (!data.title || typeof data.title !== 'string' || data.title.trim() === '') {
    return 'Title is required and must be a non-empty string';
  }
  
  if (!data.message || typeof data.message !== 'string' || data.message.trim() === '') {
    return 'Message is required and must be a non-empty string';
  }
  
  return null;
}

export default async function handler(req, res) {
  // CORS कॉन्फिगरेशन
  configureCors(req, res);
  
  // Preflight रिक्वेस्ट हैंडलिंग
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { db } = await connectDB();
    const collection = db.collection(COLLECTION_NAME);

    // ✅ GET: वेलकम नोट फ़ेच करना
    if (req.method === 'GET') {
      const note = await collection.findOne({});
      
      // डिफ़ॉल्ट मान यदि कोई डेटा नहीं है
      const defaultNote = { 
        title: 'Welcome to Mechanic Bano', 
        message: 'Your one-stop solution for all mechanical needs' 
      };
      
      return res.status(200).json(note || defaultNote);
    }

    // ✅ POST/PUT: वेलकम नोट अपडेट करना
    if (req.method === 'POST' || req.method === 'PUT') {
      // ऑथेंटिकेशन चेक
      if (!authenticate(req)) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      let body;
      try {
        body = await parseRequestBody(req);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid request body' });
      }

      // डेटा वैलिडेशन
      const validationError = validateWelcomeData(body);
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      const { title, message } = body;
      
      // अपडेट ऑपरेशन (UPSERT)
      const updateResult = await collection.updateOne(
        {},
        { $set: { title, message } },
        { upsert: true }
      );
      
      // सफलता रिस्पांस
      return res.status(200).json({ 
        message: 'Welcome note updated successfully',
        updated: updateResult.upsertedId ? 'created' : 'modified'
      });
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
    
  } catch (error) {
    console.error('Welcome API Error:', error);
    
    // सुरक्षित एरर मैसेज
    const errorMessage = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message;
      
    return res.status(500).json({ message: errorMessage });
  }
}
