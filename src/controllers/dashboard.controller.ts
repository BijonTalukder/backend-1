// controllers/dashboard.controller.ts
import { Request } from 'express';
import { Types } from 'mongoose';
import Business from '../models/business.model';
import Transaction from '../models/transaction.model';
import Sale from '../models/sale.model';
import Purchase from '../models/purchase.model';
import Expense from '../models/expense.model';
import Customer from '../models/customer.model';
import Supplier from '../models/supplier.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import { resolveDateRange, toLocalIsoDay, MONGO_TZ } from '../utils/timezone';
import { computeProfitLoss } from '../services/profitLoss.service';
import { round2 } from '../utils/money';

const sumField = async (model: any, match: Record<string, unknown>, field: unknown) => {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: field } } }]);
  return round2(rows[0]?.total ?? 0);
};

const getBusinessSummary = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) {
    throw new ApiError(400, 'Invalid business id');
  }
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);
  const biz = objectBusinessId as Types.ObjectId;

  await requireMembership(biz, objectUserId);

  const business = await Business.findById(biz).lean();
  if (!business) throw new ApiError(404, 'Business not found');

  // "Today" and the 7-day chart are Dhaka days; date-fns startOfDay on a UTC
  // server put a 01:00 sale into yesterday.
  const today = resolveDateRange({ preset: 'today' });
  const week = resolveDateRange({ preset: 'last7' });
  const todayDates = { $gte: today.start, $lt: today.endExclusive };

  const [
    todaySales, todayPurchases, todayExpensesRecorded, todayDirectExpenses, profit,
    recentTransactions, salesByDay, receivableAgg, payableAgg,
  ] = await Promise.all([
    // Net of returns (a cancelled sale adds nothing).
    sumField(Sale, { business: biz, date: todayDates }, { $subtract: ['$total', { $ifNull: ['$returnedTotal', 0] }] }),
    sumField(Purchase, { business: biz, date: todayDates }, '$total'),
    sumField(Expense, { business: biz, date: todayDates }, '$amount'),
    sumField(
      Transaction,
      {
        business: biz,
        type: 'expense',
        date: todayDates,
        isAdjustment: { $ne: true },
        $or: [{ source: { $exists: false } }, { source: null }],
      },
      '$amount',
    ),
    computeProfitLoss(biz, today.start, today.endExclusive),
    Transaction.find({ business: biz })
      .sort({ date: -1 })
      .limit(8)
      .populate('category', 'name icon type')
      .lean(),
    Sale.aggregate([
      { $match: { business: biz, date: { $gte: week.start, $lt: week.endExclusive } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: MONGO_TZ } },
          total: { $sum: { $subtract: ['$total', { $ifNull: ['$returnedTotal', 0] }] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Customer.aggregate([
      { $match: { business: biz, status: true } },
      { $group: { _id: null, total: { $sum: '$totalDue' } } },
    ]),
    Supplier.aggregate([
      { $match: { business: biz, status: true } },
      { $group: { _id: null, total: { $sum: '$totalPayable' } } },
    ]),
  ]);

  const totalReceivable = round2(receivableAgg[0]?.total ?? 0);
  const totalPayable = round2(payableAgg[0]?.total ?? 0);

  const salesOverview: { date: string; total: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = toLocalIsoDay(new Date(Date.now() - i * 86400000));
    const found = salesByDay.find((d: { _id: string; total: number }) => d._id === day);
    salesOverview.push({ date: day, total: round2(found?.total ?? 0) });
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business summary fetched successfully',
    data: {
      todaySales,
      todayPurchases,
      todayExpenses: round2(todayExpensesRecorded + todayDirectExpenses),
      totalReceivable,
      totalPayable,
      cashBalance: round2(business.cashBalance ?? 0),
      bankBalance: round2(business.bankBalance ?? 0),
      // Real profit (sales − cost of what was sold − expenses). It used to be
      // sales − purchases − expenses, so buying stock looked like a loss.
      currentProfit: profit.netProfit,
      recentTransactions,
      salesOverview,
    },
  });
});

export const dashboardController = {
  getBusinessSummary,
};
