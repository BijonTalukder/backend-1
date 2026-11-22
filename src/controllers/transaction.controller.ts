// controllers/transaction.controller.ts
import { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import Transaction from '../models/transaction.model';
import Settlement from '../models/settlement.model';
import { requireMembership } from '../utils/businessAuth';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { sanitizeAttachmentUrl, balanceDeltaFor, applyBalanceDelta, REPORTABLE_MATCH } from '../utils/ledger';
import { toAmount } from '../utils/money';
import { localYear, localYearRange, MONGO_TZ, resolveDateRange } from '../utils/timezone';

/* ─── Helper ──────────────────────────────────────────── */
const getValidIds = (userId: any, businessId?: string) => {
  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user id');
  }
  const ids: any = { objectUserId: new Types.ObjectId(String(userId)) };
  if (businessId) {
    if (!Types.ObjectId.isValid(businessId))
      throw new ApiError(400, 'Invalid business id');
    ids.objectBusinessId = new Types.ObjectId(businessId);
  }
  return ids;
};


const PAYMENT_METHODS = ['cash', 'bank', 'bkash', 'nagad', 'other'];

/* ─── Create Transaction ──────────────────────────────── */
const createTransaction = asyncHandler(async (req: Request, res, next) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const {
    businessId,
    type,
    amount,
    category,
    note,
    date,
    reference,
    attachmentUrl: rawAttachmentUrl,
    paidFor = [],
    splitType = 'none',
    toMember,
    memberId,
    paymentMethod: rawPaymentMethod,
  } = req.body;

  if (!businessId || !Types.ObjectId.isValid(businessId))
    throw new ApiError(400, 'Invalid business id');
  const objectBusinessId = new Types.ObjectId(businessId);

  await requireMembership(objectBusinessId, objectUserId, [
    'owner',
    'admin',
    'member',
  ]);

  if (!['income', 'expense', 'transfer'].includes(type)) {
    throw new ApiError(400, 'Type must be income, expense or transfer');
  }
  const parsedAmount = toAmount(amount, 'Amount', { positive: true });
  const paymentMethod = PAYMENT_METHODS.includes(rawPaymentMethod) ? rawPaymentMethod : 'cash';
  if (!category || !Types.ObjectId.isValid(category))
    throw new ApiError(400, 'Invalid category');

  const member =
    memberId && Types.ObjectId.isValid(memberId)
      ? new Types.ObjectId(memberId)
      : objectUserId;

  const paidForParsed = (paidFor as any[]).map((p) => {
    if (!p.member || !Types.ObjectId.isValid(p.member))
      throw new ApiError(400, 'Invalid paidFor member');
    return {
      member: new Types.ObjectId(p.member),
      amount: toAmount(p.amount, 'paidFor amount', { positive: true }),
      note: p.note,
    };
  });

  const hasOthers = paidForParsed.length > 0;
  const settlementStatus = hasOthers ? 'pending' : 'not_applicable';

  if (type === 'transfer') {
    if (!toMember || !Types.ObjectId.isValid(toMember))
      throw new ApiError(400, 'Invalid toMember for transfer');
  }

  // Income/expense entered directly move the cash (or bank) balance like any
  // other entry; before, only sales/purchases/payments did, so a ৳2000 rent
  // expense left the cash balance ৳2000 too high. Transfers move money between
  // members, not in or out of the business.
  const { cashDelta, bankDelta } =
    type === 'transfer' ? { cashDelta: 0, bankDelta: 0 } : balanceDeltaFor(paymentMethod, type === 'income' ? parsedAmount : -parsedAmount);

  const session = await mongoose.startSession();
  let transaction;
  try {
    await session.withTransaction(async () => {
      [transaction] = await Transaction.create(
        [
          {
    business: objectBusinessId,
    type,
    amount: parsedAmount,
    paymentMethod,
    cashDelta,
    bankDelta,
    balanceApplied: true,
    category: new Types.ObjectId(category),
    member,
    createdBy: objectUserId,
    note,
    reference,
    attachmentUrl: sanitizeAttachmentUrl(rawAttachmentUrl),
    date: date ? new Date(date) : new Date(),
    paidFor: paidForParsed,
    splitType,
    toMember: toMember ? new Types.ObjectId(toMember) : null,
    settlementStatus,
    settledAmount: 0,
          },
        ],
        { session },
      );
      await applyBalanceDelta(objectBusinessId, cashDelta, bankDelta, session);
    });
  } finally {
    await session.endSession();
  }

  const populated = await Transaction.findById(transaction!._id)
    .populate('category', 'name type icon group')
    .populate('member', 'firstName lastName email')
    .populate('toMember', 'firstName lastName email')
    .populate('paidFor.member', 'firstName lastName email')
    .lean();

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Transaction created',
    data: populated,
  });
});

