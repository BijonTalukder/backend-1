// controllers/sale.controller.ts
import { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import Sale from '../models/sale.model';
import Product from '../models/product.model';
import Customer from '../models/customer.model';
import TransactionCategory from '../models/transaction-category.model';
import Business from '../models/business.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import { adjustStock } from '../utils/inventory';
import { recordLedgerEntry, balanceDeltaFor } from '../utils/ledger';

interface SaleItemInput {
  product: string;
  quantity: number;
  unitPrice?: number;
}

const createSale = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const {
    businessId, customerId, items, discount = 0, tax = 0,
    paidAmount = 0, paymentMethod = 'cash', note, date,
  } = req.body as {
    businessId: string;
    customerId?: string;
    items: SaleItemInput[];
    discount?: number;
    tax?: number;
    paidAmount?: number;
    paymentMethod?: string;
    note?: string;
    date?: string;
  };
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one product is required');
  }
  if (discount < 0 || tax < 0 || paidAmount < 0) {
    throw new ApiError(400, 'Amounts cannot be negative');
  }

  let objectCustomerId: Types.ObjectId | null = null;
  if (customerId) {
    if (!Types.ObjectId.isValid(customerId)) throw new ApiError(400, 'Invalid customer id');
    objectCustomerId = new Types.ObjectId(customerId);
  }

  const salesCategory = await TransactionCategory.findOne({
    business: objectBusinessId,
    name: 'Sales Revenue',
  });
  if (!salesCategory) {
    throw new ApiError(500, 'Sales Revenue category missing for this business');
  }

  const session = await mongoose.startSession();
  let sale;

  try {
    await session.withTransaction(async () => {
      const saleItems = [];
      let subtotal = 0;

      for (const item of items) {
        if (!item.product || !Types.ObjectId.isValid(item.product)) {
          throw new ApiError(400, 'Invalid product in sale items');
        }
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new ApiError(400, 'Item quantity must be greater than 0');
        }

        const product = await Product.findOne({
          _id: item.product,
          business: objectBusinessId,
        }).session(session);
        if (!product) throw new ApiError(404, 'Product not found');

        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : product.sellingPrice;
        if (unitPrice < 0) throw new ApiError(400, 'Unit price cannot be negative');

        const lineTotal = quantity * unitPrice;
        subtotal += lineTotal;

        saleItems.push({
          product: product._id,
          productName: product.name,
          quantity,
          unitPrice,
          lineTotal,
        });

        await adjustStock(product._id as any, -quantity, session);
      }

      const total = Math.max(0, subtotal - discount + tax);
      if (paidAmount > total) throw new ApiError(400, 'Paid amount cannot exceed total');

      const dueAmount = total - paidAmount;
      if (dueAmount > 0 && !objectCustomerId) {
        throw new ApiError(400, 'Select a customer to record a due sale');
      }
      const status = dueAmount === 0 ? 'paid' : paidAmount === 0 ? 'due' : 'partial';

      const business = await Business.findById(objectBusinessId).session(session);
      if (!business) throw new ApiError(404, 'Business not found');
      const invoiceNumber = `${business.invoiceSettings.prefix}-${business.invoiceSettings.nextNumber}`;
      business.invoiceSettings.nextNumber += 1;
      await business.save({ session });

      const created = await Sale.create(
        [
          {
            business: objectBusinessId,
            invoiceNumber,
            customer: objectCustomerId,
            items: saleItems,
            subtotal,
            discount,
            tax,
            total,
            paidAmount,
            dueAmount,
            paymentMethod,
            status,
            date: date ? new Date(date) : new Date(),
            note,
            createdBy: objectUserId,
          },
        ],
        { session },
      );
      sale = created[0];

      const { cashDelta, bankDelta } = balanceDeltaFor(paymentMethod, paidAmount);
      const transaction = await recordLedgerEntry(
        {
          business: objectBusinessId!,
          type: 'income',
          amount: total,
          category: salesCategory._id as Types.ObjectId,
          note: `Sale ${invoiceNumber}`,
          reference: invoiceNumber,
          createdBy: objectUserId,
          member: objectUserId,
          paymentMethod: paymentMethod as any,
          customer: objectCustomerId,
          source: { type: 'sale', id: sale._id as Types.ObjectId },
          date: sale.date,
          cashDelta,
          bankDelta,
        },
        session,
      );

      sale.linkedTransaction = transaction._id as Types.ObjectId;
      await sale.save({ session });

      if (objectCustomerId) {
        await Customer.findByIdAndUpdate(
          objectCustomerId,
          { $inc: { totalSales: total, totalPaid: paidAmount, totalDue: dueAmount } },
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }

  const populated = await Sale.findById(sale!._id)
    .populate('customer', 'name phone')
    .populate('items.product', 'name unit')
    .lean();

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Sale recorded successfully',
    data: populated,
  });
});

const getSales = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) throw new ApiError(400, 'Invalid business id');
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { customerId, status, page = '1', limit = '20' } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = { business: objectBusinessId };
  if (customerId && Types.ObjectId.isValid(customerId)) filter.customer = customerId;
  if (status) filter.status = status;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const [sales, total] = await Promise.all([
    Sale.find(filter)
      .sort({ date: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('customer', 'name phone')
      .lean(),
    Sale.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Sales fetched successfully',
    data: {
      sales,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    },
  });
});

const getSale = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid sale id');

  const sale = await Sale.findById(id)
    .populate('customer', 'name phone email address')
    .populate('items.product', 'name unit sku')
    .populate('business', 'name phone address logoUrl currency');
  if (!sale) throw new ApiError(404, 'Sale not found');

  await requireMembership(sale.business as any, objectUserId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Sale fetched successfully',
    data: sale,
  });
});

export const saleController = {
  createSale,
  getSales,
  getSale,
};
