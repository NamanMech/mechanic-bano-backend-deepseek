import { connectDB } from '../utils/connectDB.js';
import { ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// कॉन्फ़िगरेशन कॉन्स्टेंट्स
const COLLECTIONS = {
  YOUTUBE: 'youtube_videos',
  PDF: 'pdfs',
  LOGO: 'logo',
  SITE_NAME: 'site_name',
  PAGE_CONTROL: 'page_control'
};

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [];
const API_KEY = process.env.API_KEY;

// सुपाबेस क्लाइंट इनिशियलाइज़ेशन
const supabaseAdmin = (process.env.SUPABASE_PROJECT_URL && process.env.SUPABASE_SERVICE_KEY) ? 
  createClient(process.env.SUPABASE_PROJECT_URL, process.env.SUPABASE_SERVICE_KEY) : 
  null;

// सुरक्षित बॉडी पार्सिंग यूटिलिटी
export async function parseRequestBody(req) {
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
  
  const apiKey = authHeader.split(' ')[1];
  return apiKey === API_KEY;
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

// हेंडलर फंक्शन
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

  const { type, id } = req.query;
  const { db } = await connectDB();

  // वैलिडेशन
  if (!type) return res.status(400).json({ message: 'Type is required' });
  if (id && !ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid ID' });

  try {
    // ====================== यूट्यूब हैंडलिंग ======================
    if (type === 'youtube') {
      const collection = db.collection(COLLECTIONS.YOUTUBE);
      
      if (req.method === 'GET') {
        // पेजिनेशन जोड़ें
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;
        
        const videos = await collection.find()
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();
          
        const total = await collection.countDocuments();
        return res.status(200).json({ videos, total, page, totalPages: Math.ceil(total / limit) });
      }

      if (req.method === 'POST') {
        const body = await parseRequestBody(req);
        const { title, description, embedLink, originalLink, category } = body;
        
        // वैलिडेशन
        if (!title || !description || !embedLink || !originalLink || !category) {
          return res.status(400).json({ message: 'Missing required fields' });
        }
        
        const result = await collection.insertOne({ 
          title, 
          description, 
          embedLink, 
          originalLink, 
          category,
          createdAt: new Date()
        });
        
        return res.status(201).json({ message: 'YouTube video added', id: result.insertedId });
      }

      if (req.method === 'PUT' && id) {
        const body = await parseRequestBody(req);
        const { title, description, embedLink, originalLink, category } = body;
        
        const result = await collection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { 
            title, 
            description, 
            embedLink, 
            originalLink, 
            category,
            updatedAt: new Date()
          }}
        );
        
        if (result.matchedCount === 0) return res.status(404).json({ message: 'Not found' });
        return res.status(200).json({ message: 'Updated successfully' });
      }

      if (req.method === 'DELETE' && id) {
        const result = await collection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).json({ message: 'Not found' });
        return res.status(200).json({ message: 'Deleted successfully' });
      }
    }

    // ====================== PDF हैंडलिंग ======================
    if (type === 'pdf') {
      const collection = db.collection(COLLECTIONS.PDF);
      
      if (req.method === 'GET') {
        // पेजिनेशन जोड़ें
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;
        
        const pdfs = await collection.find()
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();
          
        const total = await collection.countDocuments();
        return res.status(200).json({ pdfs, total, page, totalPages: Math.ceil(total / limit) });
      }

      if (req.method === 'POST') {
        const body = await parseRequestBody(req);
        const { title, originalLink, category } = body;
        
        if (!title || !originalLink || !category) {
          return res.status(400).json({ message: 'Missing required fields' });
        }
        
        const result = await collection.insertOne({ 
          title, 
          originalLink, 
          category,
          createdAt: new Date()
        });
        
        return res.status(201).json({ message: 'PDF added', id: result.insertedId });
      }

      if (req.method === 'PUT' && id) {
        const body = await parseRequestBody(req);
        const { title, originalLink, category } = body;
        
        const result = await collection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { 
            title, 
            originalLink, 
            category,
            updatedAt: new Date()
          }}
        );
        
        if (result.matchedCount === 0) return res.status(404).json({ message: 'PDF not found' });
        return res.status(200).json({ message: 'PDF updated' });
      }

      if (req.method === 'DELETE' && id) {
        const pdfDoc = await collection.findOne({ _id: new ObjectId(id) });
        if (!pdfDoc) return res.status(404).json({ message: 'PDF not found' });

        // सुपाबेस से PDF डिलीट करें
        if (supabaseAdmin && pdfDoc.originalLink) {
          try {
            // सुरक्षित URL पार्सिंग
            const url = new URL(pdfDoc.originalLink);
            const pathParts = url.pathname.split('/');
            
            // सुपाबेस स्टोरेज पाथ फॉर्मेट: /storage/v1/object/public/[bucket]/[path]
            if (pathParts.length < 6 || pathParts[3] !== 'public') {
              throw new Error('Invalid Supabase URL format');
            }
            
            const bucketName = pathParts[4];
            const filePath = pathParts.slice(5).join('/');
            
            const { error } = await supabaseAdmin.storage
              .from(bucketName)
              .remove([filePath]);
            
            if (error) {
              console.error('Supabase deletion error:', error);
              // क्रिटिकल नहीं - डेटाबेस में रिकॉर्ड डिलीट करना जारी रखें
            }
          } catch (parseError) {
            console.error('URL parsing error:', parseError);
            // क्रिटिकल नहीं - डेटाबेस में रिकॉर्ड डिलीट करना जारी रखें
          }
        }

        // MongoDB से डिलीट करें
        const result = await collection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: 'Failed to delete from DB' });
        }

        return res.status(200).json({ message: 'PDF deleted successfully' });
      }
    }

    // ====================== लोगो हैंडलिंग ======================
    if (type === 'logo') {
      const collection = db.collection(COLLECTIONS.LOGO);
      
      if (req.method === 'GET') {
        const logo = await collection.findOne({});
        return res.status(200).json(logo || { url: '' });
      }

      if (req.method === 'PUT') {
        const body = await parseRequestBody(req);
        const { url } = body;
        if (!url) return res.status(400).json({ message: 'URL required' });
        
        await collection.updateOne(
          {}, 
          { $set: { url } }, 
          { upsert: true }
        );
        
        return res.status(200).json({ message: 'Logo updated' });
      }
    }

    // ====================== साइट नाम हैंडलिंग ======================
    if (type === 'sitename') {
      const collection = db.collection(COLLECTIONS.SITE_NAME);
      
      if (req.method === 'GET') {
        const siteName = await collection.findOne({});
        return res.status(200).json(siteName || { name: 'Mechanic Bano' });
      }

      if (req.method === 'PUT') {
        const body = await parseRequestBody(req);
        const { name } = body;
        if (!name) return res.status(400).json({ message: 'Name required' });
        
        await collection.updateOne(
          {}, 
          { $set: { name } }, 
          { upsert: true }
        );
        
        return res.status(200).json({ message: 'Site name updated' });
      }
    }

    // ====================== पेज कंट्रोल हैंडलिंग ======================
    if (type === 'pagecontrol') {
      const collection = db.collection(COLLECTIONS.PAGE_CONTROL);
      
      if (req.method === 'GET') {
        const pages = await collection.find().toArray();
        return res.status(200).json(pages);
      }

      if (req.method === 'PUT' && id) {
        const body = await parseRequestBody(req);
        const { enabled } = body;
        
        if (enabled === undefined) {
          return res.status(400).json({ message: 'Enabled status required' });
        }
        
        const result = await collection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { enabled } }
        );
        
        if (result.matchedCount === 0) return res.status(404).json({ message: 'Page not found' });
        return res.status(200).json({ message: 'Page updated' });
      }
    }

    return res.status(405).json({ message: 'Method Not Allowed' });
    
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
