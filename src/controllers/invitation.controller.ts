import { Request } from 'express';
import { Types } from 'mongoose';
import Invitation from '../models/invitation.model';
import { BusinessMembersModel } from '../models/business-members.model';
import Business from '../models/business.model';
import User from '../models/user.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import sendEmail from '../utils/sendEmail';
import { inviteEmailTemplate } from '../utils/template/emailTemplates';

/* ─── Helpers ─────────────────────────────────────────── */
const buildInviteLink = (token: string) =>
  `${(process.env.FRONTEND_URL ?? '').replace(/\/+$/, '')}/invite/${token}`;

/**
 * Invite emails are best-effort: a broken/rate-limited SMTP box must never
 * throw away an invitation that was already created. We swallow the error and
 * report delivery status so the client can fall back to sharing the link.
 */
const trySendInviteEmail = async (opts: {
  to: string;
  inviterName: string;
  businessName: string;
  role: string;
  inviteLink: string;
}): Promise<boolean> => {
  try {
    await sendEmail({
      to: opts.to,
      subject: `${opts.inviterName} invited you to join ${opts.businessName} on CashBook`,
      html: inviteEmailTemplate({
        inviterName: opts.inviterName,
        businessName: opts.businessName,
        role: opts.role,
        inviteLink: opts.inviteLink,
      }),
    });
    return true;
  } catch (err) {
    console.error('[invitation] email delivery failed:', err);
    return false;
  }
};

/* ─── Send Invitation ─────────────────────────────────── */
const sendInvitation = asyncHandler(async (req: Request, res, next) => {
  const { businessId } = req.params;
  const { email, role = 'member' } = req.body;

  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ApiError(400, 'Valid email required');
  if (!['admin', 'member'].includes(role))
    throw new ApiError(400, 'Role must be admin or member');

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(400, 'Invalid user');

  const objectBusinessId = new Types.ObjectId(businessId);
  const objectUserId = new Types.ObjectId(String(userId));

  // ✅ only owner or admin can invite
  const requester = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectUserId,
    role: { $in: ['owner', 'admin'] },
    status: true,
  });
  if (!requester) throw new ApiError(403, 'Only owner or admin can invite');

  // ✅ check if already a member
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    const alreadyMember = await BusinessMembersModel.findOne({
      business: objectBusinessId,
      user: existingUser._id,
      status: true,
    });
    if (alreadyMember) throw new ApiError(400, 'This user is already a member');
  }

  // ✅ reuse an existing pending invite instead of erroring out — otherwise a
  // failed email leaves the admin stuck with no link and no way to re-issue one
  const existingInvite = await Invitation.findOne({
    business: objectBusinessId,
    email: email.toLowerCase(),
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });

  const reused = Boolean(existingInvite);

  const invitation =
    existingInvite ??
    (await Invitation.create({
      business: objectBusinessId,
      invitedBy: objectUserId,
      email: email.toLowerCase(),
      role,
    }));

  // keep the role in sync if the admin re-invited with a different one
  if (existingInvite && existingInvite.role !== role) {
    existingInvite.role = role;
    await existingInvite.save();
  }

  // ✅ fetch business + inviter details for email
  const [business, inviter] = await Promise.all([
    Business.findById(objectBusinessId).lean(),
    User.findById(objectUserId).lean(),
  ]);

  if (!business || !inviter) throw new ApiError(500, 'Failed to fetch details');

  const inviteLink = buildInviteLink(invitation.token);

  // ✅ best-effort email — never fails the request
  const emailSent = await trySendInviteEmail({
    to: email,
    inviterName: `${inviter.firstName} ${inviter.lastName}`,
    businessName: business.name,
    role,
    inviteLink,
  });

  sendResponse(res, {
    statusCode: reused ? 200 : 201,
    success: true,
    message: emailSent
      ? `Invitation sent to ${email}`
      : `Invitation created for ${email}, but the email could not be delivered. Share the link instead.`,
    data: {
      invitationId: invitation._id,
      inviteLink,
      token: invitation.token,
      email,
      role,
      emailSent,
      reused,
      expiresAt: invitation.expiresAt,
    },
  });
});

/* ─── Get invitation details by token ────────────────── */
const getInvitationByToken = asyncHandler(async (req: Request, res, next) => {
  const { token } = req.params;
  if (!token) throw new ApiError(400, 'Token required');

  const invitation = await Invitation.findOne({ token })
    .populate('business', 'name type')
    .populate('invitedBy', 'firstName lastName email')
    .lean();

  if (!invitation) throw new ApiError(404, 'Invitation not found');

  if (invitation.status !== 'pending')
    throw new ApiError(400, `Invitation already ${invitation.status}`);

  if (new Date() > invitation.expiresAt) {
    await Invitation.findByIdAndUpdate(invitation._id, { status: 'expired' });
    throw new ApiError(400, 'Invitation has expired');
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitation found',
    data: invitation,
  });
});

