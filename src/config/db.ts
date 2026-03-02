import logger from '../utils/Logger';
import mongoose from 'mongoose';
import config from './config';
const connectDB = async () => {
  const uri = config.mongoURI;
  console.log("MONGO_URI:", process.env.MONGO_URI, uri);

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
      console.log('MongoDB disconnected. Attempting to reconnect...')
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log("mongofb connect")
      logger.info('MongoDB reconnected.');
    });
  } catch (error) {
    console.log(`MongoDB connection error: ${error instanceof Error ? error.message : error}`,)
    logger.error(
      `MongoDB connection error: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }
};
export default connectDB;
