import User from '../models/user.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { generateToken } from '../utils/tokenHandler';
import config from '../config/config';
import * as bcrypt from 'bcryptjs'; // ✅ Fix 1
import Transaction from '../models/transaction.model';
import TransactionCategory from '../models/transaction-category.model';
import Invitation from '../models/invitation.model';
import { BusinessMembersModel } from '../models/business-members.model';
import Business from '../models/business.model';
import { Types } from 'mongoose';
import crypto from 'crypto';
import { verifyFirebaseIdToken } from '../config/firebaseAdmin';
import type { DecodedIdToken } from 'firebase-admin/auth';
import PasswordReset from '../models/password-reset.model';
import sendEmail from '../utils/sendEmail';
import { resetOtpEmailTemplate } from '../utils/template/emailTemplates';
import { verifyToken } from '../utils/tokenHandler';
import type { JwtPayload } from 'jsonwebtoken';

/** Derive the application name fields from verified Google profile data. */
const splitGoogleName = (
  displayName: string | undefined,
  email: string,
): { firstName: string; lastName: string } => {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  const firstName = (parts[0] || email.split('@')[0]).slice(0, 50);
  const lastName = (parts.slice(1).join(' ') || 'User').slice(0, 50);
  return { firstName, lastName };
};

/**
 * Google login entry point.
 *
 * Firebase is only used to verify the Google identity. The application user,
 * onboarding state, JWT and every other concern stay in the existing system.
 * Identity always comes from the verified ID token — never from the client.
 */
const googleLogin = asyncHandler(async (req, res, next) => {
  const { idToken } = req.body;

  if (!idToken || typeof idToken !== 'string') {
    throw new ApiError(400, 'Firebase ID token is required');
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await verifyFirebaseIdToken(idToken);
  } catch (err) {
    if ((err as { code?: string }).code === 'FIREBASE_NOT_CONFIGURED') {
      throw new ApiError(500, 'Google sign-in is not configured');
    }
    throw new ApiError(401, 'Invalid or expired Google token');
  }

  const firebaseUid = decoded.uid;
  const email = decoded.email?.toLowerCase();

  if (!firebaseUid) {
    throw new ApiError(401, 'Invalid Google token');
  }
  if (!email) {
    throw new ApiError(400, 'Google account has no email address');
  }
  if (decoded.email_verified === false) {
    throw new ApiError(400, 'Google email address is not verified');
  }

  // 1) Already linked Google user?
  let user = await User.findOne({ firebaseUid });

  // 2) Existing application account with the same verified email?
  if (!user) {
    const existing = await User.findOne({ email }).select('+password');

    if (existing) {
      if (existing.password) {
        // Account-linking policy: never silently merge into an account that
        // is protected by a password.
        throw new ApiError(
          409,
          'This email is already registered with a password. Please sign in with your email and password.',
        );
      }

      existing.authProvider = 'google';
      existing.firebaseUid = firebaseUid;
      if (!existing.avatar && decoded.picture) {
        existing.avatar = decoded.picture;
      }
      await existing.save({ validateBeforeSave: false });
      user = existing;
    } else {
      // 3) Brand new application user → existing registration flow takes over
      const { firstName, lastName } = splitGoogleName(decoded.name, email);
      try {
        user = await User.create({
          firstName,
          lastName,
          email,
          avatar: decoded.picture,
          authProvider: 'google',
          firebaseUid,
          // role is always the schema default — never taken from the client
        });
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code !== 11000) throw err;
        // Race with a parallel login: reuse whichever document was created
        user =
          (await User.findOne({ firebaseUid })) ??
          (await User.findOne({ email }));
        if (!user) throw err;
      }
    }
  }

  if (!user.isActive) {
    throw new ApiError(401, 'User is not active');
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const userPayload = {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
  };
  const token = await generateToken(userPayload, config.jwtSecret);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Login successful',
    data: {
      token,
      user,
    },
  });
});

