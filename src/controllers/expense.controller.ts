// controllers/expense.controller.ts
import { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import Expense from '../models/expense.model';
import TransactionCategory from '../models/transaction-category.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import { recordLedgerEntry, balanceDeltaFor, sanitizeAttachmentUrl, applyBalanceDelta } from '../utils/ledger';
import Transaction from '../models/transaction.model';
import { toAmount } from '../utils/money';

const createExpense = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { businessId, categoryId, amount, paymentMethod = 'cash', note, date, attachmentUrl: rawAttachmentUrl } = req.body;
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);
  const attachmentUrl = sanitizeAttachmentUrl(rawAttachmentUrl);

  await requireMembership(objectBusinessId!, objectUserId);

  const parsedAmount = toAmount(amount, 'Amount', { positive: true });
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
          attachmentUrl,
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

/* ─── Delete an expense ──────────────────────────────────
   The expense, its ledger entry and the money it took out of cash/bank go
   together. (Deleting only the ledger row from the transactions list used to
   leave the expense in reports and the cash balance short.) */
const deleteExpense = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid expense id');

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const expense = await Expense.findById(id).session(session);
      if (!expense) throw new ApiError(404, 'Expense not found');
      const isCreator = String(expense.createdBy) === String(objectUserId);
      await requireMembership(
        expense.business as Types.ObjectId,
        objectUserId,
        isCreator ? ['owner', 'admin', 'member'] : ['owner', 'admin'],
      );

      const tx = expense.linkedTransaction
        ? await Transaction.findById(expense.linkedTransaction).session(session)
        : null;
      // Entries made before deltas were stored still moved the balance (every
      // expense went through recordLedgerEntry), so rebuild that move from the expense.
      const delta =
        tx && tx.balanceApplied
          ? { cashDelta: tx.cashDelta ?? 0, bankDelta: tx.bankDelta ?? 0 }
          : balanceDeltaFor(expense.paymentMethod, -expense.amount);
      await applyBalanceDelta(expense.business as Types.ObjectId, -delta.cashDelta, -delta.bankDelta, session);
      if (tx) await Transaction.deleteOne({ _id: tx._id }, { session });
      await Expense.deleteOne({ _id: expense._id }, { session });
    });
  } finally {
    await session.endSession();
  }

  sendResponse(res, { statusCode: 200, success: true, message: 'Expense deleted' });
});

export const expenseController = {
  deleteExpense,
  createExpense,
  getExpenses,
};
