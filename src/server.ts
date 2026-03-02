import app from './app';
import config from './config/config';
import connectDB from './config/db';
import logger from './utils/Logger';

const startServer = async () => {
  try {
    await connectDB();   // ✅ wait until DB connects

    const PORT = config.port || 5000;

    app.listen(PORT, () => {
      logger.info(
        `🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`,
      );
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();