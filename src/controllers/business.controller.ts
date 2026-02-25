import { Types } from 'mongoose';
import BusinessMembers, {
  BusinessMembersModel,
} from '../models/business-members.model';
import Business from '../models/business.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import { Request } from 'express';
import ApiError from '../Error/handleApiError';
// import { Request } from '../types';

const createBusiness = asyncHandler(async (req: Request, res, next) => {  // ✅ Change req type
  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid id")

  }
  const business = await Business.create({
    ...req.body,
    owner: userId,
  });
  await BusinessMembersModel.create({
    user: userId,
    business: business._id,
    role: 'owner',
  });
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Business created successfully',
    data: business,
  });
});

const getMyBusinesses = asyncHandler(async (req: Request, res, next) => {  // ✅ Change req type
  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid id")

  }
  const memberships = await BusinessMembersModel.find({ user: userId })
    .populate('business', 'name category type owner status')
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'My businesses fetched successfully',
    data: memberships,
  });
});

const updateBusiness = asyncHandler(async (req: Request, res, next) => {  // ✅ Change req type
  const businessId = new Types.ObjectId(req.params.id);
  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid id")

  }
  const membership = await BusinessMembersModel.findOne({
    business: businessId,
    user: userId,
    role: { $in: ['owner', 'admin'] },
  });
  if (!membership) {
    return sendResponse(res, {
      statusCode: 403,
      success: false,
      message: 'You are not allowed to update this business',
    });
  }

  const business = await Business.findByIdAndUpdate(
    businessId,
    req.body,
    { new: true }
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business updated successfully',
    data: business,
  });
});

const deleteBusiness = asyncHandler(async (req: Request, res, next) => {  // ✅ Change req type
  const businessId = new Types.ObjectId(req.params.id);
  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid id")

  }
  const membership = await BusinessMembersModel.findOne({
    business: businessId,
    user: userId,
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