/* ─── Get Transactions (with filters) ────────────────── */
const getBusinessTransactions = asyncHandler(
  async (req: Request, res, next) => {
    const { businessId } = req.params;
    const { objectUserId } = getValidIds(req.user?._id);

    if (
      !businessId ||
      Array.isArray(businessId) ||
      !Types.ObjectId.isValid(businessId)
    )
      throw new ApiError(400, 'Invalid business id');
    const objectBusinessId = new Types.ObjectId(businessId);

    await requireMembership(objectBusinessId, objectUserId, [
      'owner',
      'admin',
      'member',
      'viewer',
    ]);

    const {
      type,
      category,
      memberId,
      startDate,
      endDate,
      settlementStatus,
      customerId,
      supplierId,
      paymentMethod,
      sourceType,
      page = '1',
      limit = '20',
    } = req.query as Record<string, string>;

    const filter: Record<string, any> = { business: objectBusinessId };

    if (type) filter.type = type;
    if (category && Types.ObjectId.isValid(category))
      filter.category = new Types.ObjectId(category);
    if (memberId && Types.ObjectId.isValid(memberId))
      filter.member = new Types.ObjectId(memberId);
    if (settlementStatus) filter.settlementStatus = settlementStatus;
    if (customerId && Types.ObjectId.isValid(customerId))
      filter.customer = new Types.ObjectId(customerId);
    if (supplierId && Types.ObjectId.isValid(supplierId))
      filter.supplier = new Types.ObjectId(supplierId);
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (sourceType) filter['source.type'] = sourceType;
    if (startDate || endDate) {
      // Whole Dhaka days: an early-morning entry belongs to the shop's day,
      // and the end date is inclusive (end-exclusive bound on the next day).
      const range = resolveDateRange({ from: startDate, to: endDate });
      filter.date = {};
      if (startDate) filter.date.$gte = range.start;
      if (endDate) filter.date.$lt = range.endExclusive;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, parseInt(limit));

    const [transactions, total, summary] = await Promise.all([
      Transaction.find(filter)
        .populate('category', 'name type icon group')
        .populate('member', 'firstName lastName email avatar')
        .populate('toMember', 'firstName lastName email')
        .populate('paidFor.member', 'firstName lastName email')
        .populate('customer', 'name phone')
        .populate('supplier', 'name phone')
        .sort({ date: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),

      Transaction.countDocuments(filter),

      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              type: '$type',
              // opening balance / payments are listed but are not income or expense
              reportable: {
                $and: [{ $ne: ['$isAdjustment', true] }, { $ne: ['$source.type', 'payment'] }],
              },
              adjustment: { $eq: ['$isAdjustment', true] },
            },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const pick = (type: string, pred: (id: any) => boolean) =>
      summary
        .filter((s) => s._id.type === type && pred(s._id))
        .reduce((acc, s) => ({ total: acc.total + s.total, count: acc.count + s.count }), { total: 0, count: 0 });
    const income = pick('income', (id) => id.reportable);
    const expense = pick('expense', (id) => id.reportable);
    // The balance still starts from the opening balance.
    const openingIn = pick('income', (id) => id.adjustment);
    const openingOut = pick('expense', (id) => id.adjustment);

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Transactions fetched',
      data: {
        transactions,
        summary: {
          totalIncome: income.total,
          totalExpense: expense.total,
          balance: openingIn.total - openingOut.total + income.total - expense.total,
          incomeCount: income.count,
          expenseCount: expense.count,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  },
);

/* ─── Settle a transaction ────────────────────────────── */
const settleTransaction = asyncHandler(async (req: Request, res, next) => {
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id))
    throw new ApiError(400, 'Invalid transaction id');

  const { objectUserId } = getValidIds(req.user?._id);
  const { amount, note, paidTo } = req.body;

  const transaction = await Transaction.findById(id);
  if (!transaction) throw new ApiError(404, 'Transaction not found');
  await requireMembership(transaction.business as Types.ObjectId, objectUserId);
  if (transaction.settlementStatus === 'settled')
    throw new ApiError(400, 'Already fully settled');
  if (transaction.settlementStatus === 'not_applicable')
    throw new ApiError(400, 'This transaction does not require settlement');

  if (!amount || amount <= 0)
    throw new ApiError(400, 'Settlement amount must be > 0');
  if (!paidTo || !Types.ObjectId.isValid(paidTo))
    throw new ApiError(400, 'Invalid paidTo');

  const remaining = transaction.amount - transaction.settledAmount;
  if (amount > remaining)
    throw new ApiError(400, `Maximum settleable amount is ${remaining}`);

  // settlement record
  await Settlement.create({
    business: transaction.business,
    transaction: transaction._id,
    paidBy: objectUserId,
    paidTo: new Types.ObjectId(paidTo),
    amount,
    type: amount >= remaining ? 'full' : 'partial',
    note,
    createdBy: objectUserId,
  });

  // transaction update
  const newSettled = transaction.settledAmount + amount;
  const newStatus: any =
    newSettled >= transaction.amount ? 'settled' : 'partial';

  await Transaction.findByIdAndUpdate(id, {
    settledAmount: newSettled,
    settlementStatus: newStatus,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message:
      newStatus === 'settled'
        ? 'Fully settled ✓'
        : `Partial settlement — ৳${remaining - amount} remaining`,
    data: {
      settledAmount: newSettled,
      status: newStatus,
      remaining: remaining - amount,
    },
  });
});

/* ─── Get settlements of a transaction ───────────────── */
const getSettlements = asyncHandler(async (req: Request, res, next) => {
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id))
    throw new ApiError(400, 'Invalid id');

  const { objectUserId } = getValidIds(req.user?._id);
  const transaction = await Transaction.findById(id).select('business').lean();
  if (!transaction) throw new ApiError(404, 'Transaction not found');
  await requireMembership(transaction.business as Types.ObjectId, objectUserId);

  const settlements = await Settlement.find({ transaction: id })
    .populate('paidBy', 'firstName lastName email')
    .populate('paidTo', 'firstName lastName email')
    .sort({ createdAt: -1 })
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Settlements fetched',
    data: settlements,
  });
});

