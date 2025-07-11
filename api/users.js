import { connectDB } from '../utils/connectDB.js';
import { ObjectId } from 'mongodb';

// कॉन्फ़िगरेशन कॉन्स्टेंट्स
const COLLECTIONS = {
  USERS: 'users',
  PLANS: 'subscription_plans'
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

// सब्सक्रिप्शन डेटा वैलिडेशन
function validateSubscriptionData(data) {
  if (!data.planId) return 'Plan ID is required';
  if (!ObjectId.isValid(data.planId)) return 'Invalid Plan ID format';
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

  const { email, type } = req.query;

  try {
    const { db } = await connectDB();
    const usersCollection = db.collection(COLLECTIONS.USERS);
    const plansCollection = db.collection(COLLECTIONS.PLANS);

    // ✅ यूजर बनाना या फ़ेच करना (Google लॉगिन)
    if (req.method === 'POST') {
      let userData;
      try {
        userData = await parseRequestBody(req);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid request body' });
      }

      // डेटा वैलिडेशन
      if (!userData.email || !userData.name) {
        return res.status(400).json({ message: 'Email and Name are required.' });
      }

      if (!isValidEmail(userData.email)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }

      // मौजूदा यूजर चेक करें
      const existingUser = await usersCollection.findOne({ email: userData.email });

      if (existingUser) {
        // केवल आवश्यक फ़ील्ड्स वापस करें
        const { name, email, picture, subscription } = existingUser;
        return res.status(200).json({ name, email, picture, subscription });
      }

      // नया यूजर बनाएँ
      const newUser = {
        email: userData.email,
        name: userData.name,
        picture: userData.picture || '',
        subscription: {
          status: 'inactive',
          startDate: null,
          endDate: null,
          planId: null
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await usersCollection.insertOne(newUser);
      
      // सेंसिटिव डेटा हटाकर रिस्पांस दें
      const { _id, ...userResponse } = newUser;
      return res.status(201).json({ 
        message: 'User created successfully',
        user: userResponse
      });
    }

    // ✅ सभी यूजर्स को पेजिनेशन के साथ फ़ेच करना
    if (req.method === 'GET') {
      // सिर्फ ऑथेंटिकेटेड यूजर्स को अनुमति
      if (!authenticate(req)) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const { page = 1, limit = 20, search } = req.query;
      const skip = (page - 1) * limit;
      
      // सर्च फ़िल्टर
      const filter = {};
      if (search) {
        filter.$or = [
          { email: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } }
        ];
      }
      
      // सेंसिटिव फ़ील्ड्स छोड़ें
      const projection = { 
        password: 0, 
        tokens: 0,
        'subscription.planId': 0 
      };
      
      const users = await usersCollection.find(filter, { projection })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();
        
      const total = await usersCollection.countDocuments(filter);
      
      return res.status(200).json({ 
        users, 
        total, 
        page: parseInt(page), 
        totalPages: Math.ceil(total / limit) 
      });
    }

    // ईमेल पैरामीटर वैलिडेशन
    if (!email) {
      return res.status(400).json({ message: 'Email parameter is required' });
    }
    
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // ✅ यूजर डिलीट करना
    if (req.method === 'DELETE') {
      // सिर्फ ऑथेंटिकेटेड यूजर्स को अनुमति
      if (!authenticate(req)) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const deleteResult = await usersCollection.deleteOne({ email });

      if (deleteResult.deletedCount === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.status(200).json({ message: 'User deleted successfully' });
    }

    // ✅ यूजर अपडेट या सब्सक्राइब करना
    if (req.method === 'PUT') {
      let updateData;
      try {
        updateData = await parseRequestBody(req);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid request body' });
      }

      // 🔹 यूजर प्रोफाइल अपडेट
      if (type === 'update') {
        const { name, picture } = updateData;

        if (!name) {
          return res.status(400).json({ message: 'Name is required for update' });
        }

        const updateResult = await usersCollection.updateOne(
          { email },
          { 
            $set: { 
              name, 
              picture: picture || '',
              updatedAt: new Date()
            } 
          }
        );

        if (updateResult.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({ message: 'User profile updated successfully' });
      }

      // 🔹 सब्सक्रिप्शन एक्टिवेट करना
      // वैलिडेशन एरर चेक
      const validationError = validateSubscriptionData(updateData);
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      const { planId } = updateData;
      
      // प्लान डिटेल्स फ़ेच करें
      const selectedPlan = await plansCollection.findOne({ 
        _id: new ObjectId(planId) 
      });

      if (!selectedPlan) {
        return res.status(404).json({ message: 'Subscription plan not found' });
      }

      // सब्सक्रिप्शन अवधि कैलकुलेट करें
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(startDate.getDate() + selectedPlan.days);

      const updateResult = await usersCollection.updateOne(
        { email },
        {
          $set: {
            'subscription.status': 'active',
            'subscription.startDate': startDate,
            'subscription.endDate': endDate,
            'subscription.planId': selectedPlan._id,
            'subscription.planDetails': {
              title: selectedPlan.title,
              price: selectedPlan.price,
              days: selectedPlan.days,
              discount: selectedPlan.discount || 0
            },
            updatedAt: new Date()
          }
        }
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      return res.status(200).json({ 
        message: 'Subscription activated successfully',
        endDate: endDate.toISOString()
      });
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
    
  } catch (error) {
    console.error('Users API Error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
