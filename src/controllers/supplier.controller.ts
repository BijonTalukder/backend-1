// controllers/supplier.controller.ts
import { Request } from 'express';
import { Types } from 'mongoose';
import Supplier from '../models/supplier.model';
import Transaction from '../models/transaction.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';

const createSupplier = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { businessId, name, phone, email, address, openingBalance, notes } = req.body;
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'Supplier name is required');
  }

  const parsedOpeningBalance = Number(openingBalance) || 0;
  if (parsedOpeningBalance < 0) {
    throw new ApiError(400, 'Opening balance cannot be negative');
  }

  const supplier = await Supplier.create({
    business: objectBusinessId,
    name: name.trim(),
    phone,
    email,
    address,
    notes,
    openingBalance: parsedOpeningBalance,
    totalPayable: parsedOpeningBalance,
    createdBy: objectUserId,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Supplier created successfully',
    data: supplier,
  });
});

const getSuppliers = asyncHandler(async (req: Request, res) => {
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

  const suppliers = await Supplier.find(filter).sort({ name: 1 }).lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Suppliers fetched successfully',
    data: suppliers,
  });
});

const getSupplier = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid supplier id');
  }

  const supplier = await Supplier.findById(id);
  if (!supplier) throw new ApiError(404, 'Supplier not found');

  await requireMembership(supplier.business, objectUserId);

  const transactions = await Transaction.find({ supplier: supplier._id })
    .sort({ date: -1 })
    .limit(50)
    .populate('category', 'name icon type')
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Supplier fetched successfully',
    data: { supplier, transactions },
  });
});

const updateSupplier = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid supplier id');
  }

  const supplier = await Supplier.findById(id);
  if (!supplier) throw new ApiError(404, 'Supplier not found');

  await requireMembership(supplier.business, objectUserId, ['owner', 'admin']);

  const { name, phone, email, address, openingBalance, notes } = req.body;
  if (name !== undefined) supplier.name = name;
  if (phone !== undefined) supplier.phone = phone;
  if (email !== undefined) supplier.email = email;
  if (address !== undefined) supplier.address = address;
  if (notes !== undefined) supplier.notes = notes;
  if (openingBalance !== undefined && Number(openingBalance) !== supplier.openingBalance) {
    const parsedOpeningBalance = Number(openingBalance) || 0;
    if (parsedOpeningBalance < 0) {
      throw new ApiError(400, 'Opening balance cannot be negative');
    }
    // Only safe to change before any purchases/payments exist — afterwards it
    // would silently rewrite the ledger-backed history behind totalPayable.
    const hasActivity = supplier.totalPurchases > 0 || supplier.totalPaid > 0;
    if (hasActivity) {
      throw new ApiError(
        400,
        'Opening balance can no longer be changed after purchases or payments have been recorded',
      );
    }
    // totalPayable = openingBalance when nothing has been bought or paid yet.
    supplier.totalPayable = parsedOpeningBalance;
    supplier.openingBalance = parsedOpeningBalance;
  }

  await supplier.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Supplier updated successfully',
    data: supplier,
  });
});

const deleteSupplier = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid supplier id');
  }

  const supplier = await Supplier.findById(id);
  if (!supplier) throw new ApiError(404, 'Supplier not found');

  await requireMembership(supplier.business, objectUserId, ['owner', 'admin']);

  supplier.status = false;
  await supplier.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Supplier deleted successfully',
  });
});

export const supplierController = {
  createSupplier,
  getSuppliers,
  getSupplier,
  updateSupplier,
  deleteSupplier,
};
