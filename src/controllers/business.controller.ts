import { Types } from 'mongoose';
import BusinessMembers, {
  BusinessMembersModel,
} from '../models/business-members.model';
import Business from '../models/business.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';

const createBusiness = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const business = await Business.create({
    ...req.body,
    owner: userId, // logged-in user is owner
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

const getMyBusinesses = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Find all memberships
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
const updateBusiness = asyncHandler(async (req, res, next) => {
  const businessId = new Types.ObjectId(req.params.id);
  const userId = req.user._id;

  // Only owner or admin can update
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

  const business = await BusinessMembersModel.findByIdAndUpdate(
    businessId,
    req.body,
    {
      new: true,
    },
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business updated successfully',
    data: business,
  });
});
const deleteBusiness = asyncHandler(async (req, res, next) => {
  const businessId = new Types.ObjectId(req.params.id);
  const userId = req.user._id;

  // Only owner can delete
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
