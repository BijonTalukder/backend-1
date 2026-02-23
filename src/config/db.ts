import logger from '../utils/Logger';
import mongoose from 'mongoose';
const connectDB = async () => {
  const uri =
    process.env.NODE_ENV === 'test'
      ? process.env.MONGO_URI_TEST
      : process.env.MONGO_URI;
  if (!uri) {
    logger.error('MONGO_URI is not defined in environment variables.');
    process.exit(1);
  }
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected.');
    });
  } catch (error) {
    logger.error(
      `MongoDB connection error: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
};
export default connectDB;
