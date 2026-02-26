import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // ✅ MongoDB duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0];
    const fieldMap: Record<string, string> = {
      email: 'This email is already registered',
      phone: 'This phone number is already in use',
    };
    return res.status(400).json({
      success: false,
      message: fieldMap[field] ?? `${field} already exists`,
    });
  }

  // ✅ Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map((e: any) => e.message)
      .join(', ');
    return res.status(400).json({ success: false, message });
  }

  // ✅ JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  // ✅ Custom ApiError
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // ✅ Fallback
  console.error('Unhandled error:', err);
  return res.status(500).json({
    success: false,
    message: err.message ?? 'Internal server error',
  });
};
