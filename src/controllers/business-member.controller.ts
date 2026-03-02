import { Request } from 'express';
import { Types } from 'mongoose';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { BusinessMembersModel } from '../models/business-members.model';

/* ─── Populated user type ─────────────────────────────── */
interface IPopulatedUser {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  avatar?: string;
}

/* ─── Get members ─────────────────────────────────────── */
const getMembers = asyncHandler(async (req: Request, res, next) => {
  const { businessId } = req.params;

  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(400, 'Invalid user id');

  const objectBusinessId = new Types.ObjectId(businessId);
  const objectUserId = new Types.ObjectId(String(userId));

  // ✅ status: true (boolean), not 'active' (string)
  const requester = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectUserId,
    status: true,
  });
  if (!requester) throw new ApiError(403, 'Access denied');

  // ✅ .populate<{ user: IPopulatedUser }>() — typed populate, no cast needed
  const members = await BusinessMembersModel.find({
    business: objectBusinessId,
    status: true,
  })
    .populate<{ user: IPopulatedUser }>(
      'user',
      'firstName lastName email avatar',
    )
    .lean();

  const data = members.map((m) => ({
    _id: m.user._id, // ✅ no cast — already typed
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    email: m.user.email,
    avatar: m.user.avatar,
    role: m.role,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Members fetched',
    data,
  });
});

/* ─── Invite member ───────────────────────────────────── */
const inviteMember = asyncHandler(async (req: Request, res, next) => {
  const { businessId } = req.params;
  const { email, role = 'member' } = req.body;

  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(400, 'Invalid user id');

  const objectBusinessId = new Types.ObjectId(businessId);
  const objectUserId = new Types.ObjectId(String(userId));

  const requester = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectUserId,
    role: { $in: ['owner', 'admin'] },
    status: true, // ✅
  });
  if (!requester)
    throw new ApiError(403, 'Only owner or admin can invite members');

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitation sent',
    data: null,
  });
});

/* ─── Remove member ───────────────────────────────────── */
const removeMember = asyncHandler(async (req: Request, res, next) => {
  const { businessId, memberId } = req.params;

  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');
  if (!memberId || Array.isArray(memberId) || !Types.ObjectId.isValid(memberId))
    throw new ApiError(400, 'Invalid member id');

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(400, 'Invalid user id');

  const objectBusinessId = new Types.ObjectId(businessId);
  const objectUserId = new Types.ObjectId(String(userId));
  const objectMemberId = new Types.ObjectId(memberId);

  const requester = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectUserId,
    role: { $in: ['owner', 'admin'] },
    status: true, // ✅
  });
  if (!requester)
    throw new ApiError(403, 'Only owner or admin can remove members');

  const target = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectMemberId,
  });
  if (!target) throw new ApiError(404, 'Member not found');
  if (target.role === 'owner')
    throw new ApiError(400, 'Cannot remove the owner');

  // ✅ soft delete — status: false (boolean)
  await BusinessMembersModel.findByIdAndUpdate(target._id, { status: false });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Member removed',
  });
});

/* ─── Update member role ──────────────────────────────── */
const updateMemberRole = asyncHandler(async (req: Request, res, next) => {
  const { businessId, memberId } = req.params;
  const { role } = req.body;

  if (!['admin', 'member'].includes(role))
    throw new ApiError(400, 'Role must be admin or member');

  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');
  if (!memberId || Array.isArray(memberId) || !Types.ObjectId.isValid(memberId))
    throw new ApiError(400, 'Invalid member id');

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(400, 'Invalid user id');

  const objectBusinessId = new Types.ObjectId(businessId);
  const objectUserId = new Types.ObjectId(String(userId));
  const objectMemberId = new Types.ObjectId(memberId);

  const requester = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectUserId,
    role: { $in: ['owner', 'admin'] },
    status: true, // ✅
  });
  if (!requester)
    throw new ApiError(403, 'Only owner or admin can update roles');

  const target = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectMemberId,
  });
  if (!target) throw new ApiError(404, 'Member not found');
  if (target.role === 'owner')
    throw new ApiError(400, 'Cannot change owner role');

  await BusinessMembersModel.findByIdAndUpdate(target._id, { role });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Role updated',
  });
});

export const businessMembersController = {
  getMembers,
  inviteMember,
  removeMember,
  updateMemberRole,
};
