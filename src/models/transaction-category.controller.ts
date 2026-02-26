import { Request } from 'express';
import { Types } from 'mongoose';
import TransactionCategory from '../models/transaction-category.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';

const createTransactionCategory = asyncHandler(
  async (req: Request, res, next) => {
    const userId = req.user?._id;

    if (!userId || !Types.ObjectId.isValid(String(userId))) {
      throw new ApiError(400, 'Invalid user id');
    }

    const { businessId } = req.body;

    if (!businessId || !Types.ObjectId.isValid(businessId)) {
      throw new ApiError(400, 'Invalid business id');
    }

    const category = await TransactionCategory.create({
      ...req.body,
      business: new Types.ObjectId(businessId),
      createdBy: new Types.ObjectId(String(userId)),
    });

    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: 'Transaction category created successfully',
      data: category,
    });
  },
);

// GET /transaction-categories/:businessId
// Returns global (createdBy: null) + business-specific categories
const getTransactionCategories = asyncHandler(
  async (req: Request, res, next) => {
    const { businessId } = req.params;

    if (
      !businessId ||
      Array.isArray(businessId) ||
      !Types.ObjectId.isValid(businessId)
    ) {
      throw new ApiError(400, 'Invalid business id');
    }

    const categories = await TransactionCategory.find({
      status: true,
      $or: [
        { business: new Types.ObjectId(businessId) },
        { createdBy: null }, // global admin categories
      ],
    }).lean();

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Transaction categories fetched successfully',
      data: categories,
    });
  },
);

// PATCH /transaction-categories/:id
const updateTransactionCategory = asyncHandler(
  async (req: Request, res, next) => {
    const { id } = req.params;

    if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
      throw new ApiError(400, 'Invalid category id');
    }

    const category = await TransactionCategory.findByIdAndUpdate(
      new Types.ObjectId(id),
      req.body,
      { new: true },
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Transaction category updated successfully',
      data: category,
    });
  },
);

// DELETE /transaction-categories/:id  (soft delete)
const deleteTransactionCategory = asyncHandler(
  async (req: Request, res, next) => {
    const { id } = req.params;

    if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
      throw new ApiError(400, 'Invalid category id');
    }

    await TransactionCategory.findByIdAndUpdate(new Types.ObjectId(id), {
      status: false,
    });

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Transaction category deleted successfully',
    });
  },
);

export const transactionCategoryController = {
  createTransactionCategory,
  getTransactionCategories,
  updateTransactionCategory,
  deleteTransactionCategory,
};
