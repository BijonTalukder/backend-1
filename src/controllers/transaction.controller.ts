// controllers/transaction.controller.ts
import { Request } from 'express';
import { Types } from 'mongoose';
import Transaction from '../models/transaction.model';
import Settlement from '../models/settlement.model';
import { BusinessMembersModel } from '../models/business-members.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';

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

const requireMembership = async (
  businessId: Types.ObjectId,
  userId: Types.ObjectId,
  roles: string[],
) => {
  const m = await BusinessMembersModel.findOne({
    business: businessId,
    user: userId,
    role: { $in: roles },
    status: 'active',
  });
  if (!m) throw new ApiError(403, 'Access denied');
  return m;
};

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
    paidFor = [], // [{ member, amount, note }]
    splitType = 'none',
    toMember, // transfer এর জন্য
    memberId, // কার behalf এ (admin করলে)
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
  if (!amount || amount <= 0) throw new ApiError(400, 'Amount must be > 0');
  if (!category || !Types.ObjectId.isValid(category))
    throw new ApiError(400, 'Invalid category');

  // member — admin হলে অন্যের behalf এ add করতে পারবে
  const member =
    memberId && Types.ObjectId.isValid(memberId)
      ? new Types.ObjectId(memberId)
      : objectUserId;

  // paidFor validate & parse
  const paidForParsed = (paidFor as any[]).map((p) => {
    if (!p.member || !Types.ObjectId.isValid(p.member))
      throw new ApiError(400, 'Invalid paidFor member');
    if (!p.amount || p.amount <= 0)
      throw new ApiError(400, 'paidFor amount must be > 0');
    return {
      member: new Types.ObjectId(p.member),
      amount: p.amount,
      note: p.note,
    };
  });

  // settlement status নির্ধারণ
  const hasOthers = paidForParsed.length > 0;
  const settlementStatus = hasOthers ? 'pending' : 'not_applicable';

  // transfer হলে toMember দরকার
  if (type === 'transfer') {
    if (!toMember || !Types.ObjectId.isValid(toMember))
      throw new ApiError(400, 'Invalid toMember for transfer');
  }

  const transaction = await Transaction.create({
    business: objectBusinessId,
    type,
    amount,
    category: new Types.ObjectId(category),
    member,
    createdBy: objectUserId,
    note,
    reference,
    date: date ? new Date(date) : new Date(),
    paidFor: paidForParsed,
    splitType,
    toMember: toMember ? new Types.ObjectId(toMember) : null,
    settlementStatus,
    settledAmount: 0,
  });

  const populated = await Transaction.findById(transaction._id)
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
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate)
        filter.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59));
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, parseInt(limit));

    const [transactions, total, summary] = await Promise.all([
      Transaction.find(filter)
        .populate('category', 'name type icon group')
        .populate('member', 'firstName lastName email avatar')
        .populate('toMember', 'firstName lastName email')
        .populate('paidFor.member', 'firstName lastName email')
        .sort({ date: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),

      Transaction.countDocuments(filter),

      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$type',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const income = summary.find((s) => s._id === 'income');
    const expense = summary.find((s) => s._id === 'expense');

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Transactions fetched',
      data: {
        transactions,
        summary: {
          totalIncome: income?.total ?? 0,
          totalExpense: expense?.total ?? 0,
          balance: (income?.total ?? 0) - (expense?.total ?? 0),
          incomeCount: income?.count ?? 0,
          expenseCount: expense?.count ?? 0,
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

/* ─── Pending dues (who owes whom) ───────────────────── */
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

  // pending বা partial transactions যেগুলোতে paidFor আছে
  const transactions = await Transaction.find({
    business: objectBusinessId,
    settlementStatus: { $in: ['pending', 'partial'] },
    'paidFor.0': { $exists: true },
  })
    .populate('member', 'firstName lastName email')
    .populate('paidFor.member', 'firstName lastName email')
    .lean();

  // dues map তৈরি
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
const updateTransaction = asyncHandler(async (req: Request, res, next) => {
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id))
    throw new ApiError(400, 'Invalid id');

  const { objectUserId } = getValidIds(req.user?._id);
  const transaction = await Transaction.findById(id);
  if (!transaction) throw new ApiError(404, 'Transaction not found');

  // creator বা owner/admin
  const isCreator =
    transaction.createdBy.toString() === objectUserId.toString();
  if (!isCreator) {
    await requireMembership(
      transaction.business as Types.ObjectId,
      objectUserId,
      ['owner', 'admin'],
    );
  }

  if (transaction.settlementStatus === 'settled') {
    throw new ApiError(400, 'Cannot edit a fully settled transaction');
  }

  const { type, amount, category, note, date, reference } = req.body;

  const updated = await Transaction.findByIdAndUpdate(
    id,
    {
      ...(type && { type }),
      ...(amount && { amount }),
      ...(category && { category: new Types.ObjectId(category) }),
      ...(note !== undefined && { note }),
      ...(date && { date: new Date(date) }),
      ...(reference !== undefined && { reference }),
    },
    { new: true },
  )
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

const deleteTransaction = asyncHandler(async (req: Request, res, next) => {
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id))
    throw new ApiError(400, 'Invalid id');

  const { objectUserId } = getValidIds(req.user?._id);
  const transaction = await Transaction.findById(id);
  if (!transaction) throw new ApiError(404, 'Transaction not found');

  const isCreator =
    transaction.createdBy.toString() === objectUserId.toString();
  if (!isCreator) {
    await requireMembership(
      transaction.business as Types.ObjectId,
      objectUserId,
      ['owner', 'admin'],
    );
  }

  await Transaction.findByIdAndDelete(id);
  await Settlement.deleteMany({ transaction: id });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transaction deleted',
  });
});

/* ─── Monthly Summary ─────────────────────────────────── */
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

  const { year = String(new Date().getFullYear()) } = req.query as Record<
    string,
    string
  >;

  const data = await Transaction.aggregate([
    {
      $match: {
        business: objectBusinessId,
        date: {
          $gte: new Date(`${year}-01-01`),
          $lte: new Date(`${year}-12-31`),
        },
      },
    },
    {
      $group: {
        _id: { month: { $month: '$date' }, type: '$type' },
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
    data: { year: parseInt(year), months },
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