const getPendingDues = asyncHandler(async (req: Request, res, next) => {
  const { businessId } = req.params;
  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');

  const { objectUserId } = getValidIds(req.user?._id);
  const objectBusinessId = new Types.ObjectId(businessId);

  await requireMembership(objectBusinessId, objectUserId, [
    'owner',
    'admin',
    'member',
    'viewer',
  ]);

  const transactions = await Transaction.find({
    business: objectBusinessId,
    settlementStatus: { $in: ['pending', 'partial'] },
    'paidFor.0': { $exists: true },
  })
    .populate('member', 'firstName lastName email')
    .populate('paidFor.member', 'firstName lastName email')
    .lean();

  const duesMap: Record<
    string,
    { from: any; to: any; amount: number; transactions: any[] }
  > = {};

  transactions.forEach((t) => {
    const payer = t.member as any;
    t.paidFor.forEach((pf) => {
      const debtor = pf.member as any;
      const remaining = pf.amount - t.settledAmount / t.paidFor.length; // approximate
      const key = `${debtor._id}-${payer._id}`;

      if (!duesMap[key]) {
        duesMap[key] = { from: debtor, to: payer, amount: 0, transactions: [] };
      }
      duesMap[key].amount += remaining;
      duesMap[key].transactions.push({
        _id: t._id,
        amount: t.amount,
        date: t.date,
        note: t.note,
      });
    });
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Pending dues fetched',
    data: Object.values(duesMap).filter((d) => d.amount > 0),
  });
});

