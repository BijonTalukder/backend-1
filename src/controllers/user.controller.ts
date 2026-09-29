import { Types } from 'mongoose';
import User, { FCM_PLATFORMS, type FcmPlatform } from '../models/user.model';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import asyncHandler from '../utils/asyncHandler';
import { Request } from 'express';

const MAX_FCM_TOKEN_LENGTH = 4096;

const setDefaultBusiness = asyncHandler(async (req: Request, res, next) => {
  const userId = req.user?._id;
  const { businessId } = req.body;

  if (!businessId || !Types.ObjectId.isValid(businessId)) {
    throw new ApiError(400, 'Invalid business id');
  }

  await User.findByIdAndUpdate(new Types.ObjectId(String(userId)), {
    defaultBusiness: new Types.ObjectId(businessId),
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Default business updated',
  });
});

/**
 * POST /users/fcm-token
 *
 * Body: { token: string, platform: FcmPlatform }
 * Auth: required — the user identity comes from the JWT, not the body.
 *
 * A device token is unique per app installation, not per user, so when a
 * second account logs into the same Android device we transfer ownership of
 * the token rather than refuse the request.
 */
const registerFcmToken = asyncHandler(async (req: Request, res, next) => {
  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(401, 'Unauthorized');
  }
  const meId = new Types.ObjectId(String(userId));

  const rawToken = req.body?.token;
  const platform = (req.body?.platform ?? 'android').toString();

  if (typeof rawToken !== 'string') {
    throw new ApiError(400, 'FCM token must be a string');
  }
  const token = rawToken.trim();

  if (!token) {
    throw new ApiError(400, 'FCM token is required');
  }
  if (!FCM_PLATFORMS.includes(platform as FcmPlatform)) {
    throw new ApiError(
      400,
      `Unsupported platform (only ${FCM_PLATFORMS.join(', ')} accepted)`,
    );
  }
  if (token.length > MAX_FCM_TOKEN_LENGTH) {
    throw new ApiError(400, 'FCM token is too long');
  }

  // Try to bump lastUsedAt on an existing entry. If the array filter matches,
  // we're done. If not, fall through to the ownership-transfer + insert path.
  const bumped = await User.updateOne(
    { _id: meId, 'fcmTokens.token': token },
    { $set: { 'fcmTokens.$.lastUsedAt': new Date() } },
  );

  if (bumped.modifiedCount === 1) {
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'FCM token already registered',
    });
    return;
  }

  // Detach from any prior owner and attach to the current user in parallel —
  // the two writes don't depend on each other.
  await Promise.all([
    User.updateMany(
      { 'fcmTokens.token': token, _id: { $ne: meId } },
      { $pull: { fcmTokens: { token } } },
    ),
    User.updateOne(
      { _id: meId, 'fcmTokens.token': { $ne: token } },
      {
        $push: {
          fcmTokens: {
            token,
            platform,
            createdAt: new Date(),
            lastUsedAt: new Date(),
          },
        },
      },
    ),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'FCM token registered successfully',
  });
});

export const userController = { setDefaultBusiness, registerFcmToken };
