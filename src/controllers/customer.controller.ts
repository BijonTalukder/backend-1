// controllers/customer.controller.ts
import { Request } from 'express';
import { Types } from 'mongoose';
import Customer from '../models/customer.model';
import Transaction from '../models/transaction.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import {
  claimOperation,
  findReplay,
  parseClientObjectId,
  parseOperationId,
} from '../utils/idempotency';

const createCustomer = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const {
    businessId, name, phone, email, address, openingBalance, notes,
    clientId, operationId,
  } = req.body;
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  // Replay of a queued offline create — hand back the customer already stored.
  const clientCustomerId = parseClientObjectId(clientId, 'customer id');
  const syncOperationId = parseOperationId(operationId);
  if (syncOperationId && !clientCustomerId) {
    throw new ApiError(400, 'clientId is required when operationId is sent');
  }

  const replayedId = await findReplay(Customer, objectBusinessId!, syncOperationId);
  if (replayedId) {
    return sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Customer already created',
      data: await Customer.findById(replayedId),
    });
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'Customer name is required');
  }

  const parsedOpeningBalance = Number(openingBalance) || 0;
  if (parsedOpeningBalance < 0) {
    throw new ApiError(400, 'Opening balance cannot be negative');
  }

  const customer = await Customer.create({
    ...(clientCustomerId ? { _id: clientCustomerId } : {}),
    business: objectBusinessId,
    name: name.trim(),
    phone,
    email,
    address,
    notes,
    openingBalance: parsedOpeningBalance,
    totalDue: parsedOpeningBalance,
    createdBy: objectUserId,
  });

  await claimOperation({
    business: objectBusinessId!,
    operationId: syncOperationId,
    entityType: 'customer',
    entity: customer._id as Types.ObjectId,
    createdBy: objectUserId,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Customer created successfully',
    data: customer,
  });
});

const getCustomers = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) {
    throw new ApiError(400, 'Invalid business id');
  }
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { search } = req.query;
  const filter: Record<string, unknown> = { business: objectBusinessId, status: true };
  if (search && typeof search === 'string') {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const customers = await Customer.find(filter).sort({ name: 1 }).lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Customers fetched successfully',
    data: customers,
  });
});

const getCustomer = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid customer id');
  }

  const customer = await Customer.findById(id);
  if (!customer) throw new ApiError(404, 'Customer not found');

  await requireMembership(customer.business, objectUserId);

  const transactions = await Transaction.find({ customer: customer._id })
    .sort({ date: -1 })
    .limit(50)
    .populate('category', 'name icon type')
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Customer fetched successfully',
    data: { customer, transactions },
  });
});

const updateCustomer = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid customer id');
  }

  const customer = await Customer.findById(id);
  if (!customer) throw new ApiError(404, 'Customer not found');

  await requireMembership(customer.business, objectUserId, ['owner', 'admin']);

  const { name, phone, email, address, openingBalance, notes } = req.body;
  if (name !== undefined) customer.name = name;
  if (phone !== undefined) customer.phone = phone;
  if (email !== undefined) customer.email = email;
  if (address !== undefined) customer.address = address;
  if (notes !== undefined) customer.notes = notes;
  if (openingBalance !== undefined && Number(openingBalance) !== customer.openingBalance) {
    const parsedOpeningBalance = Number(openingBalance) || 0;
    if (parsedOpeningBalance < 0) {
      throw new ApiError(400, 'Opening balance cannot be negative');
    }
    // Only safe to change before any sales/payments exist — afterwards it would
    // silently rewrite the ledger-backed history behind totalDue.
    const hasActivity = customer.totalSales > 0 || customer.totalPaid > 0;
    if (hasActivity) {
      throw new ApiError(
        400,
        'Opening balance can no longer be changed after sales or payments have been recorded',
      );
    }
    // totalDue = openingBalance when nothing has been bought or paid yet.
    customer.totalDue = parsedOpeningBalance;
    customer.openingBalance = parsedOpeningBalance;
  }

  await customer.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Customer updated successfully',
    data: customer,
  });
});

const deleteCustomer = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid customer id');
  }

  const customer = await Customer.findById(id);
  if (!customer) throw new ApiError(404, 'Customer not found');

  await requireMembership(customer.business, objectUserId, ['owner', 'admin']);

  customer.status = false;
  await customer.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Customer deleted successfully',
  });
});

export const customerController = {
  createCustomer,
  getCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
};
