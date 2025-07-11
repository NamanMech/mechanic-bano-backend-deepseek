import { connectDB } from '../utils/connectDB.js';
import { ObjectId } from 'mongodb';

// कॉन्फ़िगरेशन कॉन्स्टेंट्स
const COLLECTIONS = {
  PLANS: 'subscription_plans',
  USERS: 'users'
};

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
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ईमेल वैलिडेशन
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// सब्सक्रिप्शन प्लान वैलिडेशन
function validatePlanData(plan) {
  const { title, price, days, discount } = plan;
  
  if (!title || !price || !days) {
    return 'Missing required fields';
  }
  
  if (typeof price !== 'number' || price <= 0) {
    return 'Price must be a positive number';
  }
  
  if (typeof days !== 'number' || days <= 0) {
    return 'Days must be a positive integer';
  }
  
  if (discount && (discount < 0 || discount > 100)) {
    return 'Discount must be between 0 and 100';
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

  // ऑथेंटिकेशन चेक (GET को छोड़कर)
  if (req.method !== 'GET' && !authenticate(req)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { id, type, email } = req.query;
  
  try {
    const { db } = await connectDB();
    const plansCollection = db.collection(COLLECTIONS.PLANS);
    const usersCollection = db.collection(COLLECTIONS.USERS);

    // =================== सब्सक्रिप्शन प्लान्स ===================
    if (!type) {
      // GET सभी प्लान्स (पेजिनेशन के साथ)
      if (req.method === 'GET') {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;
        
        const plans = await plansCollection.find()
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();
          
        const total = await plansCollection.countDocuments();
        return res.status(200).json({ 
          plans, 
          total, 
          page: parseInt(page), 
          totalPages: Math.ceil(total / limit) 
        });
      }

      // नया प्लान बनाएं या अपडेट करें
      if (req.method === 'POST' || req.method === 'PUT') {
        let planData;
        try {
          planData = await parseRequestBody(req);
        } catch (err) {
          return res.status(400).json({ message: 'Invalid request body' });
        }

        // डेटा वैलिडेशन
        const validationError = validatePlanData(planData);
        if (validationError) {
          return res.status(400).json({ message: validationError });
        }

        // नया प्लान बनाएं
        if (req.method === 'POST') {
          const result = await plansCollection.insertOne({
            ...planData,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          return res.status(201).json({ 
            message: 'Plan created successfully',
            id: result.insertedId
          });
        }

        // प्लान अपडेट करें
        if (req.method === 'PUT') {
          if (!id) return res.status(400).json({ message: 'Plan ID is required' });
          
          const updateResult = await plansCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { 
              ...planData,
              updatedAt: new Date()
            }}
          );

          if (updateResult.matchedCount === 0) {
            return res.status(404).json({ message: 'Plan not found' });
          }
          return res.status(200).json({ message: 'Plan updated successfully' });
        }
      }

      // प्लान डिलीट करें
      if (req.method === 'DELETE') {
        if (!id) return res.status(400).json({ message: 'Plan ID is required' });

        const deleteResult = await plansCollection.deleteOne({ 
          _id: new ObjectId(id) 
        });
        
        if (deleteResult.deletedCount === 0) {
          return res.status(404).json({ message: 'Plan not found' });
        }
        
        // संबंधित यूजर्स के सब्सक्रिप्शन अपडेट करें
        await usersCollection.updateMany(
          { 'subscription.planId': new ObjectId(id) },
          { $set: { 
            'subscription.status': 'cancelled',
            'subscription.cancelledAt': new Date()
          }}
        );
        
        return res.status(200).json({ message: 'Plan deleted successfully' });
      }
    }

    // =================== यूजर सब्सक्रिप्शन ===================
    if (type === 'check' && req.method === 'GET') {
      if (!email) return res.status(400).json({ message: 'Email is required' });
      
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }

      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).json({ message: 'User not found' });

      // सब्सक्रिप्शन स्टेटस चेक करें
      const isActive = user.subscription?.status === 'active' && 
                      user.subscription?.endDate > new Date();

      return res.status(200).json({ 
        isSubscribed: isActive,
        endDate: user.subscription?.endDate || null
      });
    }

    if (type === 'expire' && req.method === 'PUT') {
      if (!email) return res.status(400).json({ message: 'Email is required' });
      
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }

      const updateResult = await usersCollection.updateOne(
        { email },
        { $set: { 
          'subscription.status': 'expired',
          'subscription.endDate': new Date(),
          updatedAt: new Date()
        }}
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      return res.status(200).json({ message: 'Subscription expired successfully' });
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
    
  } catch (error) {
    console.error('Subscription API Error:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
