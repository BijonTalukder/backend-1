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

const register = asyncHandler(async (req, res, next) => {
  const { firstName, lastName, email, password, role } = req.body;
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

  if (!user || !(await user.comparePassword(password))) {
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

export const authController = {
  register,
  login,
  deleteAccount,
};
