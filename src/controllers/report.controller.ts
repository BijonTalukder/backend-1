// controllers/report.controller.ts
import { Request } from 'express';
import { Types } from 'mongoose';
import Sale from '../models/sale.model';
import Expense from '../models/expense.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';

interface PLBreakdown {
  totalSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

const computeProfitLoss = async (
  businessId: Types.ObjectId,
  from: Date,
  to: Date,
): Promise<PLBreakdown> => {
  const [salesAgg, cogsAgg, expenseAgg] = await Promise.all([
    Sale.aggregate([
      { $match: { business: businessId, date: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Sale.aggregate([
      { $match: { business: businessId, date: { $gte: from, $lte: to } } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDoc',
        },
      },
      { $unwind: '$productDoc' },
      {
        $group: {
          _id: null,
          cogs: { $sum: { $multiply: ['$items.quantity', '$productDoc.purchasePrice'] } },
        },
      },
    ]),
    Expense.aggregate([
      { $match: { business: businessId, date: { $gte: from, $lte: to } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const totalSales = salesAgg[0]?.total ?? 0;
  const costOfGoodsSold = cogsAgg[0]?.cogs ?? 0;
  const expenses = expenseAgg[0]?.total ?? 0;
  const grossProfit = totalSales - costOfGoodsSold;
  const netProfit = grossProfit - expenses;

  return { totalSales, costOfGoodsSold, grossProfit, expenses, netProfit };
};

const getProfitLoss = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) throw new ApiError(400, 'Invalid business id');
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { from, to } = req.query as Record<string, string>;
  if (!from || !to) throw new ApiError(400, 'from and to dates are required');

  const fromDate = new Date(from);
  const toDate = new Date(new Date(to).setHours(23, 59, 59, 999));
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    throw new ApiError(400, 'Invalid date range');
  }

  const rangeMs = toDate.getTime() - fromDate.getTime();
  const prevTo = new Date(fromDate.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - rangeMs);

  const [current, previous] = await Promise.all([
    computeProfitLoss(objectBusinessId!, fromDate, toDate),
    computeProfitLoss(objectBusinessId!, prevFrom, prevTo),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Profit & Loss fetched successfully',
    data: {
      range: { from: fromDate, to: toDate },
      previousRange: { from: prevFrom, to: prevTo },
      current,
      previous,
    },
  });
});

export const reportController = {
  getProfitLoss,
};
