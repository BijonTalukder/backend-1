import mongoose, { Types } from 'mongoose';
import BusinessMembers, {
  BusinessMembersModel,
} from '../models/business-members.model';
import Business, { BUSINESS_SUB_TYPES } from '../models/business.model';
import Transaction from '../models/transaction.model';
import TransactionCategory from '../models/transaction-category.model';
import { seedBusinessCategories } from '../utils/seedCategories';
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
  const {
    name,
    type,
    category,
    businessType,
    phone,
    address,
    logoUrl,
    currency,
    openingBalance,
  } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'Business name is required');
  }

  if (type === 'business') {
    if (!businessType || !BUSINESS_SUB_TYPES.includes(businessType)) {
      throw new ApiError(400, 'A valid business type is required');
    }
  }

  const parsedOpeningBalance = Number(openingBalance) || 0;
  if (parsedOpeningBalance < 0) {
    throw new ApiError(400, 'Opening balance cannot be negative');
  }

  const session = await mongoose.startSession();
  let business;

  try {
    await session.withTransaction(async () => {
      const created = await Business.create(
        [
          {
            name: name.trim(),
            type,
            owner: objectUserId,
            category: category ?? null,
            mealEnabled: type === 'mass',
            businessType: type === 'business' ? businessType : undefined,
            phone,
            address,
            logoUrl,
            currency: currency ?? 'BDT',
            openingBalance: parsedOpeningBalance,
            cashBalance: parsedOpeningBalance,
          },
        ],
        { session },
      );
      business = created[0];

      await BusinessMembersModel.create(
        [{ user: objectUserId, business: business._id, role: 'owner' }],
        { session },
      );

      await User.findByIdAndUpdate(
        objectUserId,
        { defaultBusiness: business._id },
        { session },
      );

      if (type === 'business') {
        await seedBusinessCategories(String(business._id), session);

        if (parsedOpeningBalance > 0) {
          const adjustmentCategory = await TransactionCategory.findOne({
            business: business._id,
            name: 'Other Income',
          }).session(session);

          if (adjustmentCategory) {
            await Transaction.create(
              [
                {
                  business: business._id,
                  type: 'income',
                  amount: parsedOpeningBalance,
                  category: adjustmentCategory._id,
                  note: 'Opening balance',
                  createdBy: objectUserId,
                  member: objectUserId,
                  paymentMethod: 'cash',
                  isAdjustment: true,
                  settlementStatus: 'not_applicable',
                },
              ],
              { session },
            );
          }
        }
      }
    });
  } finally {
    session.endSession();
  }

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
    .populate(
      'business',
      'name category type owner status mealEnabled currency businessType phone address logoUrl openingBalance cashBalance bankBalance invoiceSettings paymentMethods',
    )
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

  const business = await Business.findById(businessId);
  if (!business) throw new ApiError(404, 'Business not found');

  // Allowlist: never let a generic update touch structural fields (type,
  // owner, status) or ledger-derived balances. openingBalance is handled
  // separately below, gated by an activity lock; cashBalance is synced to it
  // only while the business is still fresh.
  const UPDATABLE_FIELDS = [
    'name',
    'category',
    'businessType',
    'phone',
    'address',
    'logoUrl',
    'currency',
    'invoiceSettings',
    'paymentMethods',
    'mealEnabled',
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  const currentOpeningBalance = Number(business.openingBalance ?? 0);
  const wantsOpeningBalanceChange =
    req.body.openingBalance !== undefined &&
    Number(req.body.openingBalance) !== currentOpeningBalance;

  if (wantsOpeningBalanceChange) {
    const parsedOpeningBalance = Number(req.body.openingBalance) || 0;
    if (parsedOpeningBalance < 0) {
      throw new ApiError(400, 'Opening balance cannot be negative');
    }
    // Only safe to change while the ledger still holds just the
    // opening-balance adjustment — afterwards it would rewrite the books.
    const hasActivity = await Transaction.exists({
      business: businessId,
      isAdjustment: { $ne: true },
    });
    if (hasActivity) {
      throw new ApiError(
        400,
        'Opening balance can no longer be changed after transactions have been recorded',
      );
    }
    updates.openingBalance = parsedOpeningBalance;
    updates.cashBalance = parsedOpeningBalance;
  }

  if (!wantsOpeningBalanceChange) {
    await Business.findByIdAndUpdate(businessId, updates, { new: true });
  } else {
    // Opening balance is ledger-backed: re-sync the 'Opening balance'
    // adjustment transaction in the same session as the business update.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Business.findByIdAndUpdate(businessId, updates, {
          new: true,
        }).session(session);

        await Transaction.deleteMany({
          business: businessId,
          isAdjustment: true,
          note: 'Opening balance',
        }).session(session);

        const parsedOpeningBalance = Number(req.body.openingBalance) || 0;
        if (business.type === 'business' && parsedOpeningBalance > 0) {
          const adjustmentCategory = await TransactionCategory.findOne({
            business: businessId,
            name: 'Other Income',
          }).session(session);

          if (adjustmentCategory) {
            await Transaction.create(
              [
                {
                  business: businessId,
                  type: 'income',
                  amount: parsedOpeningBalance,
                  category: adjustmentCategory._id,
                  note: 'Opening balance',
                  createdBy: objectUserId,
                  member: objectUserId,
                  paymentMethod: 'cash',
                  isAdjustment: true,
                  settlementStatus: 'not_applicable',
                },
              ],
              { session },
            );
          }
        }
      });
    } finally {
      session.endSession();
    }
  }

  const updated = await Business.findById(businessId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business updated successfully',
    data: updated,
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

/* ── Complete onboarding ─────────────────────────────── */
const completeOnboarding = asyncHandler(async (req: Request, res) => {
  const userId = req.user?._id;

  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user id');
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { onboardingCompleted: true },
    { new: true, select: '-password' },
  );

  if (!user) throw new ApiError(404, 'User not found');

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Onboarding completed',
    data: { onboardingCompleted: user.onboardingCompleted },
  });
});

export const businessController = {
  createBusiness,
  getMyBusinesses,
  updateBusiness,
  deleteBusiness,
  completeOnboarding,
};