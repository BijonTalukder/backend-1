// controllers/health.controller.ts
// Cheap connectivity probe for the offline-first client. `navigator.onLine`
// only proves the browser has a link — this proves the API itself answers, and
// reports whether it can currently accept writes.
import { Request, Response } from 'express';
import mongoose from 'mongoose';

const DB_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export const health = (_req: Request, res: Response) => {
  const readyState = mongoose.connection.readyState;
  const db = DB_STATES[readyState] ?? 'unknown';
  // Writes need the database; reads may still be served from the client cache,
  // so the client keys its "can I sync?" decision on `writable`.
  const writable = readyState === 1;

  res.status(200).json({
    statusCode: 200,
    success: true,
    message: 'API reachable',
    data: { status: 'ok', db, writable, time: new Date().toISOString() },
  });
};
