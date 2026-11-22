// services/profitLoss.service.ts
// The one profit formula, shared by the P&L report and the dashboard.
import { Types } from 'mongoose';
import Sale from '../models/sale.model';
import Expense from '../models/expense.model';
import Transaction from '../models/transaction.model';
import { round2 } from '../utils/money';

export interface PLBreakdown {
  totalSales: number;
  costOfGoodsSold: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

/**
 * Profit for [from, toExclusive).
 * - Sales are net of returns (a cancelled sale contributes 0).
 * - COGS uses each line's cost at the time of sale (`unitCost`); sales made
 *   before that was stored fall back to the product's current cost.
 * - Expenses are Expense records plus income/expense entries typed in
 *   directly (no source, not the opening balance), the same set the AI uses.
 */
export const computeProfitLoss = async (
  businessId: Types.ObjectId,
  from: Date,
  toExclusive: Date,
): Promise<PLBreakdown> => {
  const dateMatch = { $gte: from, $lt: toExclusive };
  const [salesAgg, cogsAgg, expenseAgg, directAgg] = await Promise.all([
    Sale.aggregate([
      { $match: { business: businessId, date: dateMatch } },
      {
        $group: {
          _id: null,
          total: { $sum: { $subtract: ['$total', { $ifNull: ['$returnedTotal', 0] }] } },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { business: businessId, date: dateMatch } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'productDoc',
        },
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          cogs: {
            $sum: {
              $multiply: [
                { $subtract: ['$items.quantity', { $ifNull: ['$items.returnedQuantity', 0] }] },
                { $ifNull: ['$items.unitCost', { $ifNull: ['$productDoc.purchasePrice', 0] }] },
              ],
            },
          },
        },
      },
    ]),
    Expense.aggregate([
      { $match: { business: businessId, date: dateMatch } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      {
        $match: {
          business: businessId,
          type: 'expense',
          date: dateMatch,
          isAdjustment: { $ne: true },
          $or: [{ source: { $exists: false } }, { source: null }],
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const totalSales = round2(salesAgg[0]?.total ?? 0);
  const costOfGoodsSold = round2(cogsAgg[0]?.cogs ?? 0);
  const expenses = round2((expenseAgg[0]?.total ?? 0) + (directAgg[0]?.total ?? 0));
  const grossProfit = round2(totalSales - costOfGoodsSold);
  const netProfit = round2(grossProfit - expenses);
  return { totalSales, costOfGoodsSold, grossProfit, expenses, netProfit };
};
