// src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Types } from 'mongoose';
import ApiError from '../Error/handleApiError';
import asyncHandler from '../utils/asyncHandler';
import { IUserPayload } from '../types';
import config from '../config/config';
import {
  ADMIN_PANEL_SERVICE_IDENTITY,
  ADMIN_PANEL_SERVICE_KEY,
  ADMIN_PANEL_SERVICE_KEY_HEADER,
} from '../config/serviceKey';

// Computed once — avoids re-allocating on every service-hop request.
const SERVICE_OBJECT_ID = new Types.ObjectId(ADMIN_PANEL_SERVICE_IDENTITY.id);

export const auth = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const serviceKey = req.headers[ADMIN_PANEL_SERVICE_KEY_HEADER];
    if (serviceKey === ADMIN_PANEL_SERVICE_KEY) {
      req.user = {
        _id: SERVICE_OBJECT_ID,
        id: ADMIN_PANEL_SERVICE_IDENTITY.id,
        email: ADMIN_PANEL_SERVICE_IDENTITY.email,
        role: ADMIN_PANEL_SERVICE_IDENTITY.role,
      };
      return next();
    }

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

    if (!decoded.id) {
      throw new ApiError(401, 'Unauthorized: Invalid token payload');
    }

    req.user = {
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
