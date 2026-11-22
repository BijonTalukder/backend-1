import { Request } from 'express';
import { Types } from 'mongoose';
import TransactionCategory from '../models/transaction-category.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';

/**
 * Income/expense categories. Every route used to skip the membership check
 * and create/update wrote the raw body: anyone could read another business's
 * categories, rename its "Sales Revenue" (which breaks recording sales), or
 * send {"createdBy": null} to push a category into every business's list.
 */

const TYPES = ['income', 'expense', 'both'];

/** Only these fields can be set by a user; business/createdBy/isGlobal are server-owned. */
const pickEditable = (body: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 60) {
      throw new ApiError(400, 'Category name is required (max 60 characters)');
    }
    out.name = body.name.trim();
  }
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !TYPES.includes(body.type)) throw new ApiError(400, 'Invalid category type');
    out.type = body.type;
  }
  if (body.group !== undefined) {
    if (typeof body.group !== 'string') throw new ApiError(400, 'Invalid category group');
    out.group = body.group;
  }
  if (body.icon !== undefined) {
    if (typeof body.icon !== 'string' || body.icon.length > 40) throw new ApiError(400, 'Invalid icon');
    out.icon = body.icon;
  }
  return out;
};

const createTransactionCategory = asyncHandler(async (req: Request, res) => {
  const { businessId } = req.body;
  if (typeof businessId !== 'string') throw new ApiError(400, 'Invalid business id');
  const { objectUserId, objectBusinessId } = getValidIds(req.user?._id, businessId);
  await requireMembership(objectBusinessId!, objectUserId);

  const fields = pickEditable(req.body);
  if (!fields.name) throw new ApiError(400, 'Category name is required (max 60 characters)');

  const category = await TransactionCategory.create({
    ...fields,
    business: objectBusinessId,
    createdBy: objectUserId,
    isGlobal: false,
    status: true,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Transaction category created successfully',
    data: category,
  });
});

// GET /transaction-categories/:businessId — this business's categories + the global ones
const getTransactionCategories = asyncHandler(async (req: Request, res) => {
  const { businessId } = req.params;
  if (typeof businessId !== 'string') throw new ApiError(400, 'Invalid business id');
  const { objectUserId, objectBusinessId } = getValidIds(req.user?._id, businessId);
  await requireMembership(objectBusinessId!, objectUserId);

  const categories = await TransactionCategory.find({
    status: true,
    $or: [
      { business: objectBusinessId },
      // Global = seeded by the server: no business AND no creator. A user
      // can no longer create one of these (business is always set above).
      { business: null, createdBy: null },
    ],
  }).lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transaction categories fetched successfully',
    data: categories,
  });
});

/** A business category the caller may change: owner/admin of that business. Global ones are read-only here. */
const loadManageable = async (req: Request) => {
  const { id } = req.params;
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid category id');
  const { objectUserId } = getValidIds(req.user?._id);
  const category = await TransactionCategory.findById(id);
  if (!category || !category.status) throw new ApiError(404, 'Category not found');
  if (!category.business) throw new ApiError(403, 'Global categories cannot be changed');
  await requireMembership(category.business as Types.ObjectId, objectUserId, ['owner', 'admin']);
  return category;
};

// PATCH /transaction-categories/:id
const updateTransactionCategory = asyncHandler(async (req: Request, res) => {
  const category = await loadManageable(req);
  category.set(pickEditable(req.body));
  await category.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transaction category updated successfully',
    data: category,
  });
});

// DELETE /transaction-categories/:id  (soft delete)
const deleteTransactionCategory = asyncHandler(async (req: Request, res) => {
  const category = await loadManageable(req);
  category.status = false;
  await category.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transaction category deleted successfully',
  });
});

export const transactionCategoryController = {
  createTransactionCategory,
  getTransactionCategories,
  updateTransactionCategory,
  deleteTransactionCategory,
};
