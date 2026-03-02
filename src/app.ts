import express, { Application } from 'express';
import route from './routes/route';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
const app: Application = express();
app.use(
  cors({
    origin: [
      'http://localhost:5173', // Vite default
      'http://localhost:3000', // fallback
      'https://cashbook-frontend-wine.vercel.app',
      process.env.CLIENT_URL ?? '',
    ],
    credentials: true, // ✅ cookie/auth header এর জন্য
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json());
console.log('app.js');
app.get('/', (req, res) => {
  res.send('Hello World!');
});
app.use('/api', route);

// Routes
// app.use('/api/items', itemRoutes);

// Global error handler (should be after routes)
app.use(errorHandler);

export default app;