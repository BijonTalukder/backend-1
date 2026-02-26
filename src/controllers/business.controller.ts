import { Types } from 'mongoose';
import BusinessMembers, {
  BusinessMembersModel,
} from '../models/business-members.model';
import Business from '../models/business.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import { Request } from 'express';
import ApiError from '../Error/handleApiError';
import User from '../models/user.model';

const createBusiness = asyncHandler(async (req: Request, res, next) => {
  const userId = req.user?._id;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user id');
  }

  const objectUserId = new Types.ObjectId(String(userId));
  const { name, type, category } = req.body;

  const business = await Business.create({
    name,
    type,
    owner: objectUserId,
    category: category ?? null, // ✅ optional
    mealEnabled: type === 'mass', // ✅ auto set
  });

  await BusinessMembersModel.create({
    user: objectUserId,
    business: business._id,
    role: 'owner',
  });

  // ✅ defaultBusiness user এ set করো
  await User.findByIdAndUpdate(objectUserId, {
    defaultBusiness: business._id,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Business created successfully',
    data: business,
  });
});

const getMyBusinesses = asyncHandler(async (req: Request, res, next) => {
  const userId = req.user?._id;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user id');
  }

  const objectUserId = new Types.ObjectId(String(userId));

  const memberships = await BusinessMembersModel.find({ user: objectUserId })
    .populate('business', 'name category type owner status')
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'My businesses fetched successfully',
    data: memberships,
  });
});

const updateBusiness = asyncHandler(async (req: Request, res, next) => {
  const { id } = req.params;

  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid business id');
  }

  const businessId = new Types.ObjectId(id);

  const userId = req.user?._id;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user id');
  }

  const objectUserId = new Types.ObjectId(String(userId));

  const membership = await BusinessMembersModel.findOne({
    business: businessId,
    user: objectUserId,
    role: { $in: ['owner', 'admin'] },
  });

  if (!membership) {
    return sendResponse(res, {
      statusCode: 403,
      success: false,
      message: 'You are not allowed to update this business',
    });
  }

  const business = await Business.findByIdAndUpdate(businessId, req.body, {
    new: true,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business updated successfully',
    data: business,
  });
});

const deleteBusiness = asyncHandler(async (req: Request, res, next) => {
  const { id } = req.params;

  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid business id');
  }

  const businessId = new Types.ObjectId(id);

  const userId = req.user?._id;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user id');
  }

  const objectUserId = new Types.ObjectId(String(userId));

  const membership = await BusinessMembersModel.findOne({
    business: businessId,
    user: objectUserId,
    role: 'owner',
  });

  if (!membership) {
    return sendResponse(res, {
      statusCode: 403,
      success: false,
      message: 'Only owner can delete this business',
    });
  }

  await Business.findByIdAndUpdate(businessId, { status: false });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business deleted successfully',
  });
});

export const businessController = {
  createBusiness,
  getMyBusinesses,
  updateBusiness,
  deleteBusiness,
};
