import User from '../models/user.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { generateToken } from '../utils/tokenHandler';
import config from '../config/config';
import * as bcrypt from 'bcryptjs'; // ✅ Fix 1

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

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'User created successfully',
    data: {
      user,
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

export const authController = {
  register,
  login,
};
