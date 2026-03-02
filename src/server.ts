import app from './app';
import config from './config/config';
import connectDB from './config/db';
import logger from './utils/Logger';

(async () => {
  try {
    console.log("before connect")
    await connectDB();
    console.log("after connect")
    const PORT = config.port || 5000;
    console.log(PORT, "post")
    app.listen(PORT, () => {
      logger.info(
        `🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`,
      );
    });
  } catch (err) {
    logger.error('DB connection failed:', err);
    process.exit(1);
  }
})();