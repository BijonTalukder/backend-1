// src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Types } from 'mongoose';
import ApiError from '../Error/handleApiError';
import asyncHandler from '../utils/asyncHandler';
import { IUserPayload } from '../types'; // ✅ import করো
import config from '../config/config';
export const auth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : req.cookies?.token;

    if (!token) {
      throw new ApiError(401, 'Unauthorized: No token provided');
    }

    const secret = config.jwtSecret;
    if (!secret) {
      throw new ApiError(500, 'JWT secret is not configured');
    }

    const decoded = jwt.verify(token, secret) as JwtPayload & IUserPayload;
    console.log(decoded);

    if (!decoded.id) {
      throw new ApiError(401, 'Unauthorized: Invalid token payload');
    }

    req.user = {
      // ✅ এখন error আসবে না
      _id: decoded.id.toString(),
      id: decoded.id ?? String(decoded._id),
      email: decoded.email,
      role: decoded.role,
    };

    next();
  },
);

export const authorizeRoles = (...roles: IUserPayload['role'][]) => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
      if (!req.user) {
        throw new ApiError(401, 'Unauthorized: Not logged in');
      }
      if (!roles.includes(req.user.role)) {
        throw new ApiError(
          403,
          `Forbidden: Role '${req.user.role}' is not allowed`,
        );
      }
      next();
    },
  );
};