const register = asyncHandler(async (req, res, next) => {
  const { firstName, lastName, email, password, role } = req.body;

  // Provider-specific conflict message (same status/message as the
  // duplicate-key handler for password accounts).
  if (typeof email === 'string' && email.trim()) {
    const existingUser = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select('+password');
    if (existingUser) {
      throw new ApiError(
        400,
        existingUser.password
          ? 'This email is already registered'
          : 'This email is already registered with Google. Please continue with Google.',
      );
    }
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const safeRole = ['super_admin', 'admin'].includes(role) ? 'member' : role;

  const user = await User.create({
    firstName,
    lastName,
    email,
    password: hashedPassword,
    role: safeRole,
  });
  const userPayload = {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
  };
  const token = await generateToken(userPayload, config.jwtSecret);

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'User created successfully',
    data: {
      user,
      token,
    },
  });
});

const login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required');
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    return next(new ApiError(401, 'Invalid email or password'));
  }

  // Google-only account: there is no password to compare (bcrypt would throw).
  if (!user.password) {
    return next(
      new ApiError(
        401,
        'This account is registered with Google. Please continue with Google.',
      ),
    );
  }

  if (!(await user.comparePassword(password))) {
    return next(new ApiError(401, 'Invalid email or password'));
  }

  if (!user.isActive) {
    return next(new ApiError(401, 'User is not active'));
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // ✅ Fix 2: Create plain object for JWT
  const userPayload = {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
  };

  const token = await generateToken(userPayload, config.jwtSecret);

  // ✅ Remove password from response
  // const userResponse = user.toObject();
  // delete userResponse.password;

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Login successful',
    data: {
      token,
      user: user,
    },
  });
});
const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { firstName, lastName } = req.body;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user');
  }

  const update: { firstName?: string; lastName?: string } = {};
  if (firstName !== undefined) update.firstName = firstName;
  if (lastName !== undefined) update.lastName = lastName;

  if (Object.keys(update).length === 0) {
    throw new ApiError(400, 'Nothing to update');
  }

  if (
    (update.firstName !== undefined && !update.firstName.trim()) ||
    (update.lastName !== undefined && !update.lastName.trim())
  ) {
    throw new ApiError(400, 'First name and last name are required');
  }

  const user = await User.findByIdAndUpdate(userId, update, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Profile updated successfully',
    data: user,
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const userId = req.user?._id;
  const { currentPassword, newPassword } = req.body;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user');
  }

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'Current password and new password are required');
  }

  if (newPassword.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters');
  }

  const user = await User.findById(userId).select('+password');
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Google-only account has no password (bcrypt.compare would throw).
  if (!user.password) {
    throw new ApiError(
      400,
      'This account is registered with Google and has no password.',
    );
  }

  if (!(await user.comparePassword(currentPassword))) {
    throw new ApiError(400, 'Current password is incorrect');
  }

  user.password = await bcrypt.hash(newPassword, 12);
  user.passwordChangedAt = new Date();
  await user.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Password changed successfully',
    data: null,
  });
});

const deleteAccount = asyncHandler(async (req, res) => {
  const userId = req.user?._id;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user');
  }

  const objectUserId = new Types.ObjectId(String(userId));

  // ── Step 1: owned businesses গুলো find করো ──────────
  const ownedMemberships = await BusinessMembersModel.find({
    user: objectUserId,
    role: 'owner',
    status: true,
  }).select('business');

  const ownedBusinessIds = ownedMemberships.map((m) => m.business);

  // ── Step 2: owned business এর সব data delete ────────
  if (ownedBusinessIds.length > 0) {
    // Transactions
    await Transaction.deleteMany({ business: { $in: ownedBusinessIds } });

    // Custom categories
    await TransactionCategory.deleteMany({
      business: { $in: ownedBusinessIds },
    });

    // Invitations
    await Invitation.deleteMany({ business: { $in: ownedBusinessIds } });

    // All memberships of owned businesses
    await BusinessMembersModel.deleteMany({
      business: { $in: ownedBusinessIds },
    });

    // Businesses
    await Business.deleteMany({ _id: { $in: ownedBusinessIds } });
  }

  // ── Step 3: user অন্য business এর member হলে সেখান থেকে remove ──
  await BusinessMembersModel.deleteMany({ user: objectUserId });

  // ── Step 4: user delete ──────────────────────────────
  await User.findByIdAndDelete(objectUserId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Account and all associated data deleted successfully',
    data: null,
  });
});

/* ─── Forgot password (email OTP) ──────────────────────── */

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
// Same response whether or not the account exists — no email enumeration.
const FORGOT_GENERIC_MESSAGE =
  'If an account with this email exists, a verification code has been sent.';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (raw: unknown): string => {
  if (typeof raw !== 'string' || !EMAIL_REGEX.test(raw.trim())) {
    throw new ApiError(400, 'Valid email is required');
  }
  return raw.trim().toLowerCase();
};

