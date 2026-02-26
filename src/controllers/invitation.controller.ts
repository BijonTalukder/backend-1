// controllers/invitation.controller.ts
import crypto from 'crypto';
import { Request } from 'express';
import { Types } from 'mongoose';
import Invitation from '../models/invitation.model';
import Business from '../models/business.model';
import { BusinessMembersModel } from '../models/business-members.model';
import User from '../models/user.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import sendEmail from '../utils/sendEmail'; // নিচে দেওয়া আছে

// ─────────────────────────────────────────────
// POST /invitations  → invite পাঠাও
// ─────────────────────────────────────────────
const sendInvitation = asyncHandler(async (req: Request, res, next) => {
  const invitedById = req.user?._id;

  if (!invitedById || !Types.ObjectId.isValid(String(invitedById))) {
    throw new ApiError(400, 'Invalid user id');
  }

  const { businessId, email, role = 'member' } = req.body;

  if (!businessId || !Types.ObjectId.isValid(businessId)) {
    throw new ApiError(400, 'Invalid business id');
  }
  if (!email) {
    throw new ApiError(400, 'Email is required');
  }

  const objectBusinessId = new Types.ObjectId(businessId);
  const objectInvitedById = new Types.ObjectId(String(invitedById));

  // ✅ sender কি owner/admin?
  const senderMembership = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectInvitedById,
    role: { $in: ['owner', 'admin'] },
  });

  if (!senderMembership) {
    throw new ApiError(403, 'Only owner or admin can send invitations');
  }

  // ✅ already member?
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    const alreadyMember = await BusinessMembersModel.findOne({
      business: objectBusinessId,
      user: existingUser._id,
    });
    if (alreadyMember) {
      throw new ApiError(400, 'User is already a member of this business');
    }
  }

  // ✅ pending invitation already আছে?
  const existingInvite = await Invitation.findOne({
    business: objectBusinessId,
    email,
    status: 'pending',
  });
  if (existingInvite) {
    throw new ApiError(400, 'Invitation already sent to this email');
  }

  // ✅ unique token generate
  const token = crypto.randomBytes(32).toString('hex');

  const invitation = await Invitation.create({
    business: objectBusinessId,
    invitedBy: objectInvitedById,
    email,
    role,
    token,
  });

  const business = await Business.findById(objectBusinessId).lean();

  // ✅ email পাঠাও
  const acceptUrl = `${process.env.CLIENT_URL}/invitation/accept?token=${token}`;
  // account না থাকলে frontend redirect করবে register page এ, token সাথে রাখবে
  // account থাকলে সরাসরি accept করবে

  await sendEmail({
    to: email,
    subject: `You're invited to join ${business?.name}`,
    html: `
      <h2>You have been invited!</h2>
      <p>You've been invited to join <strong>${business?.name}</strong> as <strong>${role}</strong>.</p>
      <p>Click the button below to accept:</p>
      <a href="${acceptUrl}" style="
        background:#4F46E5;
        color:white;
        padding:12px 24px;
        border-radius:6px;
        text-decoration:none;
        display:inline-block;
        margin-top:12px;
      ">Accept Invitation</a>
      <p style="margin-top:16px;color:#888;">This invitation expires in 7 days.</p>
    `,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Invitation sent successfully',
    data: invitation,
  });
});

// ─────────────────────────────────────────────
// GET /invitations/check/:token
// Frontend এ গেলে প্রথমে এটা call করবে
// response দেখে — account আছে কিনা বুঝবে
// ─────────────────────────────────────────────
const checkInvitation = asyncHandler(async (req: Request, res, next) => {
  const { token } = req.params;

  const invitation = await Invitation.findOne({ token })
    .populate('business', 'name type')
    .populate('invitedBy', 'firstName lastName email')
    .lean();

  if (!invitation) {
    throw new ApiError(404, 'Invitation not found');
  }

  if (invitation.status !== 'pending') {
    throw new ApiError(400, `Invitation is already ${invitation.status}`);
  }

  if (new Date() > invitation.expiresAt) {
    await Invitation.findOneAndUpdate({ token }, { status: 'expired' });
    throw new ApiError(400, 'Invitation has expired');
  }

  // ✅ invited email এর account আছে কিনা check
  const userExists = await User.findOne({ email: invitation.email }).lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitation found',
    data: {
      invitation,
      userExists: !!userExists, // ✅ frontend এটা দেখে redirect করবে
    },
  });
});

// ─────────────────────────────────────────────
// POST /invitations/accept/:token  → logged in user accept করবে
// ─────────────────────────────────────────────
const acceptInvitation = asyncHandler(async (req: Request, res, next) => {
  const { token } = req.params;
  const userId = req.user?._id;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(401, 'Please login to accept invitation');
  }

  const invitation = await Invitation.findOne({ token });

  if (!invitation) {
    throw new ApiError(404, 'Invitation not found');
  }

  if (invitation.status !== 'pending') {
    throw new ApiError(400, `Invitation is already ${invitation.status}`);
  }

  if (new Date() > invitation.expiresAt) {
    invitation.status = 'expired';
    await invitation.save();
    throw new ApiError(400, 'Invitation has expired');
  }

  // ✅ logged in user এর email আর invited email match করতে হবে
  const user = await User.findById(userId).lean();
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.email !== invitation.email) {
    throw new ApiError(403, `This invitation was sent to ${invitation.email}`);
  }

  // ✅ already member?
  const alreadyMember = await BusinessMembersModel.findOne({
    business: invitation.business,
    user: userId,
  });

  if (alreadyMember) {
    throw new ApiError(400, 'You are already a member of this business');
  }

  // ✅ member add করো
  await BusinessMembersModel.create({
    business: invitation.business,
    user: new Types.ObjectId(String(userId)),
    role: invitation.role,
    // status: 'active',
  });

  // ✅ invitation status update
  invitation.status = 'accepted';
  await invitation.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitation accepted successfully',
    data: { businessId: invitation.business },
  });
});

// ─────────────────────────────────────────────
// POST /invitations/reject/:token
// ─────────────────────────────────────────────
const rejectInvitation = asyncHandler(async (req: Request, res, next) => {
  const { token } = req.params;

  const invitation = await Invitation.findOne({ token });

  if (!invitation) {
    throw new ApiError(404, 'Invitation not found');
  }

  if (invitation.status !== 'pending') {
    throw new ApiError(400, `Invitation is already ${invitation.status}`);
  }

  invitation.status = 'rejected';
  await invitation.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitation rejected',
  });
});

// ─────────────────────────────────────────────
// GET /invitations/business/:businessId  → pending invitations দেখো
// ─────────────────────────────────────────────
const getBusinessInvitations = asyncHandler(async (req: Request, res, next) => {
  const { businessId } = req.params;

  // ✅ Array.isArray আগে, তারপর isValid
  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  ) {
    throw new ApiError(400, 'Invalid business id');
  }

  const invitations = await Invitation.find({
    business: new Types.ObjectId(businessId),
    status: 'pending',
  })
    .populate('invitedBy', 'firstName lastName email')
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitations fetched successfully',
    data: invitations,
  });
});

export const invitationController = {
  sendInvitation,
  checkInvitation,
  acceptInvitation,
  rejectInvitation,
  getBusinessInvitations,
};
