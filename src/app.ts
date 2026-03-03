import express, { Application, Request, Response, NextFunction } from 'express';
import route from './routes/route';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
import cookieParser from 'cookie-parser';
import connectDB from './config/db';

const app: Application = express();

app.use(cookieParser());
app.use(
  cors({
    origin: 'https://cashbook-frontend-wine.vercel.app',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ✅ Connect DB before every request (cached — only connects once)
app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await connectDB();
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
