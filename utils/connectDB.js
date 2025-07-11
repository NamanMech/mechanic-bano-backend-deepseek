import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error('Please define the MONGO_URI environment variable');
}

if (!uri.startsWith('mongodb')) {
  throw new Error('Invalid MONGO_URI format. Must start with mongodb');
}

let cached = global.mongo;

if (!cached) {
  cached = global.mongo = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const options = {
      maxPoolSize: 10,
      minPoolSize: 2,
      socketTimeoutMS: 30000,
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000,
    };

    cached.promise = MongoClient.connect(uri, options)
      .then((client) => {
        // इवेंट लिसनर्स जोड़ें
        client.on('error', (err) => {
          console.error('MongoDB runtime error:', err);
        });

        client.on('close', () => {
          console.log('MongoDB connection closed');
          cached.conn = null;
          cached.promise = null;
        });

        return {
          client,
          db: client.db('mechanic_bano'),
        };
      })
      .catch((err) => {
        console.error('MongoDB connection failed:', err);
        cached.promise = null;
        throw new Error('Database connection failed');
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}
