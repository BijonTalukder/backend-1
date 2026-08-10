// controllers/expense.controller.ts
import { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import Expense from '../models/expense.model';
import TransactionCategory from '../models/transaction-category.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import { recordLedgerEntry, balanceDeltaFor } from '../utils/ledger';

const createExpense = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { businessId, categoryId, amount, paymentMethod = 'cash', note, date, attachmentUrl } = req.body;
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new ApiError(400, 'A valid amount is required');
  }
  if (!categoryId || !Types.ObjectId.isValid(categoryId)) {
    throw new ApiError(400, 'A valid category is required');
  }

  const category = await TransactionCategory.findOne({
    _id: categoryId,
    $or: [{ business: objectBusinessId }, { isGlobal: true }],
  });
  if (!category) throw new ApiError(404, 'Category not found');

  const session = await mongoose.startSession();
  let expense;

  try {
    await session.withTransaction(async () => {
      const created = await Expense.create(
        [
          {
            business: objectBusinessId,
            category: category._id,
            amount: parsedAmount,
            paymentMethod,
            date: date ? new Date(date) : new Date(),
            note,
            attachmentUrl,
            createdBy: objectUserId,
          },
        ],
        { session },
      );
      expense = created[0];

      const { cashDelta, bankDelta } = balanceDeltaFor(paymentMethod, -parsedAmount);
      const transaction = await recordLedgerEntry(
        {
          business: objectBusinessId!,
          type: 'expense',
          amount: parsedAmount,
          category: category._id as Types.ObjectId,
          note: note || category.name,
          createdBy: objectUserId,
          member: objectUserId,
          paymentMethod,
          source: { type: 'expense', id: expense._id as Types.ObjectId },
          date: expense.date,
          cashDelta,
          bankDelta,
        },
        session,
      );

      expense.linkedTransaction = transaction._id as Types.ObjectId;
      await expense.save({ session });
    });
  } finally {
    await session.endSession();
  }

  const populated = await Expense.findById(expense!._id).populate('category', 'name icon').lean();

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Expense recorded successfully',
    data: populated,
  });
});

const getExpenses = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) throw new ApiError(400, 'Invalid business id');
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { categoryId, page = '1', limit = '20' } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = { business: objectBusinessId };
  if (categoryId && Types.ObjectId.isValid(categoryId)) filter.category = categoryId;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .sort({ date: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('category', 'name icon')
      .lean(),
    Expense.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Expenses fetched successfully',
    data: {
      expenses,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    },
  });
});

export const expenseController = {
  createExpense,
  getExpenses,
};
