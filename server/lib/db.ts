import mongoose from 'mongoose';
import dns from 'dns';

// Ensure all Mongoose models are registered to avoid MissingSchemaError
import '../models/User';
import '../models/Restaurant';
import '../models/Table';
import '../models/MenuItem';
import '../models/Order';
import '../models/InventoryItem';
import '../models/StockMovement';
import '../models/KitchenDepartment';
import '../models/KitchenStock';
import '../models/KitchenStockLot';

// Apply DNS fix at module load time (covers Express process)
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // ignore
}

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
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
  // Apply DNS fix inside the function too — this ensures it runs in any
  // Turbopack/Next.js worker thread that calls this function, since
  // dns.setServers() at module-load time only affects the thread that
  // loaded the module.
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch (e) {
    // ignore — don't block connection attempt
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxIdleTimeMS: 10000,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
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