/* ─── Accept Invitation ───────────────────────────────── */
const acceptInvitation = asyncHandler(async (req: Request, res, next) => {
  const { token } = req.params;

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(401, 'Login required to accept invitation');

  const objectUserId = new Types.ObjectId(String(userId));

  const invitation = await Invitation.findOne({ token })
    .populate('business', 'name type')
    .lean();

  if (!invitation) throw new ApiError(404, 'Invitation not found');
  if (invitation.status !== 'pending')
    throw new ApiError(400, `Invitation already ${invitation.status}`);
  if (new Date() > invitation.expiresAt) {
    await Invitation.findByIdAndUpdate(invitation._id, { status: 'expired' });
    throw new ApiError(400, 'Invitation has expired');
  }

  // ✅ verify email matches
  const user = await User.findById(objectUserId).lean();
  if (!user) throw new ApiError(404, 'User not found');
  if (user.email.toLowerCase() !== invitation.email.toLowerCase())
    throw new ApiError(403, 'This invitation was sent to a different email');

  // ✅ already a member?
  const alreadyMember = await BusinessMembersModel.findOne({
    business: invitation.business,
    user: objectUserId,
    status: true,
  });
  if (alreadyMember) {
    await Invitation.findByIdAndUpdate(invitation._id, { status: 'accepted' });
    throw new ApiError(400, 'You are already a member of this business');
  }

  // ✅ add to business members
  await BusinessMembersModel.create({
    business: invitation.business,
    user: objectUserId,
    role: invitation.role,
    status: true,
  });

  // ✅ mark invitation as accepted
  await Invitation.findByIdAndUpdate(invitation._id, { status: 'accepted' });

  const business = invitation?.business as unknown as {
    _id: string;
    name: string;
    type: string;
  };

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: `Welcome to ${business?.name}!`,
    data: {
      businessId: business._id,
      businessName: business.name,
      role: invitation.role,
    },
  });
});

/* ─── Decline Invitation ──────────────────────────────── */
const declineInvitation = asyncHandler(async (req: Request, res, next) => {
  const { token } = req.params;

  const invitation = await Invitation.findOne({ token });
  if (!invitation) throw new ApiError(404, 'Invitation not found');
  if (invitation.status !== 'pending')
    throw new ApiError(400, `Invitation already ${invitation.status}`);

  await Invitation.findByIdAndUpdate(invitation._id, { status: 'declined' });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitation declined',
  });
});

/* ─── Get my pending invitations ─────────────────────── */
const getMyInvitations = asyncHandler(async (req: Request, res, next) => {
  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(401, 'Login required');

  const user = await User.findById(userId).lean();
  if (!user) throw new ApiError(404, 'User not found');

  const invitations = await Invitation.find({
    email: user.email.toLowerCase(),
    status: 'pending',
    expiresAt: { $gt: new Date() },
  })
    .populate('business', 'name type')
    .populate('invitedBy', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitations fetched',
    data: invitations,
  });
});

/* ─── List sent invitations (for business admins) ────── */
const getSentInvitations = asyncHandler(async (req: Request, res, next) => {
  const { businessId } = req.params;

  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(401, 'Login required');

  const objectBusinessId = new Types.ObjectId(businessId);
  const objectUserId = new Types.ObjectId(String(userId));

  const requester = await BusinessMembersModel.findOne({
    business: objectBusinessId,
    user: objectUserId,
    role: { $in: ['owner', 'admin'] },
    status: true,
  });
  if (!requester) throw new ApiError(403, 'Access denied');

  const invitations = await Invitation.find({ business: objectBusinessId })
    .populate('invitedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();

  const now = new Date();

  // expose the shareable link for invites that are still usable, so an admin
  // can re-copy it (WhatsApp, SMS, …) when the email never arrived
  const withLinks = invitations.map((inv) => ({
    ...inv,
    inviteLink:
      inv.status === 'pending' && new Date(inv.expiresAt) > now
        ? buildInviteLink(inv.token)
        : undefined,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Sent invitations fetched',
    data: withLinks,
  });
});

/* ─── Cancel invitation ───────────────────────────────── */
const cancelInvitation = asyncHandler(async (req: Request, res, next) => {
  const { invitationId } = req.params;

  if (
    !invitationId ||
    Array.isArray(invitationId) ||
    !Types.ObjectId.isValid(invitationId)
  )
    throw new ApiError(400, 'Invalid invitation id');

  const userId = req.user?._id;
  if (!userId || !Types.ObjectId.isValid(String(userId)))
    throw new ApiError(401, 'Login required');

  const objectUserId = new Types.ObjectId(String(userId));
  const invitation = await Invitation.findById(invitationId);
  if (!invitation) throw new ApiError(404, 'Invitation not found');

  const requester = await BusinessMembersModel.findOne({
    business: invitation.business,
    user: objectUserId,
    role: { $in: ['owner', 'admin'] },
    status: true,
  });
  if (!requester) throw new ApiError(403, 'Access denied');

  await Invitation.findByIdAndDelete(invitationId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invitation cancelled',
  });
});

export const invitationController = {
  sendInvitation,
  getInvitationByToken,
  acceptInvitation,
  declineInvitation,
  getMyInvitations,
  getSentInvitations,
  cancelInvitation,
};
