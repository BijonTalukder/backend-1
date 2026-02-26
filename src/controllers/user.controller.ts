import { Types } from 'mongoose';
import User from '../models/user.model';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import asyncHandler from '../utils/asyncHandler';
import { Request } from 'express';
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
export const userController = { setDefaultBusiness };
