import app from './app';
import config from './config/config';
import connectDB from './config/db';
import logger from './utils/Logger';
import { seedDefaultCategories } from './utils/seedCategories';

(async () => {
  try {
    await connectDB();
    // await seedDefaultCategories(); // optional
    const PORT = config.port || 5000;
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
// seedDefaultCategories();
const PORT = config.port || 5000;
app.listen(PORT, () => {
  logger.info(
    `🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`,
  );
});
