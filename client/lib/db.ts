import mongoose from 'mongoose';

// Ensure all Mongoose models are registered to avoid MissingSchemaError
import '../models/User';
import '../models/Restaurant';
import '../models/Table';
import '../models/MenuItem';
import '../models/Order';
import '../models/KitchenDepartment';
import '../models/KitchenStock';
import '../models/KitchenStockLot';

// Apply DNS fix only on local development (macOS c-ares resolver issue)
if (typeof process !== 'undefined' && process.platform === 'darwin') {
  try {
    // Dynamic import to avoid bundling dns in Edge/serverless
    const dns = require('dns');
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch (e) {
    // ignore — dns module may not be available in all runtimes
  }
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required to connect to MongoDB');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxIdleTimeMS: 10000,
    };

    cached.promise = mongoose.connect(mongoUri, opts).then((mongoose) => {
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default dbConnect;
