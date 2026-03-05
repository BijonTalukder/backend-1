// controllers/invoice.controller.ts
import { Request } from 'express';
import { Types } from 'mongoose';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import Invoice from '../models/invoice.model';
import Transaction from '../models/transaction.model';

import Business from '../models/business.model';
import { BusinessMembersModel } from '../models/business-members.model';
import TransactionCategory from '../models/transaction-category.model';
import { Meal } from '../models/Meal.model';

/* ── helpers ─────────────────────────────────────────── */
const monthRange = (month: number, year: number) => ({
  start: new Date(year, month - 1, 1, 0, 0, 0),
  end: new Date(year, month, 0, 23, 59, 59, 999),
});

const assertMember = async (
  businessId: Types.ObjectId,
  userId: Types.ObjectId,
) => {
  const m = await BusinessMembersModel.findOne({
    business: businessId,
    user: userId,
    status: true,
  });
  if (!m) throw new ApiError(403, 'Access denied');
  return m;
};

/* ─────────────────────────────────────────────────────────
   POST /api/invoices/:businessId/generate
   Body (standard): { month, year }
   Body (mess):     { month, year, mealCategoryId }
───────────────────────────────────────────────────────── */
const generateInvoice = asyncHandler(async (req: Request, res) => {
  const { businessId } = req.params;
  const { month, year, mealCategoryId } = req.body;
  const userId = req.user?._id;
  console.log(businessId, userId)
  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid business id');
  if (!month || !year || month < 1 || month > 12)
    throw new ApiError(400, 'Valid month (1-12) and year required');

  const objBusinessId = new Types.ObjectId(businessId);
  const objUserId = new Types.ObjectId(String(userId));

  await assertMember(objBusinessId, objUserId);

  const business = await Business.findById(objBusinessId).lean();
  if (!business) throw new ApiError(404, 'Business not found');

  const isMess = business.type === 'mass';
  const { start, end } = monthRange(Number(month), Number(year));

  // ── Fetch all transactions ───────────────────────────
  const transactions = await Transaction.find({
    business: objBusinessId,
    date: { $gte: start, $lte: end },
  })
    .populate('category', 'name')
    .populate('member', 'firstName lastName')
    .lean();

  const txSnapshots = transactions.map((t) => ({
    _id: String(t._id),
    type: t.type,
    amount: t.amount,
    date: t.date,
    categoryName: (t.category as any)?.name ?? 'Unknown',
    note: t.note,
    memberName: (t.member as any)
      ? `${(t.member as any).firstName} ${(t.member as any).lastName}`
      : 'Unknown',
  }));

  const totalIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);
  const netBalance = totalIncome - totalExpense;

  // ── Mess calculation ─────────────────────────────────
  let messFields: Record<string, unknown> = { isMess: false };

  if (isMess && mealCategoryId && Types.ObjectId.isValid(mealCategoryId)) {
    const mealCat = await TransactionCategory.findById(mealCategoryId).lean();
    if (!mealCat) throw new ApiError(404, 'Meal category not found');

    const totalMealCost = transactions
      .filter(
        (t) =>
          t.type === 'expense' &&
          String((t.category as any)?._id) === mealCategoryId,
      )
      .reduce((s, t) => s + t.amount, 0);

    const memberships = await BusinessMembersModel.find({
      business: objBusinessId,
      status: true,
    })
      .populate('user', 'firstName lastName')
      .lean();

    const meals = await Meal.find({
      business: objBusinessId,
      date: { $gte: start, $lte: end },
    }).lean();

    const totalMeals = meals.reduce((s, m) => s + m.count, 0);
    const mealRate = totalMeals > 0 ? totalMealCost / totalMeals : 0;

    const members = memberships.map((ms) => {
      const uid = String((ms.user as any)?._id);
      const name = (ms.user as any)
        ? `${(ms.user as any).firstName} ${(ms.user as any).lastName}`
        : 'Unknown';

      const totalDeposit = transactions
        .filter(
          (t) =>
            t.type === 'income' &&
            String((t.member as any)?._id ?? t.member) === uid,
        )
        .reduce((s, t) => s + t.amount, 0);

      const memberMeals = meals
        .filter((m) => String(m.member) === uid)
        .reduce((s, m) => s + m.count, 0);

      const mealCost = memberMeals * mealRate;

      const otherExpense = transactions
        .filter(
          (t) =>
            t.type === 'expense' &&
            String((t.member as any)?._id ?? t.member) === uid &&
            String((t.category as any)?._id) !== mealCategoryId,
        )
        .reduce((s, t) => s + t.amount, 0);

      const totalCost = mealCost + otherExpense;
      const balance = totalDeposit - totalCost;

      return {
        userId: uid,
        name,
        totalDeposit,
        totalMeals: memberMeals,
        mealCost,
        otherExpense,
        totalCost,
        balance,
      };
    });

    messFields = {
      isMess: true,
      mealCategoryId,
      mealCategoryName: mealCat.name,
      totalMealCost,
      totalMeals,
      mealRate,
      members,
    };
  }

  // ── Upsert (regenerate overwrites) ───────────────────
  const invoice = await Invoice.findOneAndUpdate(
    { business: objBusinessId, month: Number(month), year: Number(year) },
    {
      business: objBusinessId,
      businessName: business.name,
      businessType: business.type,
      month: Number(month),
      year: Number(year),
      generatedBy: objUserId,
      generatedAt: new Date(),
      totalIncome,
      totalExpense,
      netBalance,
      transactions: txSnapshots,
      ...messFields,
    },
    { upsert: true, new: true },
  );

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Invoice generated',
    data: invoice,
  });
});

