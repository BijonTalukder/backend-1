// controllers/purchase.controller.ts
import { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import Purchase from '../models/purchase.model';
import Product from '../models/product.model';
import Supplier from '../models/supplier.model';
import TransactionCategory from '../models/transaction-category.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import { adjustStock } from '../utils/inventory';
import { recordLedgerEntry, balanceDeltaFor } from '../utils/ledger';

interface PurchaseItemInput {
  product: string;
  quantity: number;
  unitPrice?: number;
}

const createPurchase = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const {
    businessId, supplierId, items, discount = 0,
    paidAmount = 0, paymentMethod = 'cash', note, date,
  } = req.body as {
    businessId: string;
    supplierId?: string;
    items: PurchaseItemInput[];
    discount?: number;
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
  if (discount < 0 || paidAmount < 0) {
    throw new ApiError(400, 'Amounts cannot be negative');
  }

  let objectSupplierId: Types.ObjectId | null = null;
  if (supplierId) {
    if (!Types.ObjectId.isValid(supplierId)) throw new ApiError(400, 'Invalid supplier id');
    objectSupplierId = new Types.ObjectId(supplierId);
  }

  const purchaseCategory = await TransactionCategory.findOne({
    business: objectBusinessId,
    name: 'Purchase Cost',
  });
  if (!purchaseCategory) {
    throw new ApiError(500, 'Purchase Cost category missing for this business');
  }

  const session = await mongoose.startSession();
  let purchase;

  try {
    await session.withTransaction(async () => {
      const purchaseItems = [];
      let subtotal = 0;

      for (const item of items) {
        if (!item.product || !Types.ObjectId.isValid(item.product)) {
          throw new ApiError(400, 'Invalid product in purchase items');
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

        const unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : product.purchasePrice;
        if (unitPrice < 0) throw new ApiError(400, 'Unit price cannot be negative');

        const lineTotal = quantity * unitPrice;
        subtotal += lineTotal;

        purchaseItems.push({
          product: product._id,
          productName: product.name,
          quantity,
          unitPrice,
          lineTotal,
        });

        await adjustStock(product._id as any, quantity, session);
      }

      const total = Math.max(0, subtotal - discount);
      if (paidAmount > total) throw new ApiError(400, 'Paid amount cannot exceed total');

      const dueAmount = total - paidAmount;
      if (dueAmount > 0 && !objectSupplierId) {
        throw new ApiError(400, 'Select a supplier to record a due purchase');
      }
      const status = dueAmount === 0 ? 'paid' : paidAmount === 0 ? 'due' : 'partial';

      const referenceNumber = `PUR-${Date.now()}`;

      const created = await Purchase.create(
        [
          {
            business: objectBusinessId,
            referenceNumber,
            supplier: objectSupplierId,
            items: purchaseItems,
            subtotal,
            discount,
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
      purchase = created[0];

      const { cashDelta, bankDelta } = balanceDeltaFor(paymentMethod, -paidAmount);
      const transaction = await recordLedgerEntry(
        {
          business: objectBusinessId!,
          type: 'expense',
          amount: total,
          category: purchaseCategory._id as Types.ObjectId,
          note: `Purchase ${referenceNumber}`,
          reference: referenceNumber,
          createdBy: objectUserId,
          member: objectUserId,
          paymentMethod: paymentMethod as any,
          supplier: objectSupplierId,
          source: { type: 'purchase', id: purchase._id as Types.ObjectId },
          date: purchase.date,
          cashDelta,
          bankDelta,
        },
        session,
      );

      purchase.linkedTransaction = transaction._id as Types.ObjectId;
      await purchase.save({ session });

      if (objectSupplierId) {
        await Supplier.findByIdAndUpdate(
          objectSupplierId,
          { $inc: { totalPurchases: total, totalPaid: paidAmount, totalPayable: dueAmount } },
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }

  const populated = await Purchase.findById(purchase!._id)
    .populate('supplier', 'name phone')
    .populate('items.product', 'name unit')
    .lean();

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Purchase recorded successfully',
    data: populated,
  });
});

const getPurchases = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) throw new ApiError(400, 'Invalid business id');
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { supplierId, status, page = '1', limit = '20' } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = { business: objectBusinessId };
  if (supplierId && Types.ObjectId.isValid(supplierId)) filter.supplier = supplierId;
  if (status) filter.status = status;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const [purchases, total] = await Promise.all([
    Purchase.find(filter)
      .sort({ date: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate('supplier', 'name phone')
      .lean(),
    Purchase.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Purchases fetched successfully',
    data: {
      purchases,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    },
  });
});

const getPurchase = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid purchase id');

  const purchase = await Purchase.findById(id)
    .populate('supplier', 'name phone email address')
    .populate('items.product', 'name unit sku');
  if (!purchase) throw new ApiError(404, 'Purchase not found');

  await requireMembership(purchase.business as any, objectUserId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Purchase fetched successfully',
    data: purchase,
  });
});

export const purchaseController = {
  createPurchase,
  getPurchases,
  getPurchase,
};