/* ─── Update / Delete ─────────────────────────────────── */

/**
 * Entries written by a sale, purchase, expense or payment are part of that
 * record: editing or deleting the ledger row alone left stock, dues, the
 * linked document and the cash balance wrong. They are changed from their
 * own screen; the opening balance from business settings.
 */
const LINKED_MESSAGE: Record<string, string> = {
  sale: 'This entry belongs to a sale. Return or cancel the sale instead.',
  purchase: 'This entry belongs to a purchase and can’t be changed here.',
  expense: 'This entry belongs to an expense. Delete the expense instead.',
  payment: 'This entry belongs to a customer or supplier payment and can’t be changed here.',
};

const assertDirectEntry = (t: { source?: { type?: string } | null; isAdjustment?: boolean }) => {
  if (t.source?.type) {
    throw new ApiError(400, LINKED_MESSAGE[t.source.type] ?? 'This entry belongs to another record and can’t be changed here.');
  }
  if (t.isAdjustment) throw new ApiError(400, 'The opening balance is changed from business settings.');
};

const loadOwnEntry = async (req: Request) => {
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id))
    throw new ApiError(400, 'Invalid id');

  const { objectUserId } = getValidIds(req.user?._id);
  const transaction = await Transaction.findById(id);
  if (!transaction) throw new ApiError(404, 'Transaction not found');

  // The creator may change their own entry, owner/admin anyone's — but only
  // while they are still an active member.
  const isCreator = transaction.createdBy.toString() === objectUserId.toString();
  await requireMembership(
    transaction.business as Types.ObjectId,
    objectUserId,
    isCreator ? ['owner', 'admin', 'member'] : ['owner', 'admin'],
  );
  assertDirectEntry(transaction);
  return transaction;
};

