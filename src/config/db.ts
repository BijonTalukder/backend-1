// config/db.ts
import mongoose from 'mongoose';
import config from './config';
import logger from '../utils/Logger';

// Cache connection across serverless invocations
let cached = (global as any).mongoose || { conn: null, promise: null };
(global as any).mongoose = cached;

const connectDB = async () => {
  if (cached.conn) {
    return cached.conn; // ✅ reuse existing connection
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(config.mongoURI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      bufferCommands: false, // ✅ don't buffer if not connected
    });
  }

  try {
    cached.conn = await cached.promise;
    logger.info(`✅ MongoDB connected: ${cached.conn.connection.host}`);
    return cached.conn;
  } catch (error) {
    cached.promise = null; // reset on failure so next call retries
    logger.error(`MongoDB connection error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
};

export default connectDB;