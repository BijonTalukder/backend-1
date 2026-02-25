import express, { Application } from 'express';
import route from './routes/route';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
const app: Application = express();
app.use(cors())
app.use(express.json());

app.use('/api', route)

// Routes
// app.use('/api/items', itemRoutes);

// Global error handler (should be after routes)
app.use(errorHandler);

export default app;