/* ─────────────────────────────────────────────────────────
   GET /api/invoices/:businessId  — list
───────────────────────────────────────────────────────── */
const listInvoices = asyncHandler(async (req: Request, res) => {
  const { businessId } = req.params;
  const userId = req.user?._id;
  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId)
  )
    throw new ApiError(400, 'Invalid id');

  const objBusinessId = new Types.ObjectId(businessId);
  await assertMember(objBusinessId, new Types.ObjectId(String(userId)));

  const invoices = await Invoice.find({ business: objBusinessId })
    .sort({ year: -1, month: -1 })
    .select('-transactions -members')
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invoices fetched',
    data: invoices,
  });
});

/* ─────────────────────────────────────────────────────────
   GET /api/invoices/:businessId/:invoiceId  — detail
───────────────────────────────────────────────────────── */
const getInvoice = asyncHandler(async (req: Request, res) => {
  const { businessId, invoiceId } = req.params;
  const userId = req.user?._id;
  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId) ||
    !invoiceId ||
    Array.isArray(invoiceId) ||
    !Types.ObjectId.isValid(invoiceId)
  )
    throw new ApiError(400, 'Invalid id');

  const objBusinessId = new Types.ObjectId(businessId);
  await assertMember(objBusinessId, new Types.ObjectId(String(userId)));

  const invoice = await Invoice.findOne({
    _id: invoiceId,
    business: objBusinessId,
  }).lean();
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invoice fetched',
    data: invoice,
  });
});

/* ─────────────────────────────────────────────────────────
   DELETE /api/invoices/:businessId/:invoiceId
───────────────────────────────────────────────────────── */
const deleteInvoice = asyncHandler(async (req: Request, res) => {
  const { businessId, invoiceId } = req.params;
  const userId = req.user?._id;
  if (
    !businessId ||
    Array.isArray(businessId) ||
    !Types.ObjectId.isValid(businessId) ||
    !invoiceId ||
    Array.isArray(invoiceId) ||
    !Types.ObjectId.isValid(invoiceId)
  )
    throw new ApiError(400, 'Invalid id');

  const objBusinessId = new Types.ObjectId(businessId);
  const ms = await BusinessMembersModel.findOne({
    business: objBusinessId,
    user: new Types.ObjectId(String(userId)),
    role: { $in: ['owner', 'admin'] },
  });
  if (!ms) throw new ApiError(403, 'Only owner/admin can delete invoices');

  await Invoice.findOneAndDelete({ _id: invoiceId, business: objBusinessId });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Invoice deleted',
    data: null,
  });
});
export const businessInvoicesController = {
  generateInvoice,
  listInvoices,
  getInvoice,
  deleteInvoice,
};
