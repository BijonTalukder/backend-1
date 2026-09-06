import express, { Application, Request, Response, NextFunction } from 'express';
import route from './routes/route';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
import cookieParser from 'cookie-parser';
import connectDB from './config/db';
import { health } from './controllers/health.controller';
import {
  seedDefaultCategories,
  seedMessCategories,
} from './utils/seedCategories';

const app: Application = express();

app.use(cookieParser());
app.use(
  cors({
    origin: [
      'https://cashbook-frontend-wine.vercel.app',
      'http://localhost:5173',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
seedDefaultCategories();

// ✅ /api/health must answer instantly. It only reads `mongoose.connection.readyState`
// and must NOT sit behind the DB-connect middleware, which on a cold serverless
// lambda blocks until MongoDB connects (up to the selection timeout). The offline
// probe therefore sees 200 (API reachable) the moment the API answers, while the
// `writable` field still tells it whether the DB is warm enough to accept syncs.
app.get('/api/health', health);

// ✅ Connect DB before every request (cached — only connects once)
app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await connectDB();
    // await seedDefaultCategories()
    // await seedMessCategories()
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/', (_req, res) => {
  res.send('Hello World!');
});

app.use('/api', route);

app.use(errorHandler);

export default app;