const generateOtpCode = (): string =>
  crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

const invalidOtpError = () =>
  new ApiError(400, 'Invalid or expired verification code');

/**
 * Step 1 — request a code. Only password-backed accounts receive an email;
 * Google-only accounts (and unknown emails) get the identical generic
 * response, so the endpoint never discloses who is registered.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  const user = await User.findOne({ email }).select('+password');

  if (user?.password) {
    const active = await PasswordReset.findOne({
      email,
      purpose: 'password_reset',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    const recentlySent =
      active &&
      Date.now() - active.createdAt.getTime() <
        OTP_RESEND_COOLDOWN_SECONDS * 1000;

    if (!recentlySent) {
      await PasswordReset.deleteMany({ email, purpose: 'password_reset' });

      const code = generateOtpCode();
      const record = await PasswordReset.create({
        email,
        codeHash: await bcrypt.hash(code, 10),
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      });

      try {
        await sendEmail({
          to: email,
          subject: 'Your CashBook password reset code',
          html: resetOtpEmailTemplate({
            firstName: user.firstName,
            code,
            expiresMinutes: OTP_TTL_MINUTES,
          }),
        });
      } catch (err) {
        // Never leave a code the user never received behind.
        await PasswordReset.deleteOne({ _id: record._id });
        console.error('[auth] password reset email failed:', err);
        throw new ApiError(
          500,
          'Failed to send verification email. Please try again.',
        );
      }
    }
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: FORGOT_GENERIC_MESSAGE,
    data: null,
  });
});

/**
 * Step 2 — check the code and hand back a short-lived reset token.
 * The token (not the OTP) authorizes the password change, so the code
 * can be re-checked while the user finishes the flow.
 */
const verifyResetOtp = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

  if (!/^\d{6}$/.test(otp)) {
    throw new ApiError(400, 'Enter the 6-digit verification code');
  }

  const record = await PasswordReset.findOne({
    email,
    purpose: 'password_reset',
    usedAt: null,
  })
    .sort({ createdAt: -1 })
    .select('+codeHash');

  if (!record || record.expiresAt.getTime() <= Date.now()) {
    throw invalidOtpError();
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    record.usedAt = new Date();
    await record.save();
    throw new ApiError(
      400,
      'Too many attempts. Please request a new code.',
    );
  }

  const codeMatches = await bcrypt.compare(otp, record.codeHash);
  if (!codeMatches) {
    record.attempts += 1;
    await record.save();
    throw invalidOtpError();
  }

  const resetToken = await generateToken(
    { email, purpose: 'password_reset' },
    config.jwtSecret,
    `${OTP_TTL_MINUTES}m`,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Verification code verified',
    data: { resetToken },
  });
});

/**
 * Step 3 — exchange the reset token for a new password.
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { resetToken, password } = req.body ?? {};

  if (!resetToken || typeof resetToken !== 'string') {
    throw new ApiError(400, 'Reset token is required');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters');
  }

  let payload: JwtPayload | string;
  try {
    payload = verifyToken(resetToken, config.jwtSecret);
  } catch {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  if (
    typeof payload === 'string' ||
    payload.purpose !== 'password_reset' ||
    typeof payload.email !== 'string'
  ) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  const email = payload.email.toLowerCase();

  // Single-use: the token stays valid only while the code it was issued
  // for still exists — reset consumes both.
  const otpRecord = await PasswordReset.findOne({
    email,
    purpose: 'password_reset',
    expiresAt: { $gt: new Date() },
  });
  if (!otpRecord) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  const user = await User.findOne({ email }).select('+password');

  // Unknown account or Google-only account: same answer as a bad token.
  if (!user?.password) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  user.password = await bcrypt.hash(password, 12);
  user.passwordChangedAt = new Date();
  await user.save();

  // The code is single-purpose: nothing may reuse it after the change.
  await PasswordReset.deleteMany({ email, purpose: 'password_reset' });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Password has been reset successfully',
    data: null,
  });
});

export const authController = {
  register,
  login,
  googleLogin,
  updateProfile,
  changePassword,
  deleteAccount,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
};
