// controllers/payment.controller.ts
import { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import Payment from '../models/payment.model';
import Customer from '../models/customer.model';
import Supplier from '../models/supplier.model';
import TransactionCategory from '../models/transaction-category.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import { recordLedgerEntry, balanceDeltaFor } from '../utils/ledger';

const findOrCreatePaymentCategory = async (
  businessId: Types.ObjectId,
  name: 'Customer Payment' | 'Supplier Payment',
  type: 'income' | 'expense',
  session: mongoose.ClientSession,
) => {
  let category = await TransactionCategory.findOne({ business: businessId, name }).session(session);
  if (!category) {
    const created = await TransactionCategory.create(
      [{ business: businessId, name, type, group: 'business', icon: type === 'income' ? '💵' : '💸' }],
      { session },
    );
    category = created[0];
  }
  return category;
};

const receivePayment = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { businessId, customerId, amount, method = 'cash', note, date } = req.body;
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  if (!customerId || !Types.ObjectId.isValid(customerId)) {
    throw new ApiError(400, 'A valid customer is required');
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new ApiError(400, 'A valid amount is required');
  }

  const session = await mongoose.startSession();
  let payment;

  try {
    await session.withTransaction(async () => {
      const customer = await Customer.findOne({ _id: customerId, business: objectBusinessId }).session(session);
      if (!customer) throw new ApiError(404, 'Customer not found');
      if (parsedAmount > customer.totalDue) {
        throw new ApiError(400, 'Payment cannot exceed the outstanding due');
      }

      const category = await findOrCreatePaymentCategory(objectBusinessId!, 'Customer Payment', 'income', session);

      const created = await Payment.create(
        [
          {
            business: objectBusinessId,
            direction: 'in',
            partyType: 'customer',
            partyModel: 'Customer',
            party: customer._id,
            amount: parsedAmount,
            method,
            note,
            date: date ? new Date(date) : new Date(),
            createdBy: objectUserId,
          },
        ],
        { session },
      );
      payment = created[0];

      const { cashDelta, bankDelta } = balanceDeltaFor(method, parsedAmount);
      const transaction = await recordLedgerEntry(
        {
          business: objectBusinessId!,
          type: 'income',
          amount: parsedAmount,
          category: category._id as Types.ObjectId,
          note: note || `Payment from ${customer.name}`,
          createdBy: objectUserId,
          member: objectUserId,
          paymentMethod: method,
          customer: customer._id as Types.ObjectId,
          source: { type: 'payment', id: payment._id as Types.ObjectId },
          date: payment.date,
          cashDelta,
          bankDelta,
        },
        session,
      );

      payment.linkedTransaction = transaction._id as Types.ObjectId;
      await payment.save({ session });

      await Customer.findByIdAndUpdate(
        customer._id,
        { $inc: { totalPaid: parsedAmount, totalDue: -parsedAmount } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Payment received successfully',
    data: payment,
  });
});

const makePayment = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { businessId, supplierId, amount, method = 'cash', note, date } = req.body;
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  if (!supplierId || !Types.ObjectId.isValid(supplierId)) {
    throw new ApiError(400, 'A valid supplier is required');
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new ApiError(400, 'A valid amount is required');
  }

  const session = await mongoose.startSession();
  let payment;

  try {
    await session.withTransaction(async () => {
      const supplier = await Supplier.findOne({ _id: supplierId, business: objectBusinessId }).session(session);
      if (!supplier) throw new ApiError(404, 'Supplier not found');
      if (parsedAmount > supplier.totalPayable) {
        throw new ApiError(400, 'Payment cannot exceed the outstanding payable');
      }

      const category = await findOrCreatePaymentCategory(objectBusinessId!, 'Supplier Payment', 'expense', session);

      const created = await Payment.create(
        [
          {
            business: objectBusinessId,
            direction: 'out',
            partyType: 'supplier',
            partyModel: 'Supplier',
            party: supplier._id,
            amount: parsedAmount,
            method,
            note,
            date: date ? new Date(date) : new Date(),
            createdBy: objectUserId,
          },
        ],
        { session },
      );
      payment = created[0];

      const { cashDelta, bankDelta } = balanceDeltaFor(method, -parsedAmount);
      const transaction = await recordLedgerEntry(
        {
          business: objectBusinessId!,
          type: 'expense',
          amount: parsedAmount,
          category: category._id as Types.ObjectId,
          note: note || `Payment to ${supplier.name}`,
          createdBy: objectUserId,
          member: objectUserId,
          paymentMethod: method,
          supplier: supplier._id as Types.ObjectId,
          source: { type: 'payment', id: payment._id as Types.ObjectId },
          date: payment.date,
          cashDelta,
          bankDelta,
        },
        session,
      );

      payment.linkedTransaction = transaction._id as Types.ObjectId;
      await payment.save({ session });

      await Supplier.findByIdAndUpdate(
        supplier._id,
        { $inc: { totalPaid: parsedAmount, totalPayable: -parsedAmount } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Payment made successfully',
    data: payment,
  });
});

const getPayments = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) throw new ApiError(400, 'Invalid business id');
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { direction, page = '1', limit = '20' } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = { business: objectBusinessId };
  if (direction) filter.direction = direction;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ date: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('party', 'name phone')
      .lean(),
    Payment.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Payments fetched successfully',
    data: {
      payments,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    },
  });
});

export const paymentController = {
  receivePayment,
  makePayment,
  getPayments,
};
