// controllers/dashboard.controller.ts
import { Request } from 'express';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import Business from '../models/business.model';
import Transaction from '../models/transaction.model';
import Customer from '../models/customer.model';
import Supplier from '../models/supplier.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';

const sumBySourceType = async (
  businessId: any,
  sourceType: 'sale' | 'purchase' | 'expense',
  from: Date,
  to: Date,
) => {
  const result = await Transaction.aggregate([
    {
      $match: {
        business: businessId,
        'source.type': sourceType,
        date: { $gte: from, $lte: to },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return result[0]?.total ?? 0;
};

const getBusinessSummary = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) {
    throw new ApiError(400, 'Invalid business id');
  }
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const business = await Business.findById(objectBusinessId).lean();
  if (!business) throw new ApiError(404, 'Business not found');

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const sevenDaysAgo = startOfDay(subDays(new Date(), 6));

  const [
    todaySales, todayPurchases, todayExpenses, recentTransactions, salesByDay,
    receivableAgg, payableAgg,
  ] = await Promise.all([
    sumBySourceType(objectBusinessId, 'sale', todayStart, todayEnd),
    sumBySourceType(objectBusinessId, 'purchase', todayStart, todayEnd),
    sumBySourceType(objectBusinessId, 'expense', todayStart, todayEnd),
    Transaction.find({ business: objectBusinessId })
      .sort({ date: -1 })
      .limit(8)
      .populate('category', 'name icon type')
      .lean(),
    Transaction.aggregate([
      {
        $match: {
          business: objectBusinessId,
          'source.type': 'sale',
          date: { $gte: sevenDaysAgo, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Customer.aggregate([
      { $match: { business: objectBusinessId, status: true } },
      { $group: { _id: null, total: { $sum: '$totalDue' } } },
    ]),
    Supplier.aggregate([
      { $match: { business: objectBusinessId, status: true } },
      { $group: { _id: null, total: { $sum: '$totalPayable' } } },
    ]),
  ]);

  const totalReceivable = receivableAgg[0]?.total ?? 0;
  const totalPayable = payableAgg[0]?.total ?? 0;

  const salesOverview: { date: string; total: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = format(subDays(new Date(), i), 'yyyy-MM-dd');
    const found = salesByDay.find((d: any) => d._id === day);
    salesOverview.push({ date: day, total: found?.total ?? 0 });
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business summary fetched successfully',
    data: {
      todaySales,
      todayPurchases,
      todayExpenses,
      totalReceivable,
      totalPayable,
      cashBalance: business.cashBalance ?? 0,
      bankBalance: business.bankBalance ?? 0,
      currentProfit: todaySales - todayPurchases - todayExpenses,
      recentTransactions,
      salesOverview,
    },
  });
});

export const dashboardController = {
  getBusinessSummary,
};