const updateTransaction = asyncHandler(async (req: Request, res) => {
  const transaction = await loadOwnEntry(req);

  if (transaction.settlementStatus === 'settled') {
    throw new ApiError(400, 'Cannot edit a fully settled transaction');
  }

  const { type, amount, category, note, date, reference, attachmentUrl, paymentMethod } = req.body;

  const patch: Record<string, unknown> = {};
  if (type !== undefined) {
    if (!['income', 'expense', 'transfer'].includes(type)) {
      throw new ApiError(400, 'Type must be income, expense or transfer');
    }
    if ((type === 'transfer') !== (transaction.type === 'transfer')) {
      throw new ApiError(400, 'A transfer can’t be turned into income or expense (or back)');
    }
    patch.type = type;
  }
  if (amount !== undefined) {
    const next = toAmount(amount, 'Amount', { positive: true });
    if (next < (transaction.settledAmount ?? 0)) {
      throw new ApiError(400, 'Amount can’t be less than what has already been settled');
    }
    patch.amount = next;
  }
  if (paymentMethod !== undefined) {
    if (!PAYMENT_METHODS.includes(paymentMethod)) throw new ApiError(400, 'Invalid payment method');
    patch.paymentMethod = paymentMethod;
  }
  if (category !== undefined) {
    if (typeof category !== 'string' || !Types.ObjectId.isValid(category)) throw new ApiError(400, 'Invalid category');
    patch.category = new Types.ObjectId(category);
  }
  if (date !== undefined) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid date');
    patch.date = d;
  }
  if (note !== undefined) patch.note = note;
  if (reference !== undefined) patch.reference = reference;
  if (attachmentUrl !== undefined) patch.attachmentUrl = sanitizeAttachmentUrl(attachmentUrl) ?? '';

  // Re-derive the cash effect from the edited entry and move the balance by the difference.
  if (transaction.balanceApplied && transaction.type !== 'transfer') {
    const nextType = (patch.type as string) ?? transaction.type;
    const nextAmount = (patch.amount as number) ?? transaction.amount;
    const nextMethod = (patch.paymentMethod as string) ?? transaction.paymentMethod ?? 'cash';
    const next = balanceDeltaFor(nextMethod, nextType === 'income' ? nextAmount : -nextAmount);
    patch.cashDelta = next.cashDelta;
    patch.bankDelta = next.bankDelta;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Transaction.updateOne({ _id: transaction._id }, { $set: patch }, { session, runValidators: true });
      if (patch.cashDelta !== undefined) {
        await applyBalanceDelta(
          transaction.business as Types.ObjectId,
          (patch.cashDelta as number) - (transaction.cashDelta ?? 0),
          (patch.bankDelta as number) - (transaction.bankDelta ?? 0),
          session,
        );
      }
    });
  } finally {
    await session.endSession();
  }

  const updated = await Transaction.findById(transaction._id)
    .populate('category', 'name type icon')
    .populate('member', 'firstName lastName')
    .populate('paidFor.member', 'firstName lastName');

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transaction updated',
    data: updated,
  });
});

const deleteTransaction = asyncHandler(async (req: Request, res) => {
  const transaction = await loadOwnEntry(req);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Transaction.deleteOne({ _id: transaction._id }, { session });
      await Settlement.deleteMany({ transaction: transaction._id }, { session });
      // Undo exactly what the entry did to the cash / bank balance.
      if (transaction.balanceApplied) {
        await applyBalanceDelta(
          transaction.business as Types.ObjectId,
          -(transaction.cashDelta ?? 0),
          -(transaction.bankDelta ?? 0),
          session,
        );
      }
    });
  } finally {
    await session.endSession();
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transaction deleted',
  });
});

const getMonthlySummary = asyncHandler(async (req: Request, res, next) => {
  const { businessId } = req.params;
  const { objectUserId } = getValidIds(req.user?._id);
  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');

  const objectBusinessId = new Types.ObjectId(businessId);
  await requireMembership(objectBusinessId, objectUserId, [
    'owner',
    'admin',
    'member',
    'viewer',
  ]);

  const yearParam = (req.query as Record<string, string>).year;
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : localYear();
  // Whole Dhaka year. `$lte: YYYY-12-31` (midnight UTC) used to drop all of
  // 31 December, and months were cut at UTC midnight instead of Dhaka's.
  const { start, endExclusive } = localYearRange(year);

  const data = await Transaction.aggregate([
    {
      $match: {
        business: objectBusinessId,
        date: { $gte: start, $lt: endExclusive },
        ...REPORTABLE_MATCH,
      },
    },
    {
      $group: {
        _id: { month: { $month: { date: '$date', timezone: MONGO_TZ } }, type: '$type' },
        total: { $sum: '$amount' },
      },
    },
    { $sort: { '_id.month': 1 } },
  ]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const income = data.find(
      (d) => d._id.month === month && d._id.type === 'income',
    );
    const expense = data.find(
      (d) => d._id.month === month && d._id.type === 'expense',
    );
    return {
      month,
      income: income?.total ?? 0,
      expense: expense?.total ?? 0,
      balance: (income?.total ?? 0) - (expense?.total ?? 0),
    };
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Monthly summary',
    data: { year, months },
  });
});

export const transactionController = {
  createTransaction,
  getBusinessTransactions,
  updateTransaction,
  deleteTransaction,
  settleTransaction,
  getSettlements,
  getPendingDues,
  getMonthlySummary,
};
