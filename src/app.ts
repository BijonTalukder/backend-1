import express, { Application } from 'express';
import route from './routes/route';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
import cookieParser from "cookie-parser"

const app: Application = express();

app.use(cookieParser())
app.use(
  cors({
    origin: [
      "https://cashbook-frontend-wine.vercel.app"
    ],
    // credentials: true, // ✅ cookie/auth header এর জন্য
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.get('/', (req, res) => {
  res.send('Hello World!');
});
app.use('/api', route);

// Routes
// app.use('/api/items', itemRoutes);

// Global error handler (should be after routes)
// app.use(errorHandler);

export default app;