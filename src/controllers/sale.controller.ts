// controllers/sale.controller.ts
import { Request } from 'express';
import { planSaleReturn } from '../utils/saleReturn';
import { round2, toAmount, toQuantity } from '../utils/money';
import { statusFor } from '../utils/allocate';
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
import { recordLedgerEntry, balanceDeltaFor, sanitizeAttachmentUrl } from '../utils/ledger';
import {
  claimOperation,
  findReplay,
  parseClientObjectId,
  parseOperationId,
} from '../utils/idempotency';

interface SaleItemInput {
  product: string;
  quantity: number;
  unitPrice?: number;
}

const createSale = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const {
    businessId, customerId, items, discount = 0, tax = 0,
    paidAmount = 0, paymentMethod = 'cash', note, date, attachmentUrl: rawAttachmentUrl,
    clientId, operationId,
  } = req.body as {
    businessId: string;
    customerId?: string;
    items: SaleItemInput[];
    discount?: number;
    tax?: number;
    paidAmount?: number;
    paymentMethod?: string;
    note?: string;
    attachmentUrl?: string;
    date?: string;
    clientId?: string;
    operationId?: string;
  };
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);
  const attachmentUrl = sanitizeAttachmentUrl(rawAttachmentUrl);

  await requireMembership(objectBusinessId!, objectUserId);

  // ── Offline replay guard ─────────────────────────────
  // A queued sale whose response never reached the client is retried with the
  // same operationId. Return the sale that was already recorded rather than
  // ringing it up (and decrementing stock) a second time.
  const clientSaleId = parseClientObjectId(clientId, 'sale id');
  const syncOperationId = parseOperationId(operationId);
  if (syncOperationId && !clientSaleId) {
    throw new ApiError(400, 'clientId is required when operationId is sent');
  }

  const replayedId = await findReplay(Sale, objectBusinessId!, syncOperationId);
  if (replayedId) {
    const replayed = await Sale.findById(replayedId)
      .populate('customer', 'name phone')
      .populate('items.product', 'name unit')
      .lean();
    return sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Sale already recorded',
      data: replayed,
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'At least one product is required');
  }
  // Cast once, here: "5" + 0 is "50" in JS, so a string tax used to be
  // concatenated onto the total (100 - 10 + "5" = "905").
  const parsedDiscount = toAmount(discount, 'Discount');
  const parsedTax = toAmount(tax, 'Tax');
  const parsedPaid = toAmount(paidAmount, 'Paid amount');

  let objectCustomerId: Types.ObjectId | null = null;
  if (customerId) {
    if (typeof customerId !== 'string' || !Types.ObjectId.isValid(customerId)) {
      throw new ApiError(400, 'Invalid customer id');
    }
    objectCustomerId = new Types.ObjectId(customerId);
    // Another business's customer id used to be accepted and its due increased.
    const owned = await Customer.exists({ _id: objectCustomerId, business: objectBusinessId, status: true });
    if (!owned) throw new ApiError(404, 'Customer not found in this business');
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
        const quantity = toQuantity(item.quantity, 'Item quantity');

        const product = await Product.findOne({
          _id: item.product,
          business: objectBusinessId,
        }).session(session);
        if (!product) throw new ApiError(404, 'Product not found');

        const unitPrice = toAmount(item.unitPrice, 'Unit price', { fallback: product.sellingPrice });

        const lineTotal = round2(quantity * unitPrice);
        subtotal = round2(subtotal + lineTotal);

        saleItems.push({
          product: product._id,
          productName: product.name,
          quantity,
          unitPrice,
          lineTotal,
          // Cost at the moment of sale, so editing the cost price later can't rewrite past profit.
          unitCost: round2(product.purchasePrice ?? 0),
          returnedQuantity: 0,
        });

        await adjustStock(product._id as any, -quantity, session);
      }

      if (parsedDiscount > subtotal) throw new ApiError(400, 'Discount cannot be more than the subtotal');
      const total = round2(subtotal - parsedDiscount + parsedTax);
      if (parsedPaid > total) throw new ApiError(400, 'Paid amount cannot exceed total');

      const dueAmount = round2(total - parsedPaid);
      if (dueAmount > 0 && !objectCustomerId) {
        throw new ApiError(400, 'Select a customer to record a due sale');
      }
      const status = statusFor(parsedPaid, dueAmount);

      const business = await Business.findById(objectBusinessId).session(session);
      if (!business) throw new ApiError(404, 'Business not found');
      const invoiceNumber = `${business.invoiceSettings.prefix}-${business.invoiceSettings.nextNumber}`;
      business.invoiceSettings.nextNumber += 1;
      await business.save({ session });

      const created = await Sale.create(
        [
          {
            ...(clientSaleId ? { _id: clientSaleId } : {}),
            business: objectBusinessId,
            invoiceNumber,
            customer: objectCustomerId,
            items: saleItems,
            subtotal,
            discount: parsedDiscount,
            tax: parsedTax,
            total,
            paidAmount: parsedPaid,
            dueAmount,
            paymentMethod,
            status,
            date: date ? new Date(date) : new Date(),
            note,
            attachmentUrl,
            createdBy: objectUserId,
          },
        ],
        { session },
      );
      sale = created[0];

      const { cashDelta, bankDelta } = balanceDeltaFor(paymentMethod, parsedPaid);
      const transaction = await recordLedgerEntry(
        {
          business: objectBusinessId!,
          type: 'income',
          amount: total,
          category: salesCategory._id as Types.ObjectId,
          note: `Sale ${invoiceNumber}`,
          reference: invoiceNumber,
          attachmentUrl,
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
        await Customer.findOneAndUpdate(
          { _id: objectCustomerId, business: objectBusinessId },
          { $inc: { totalSales: total, totalPaid: parsedPaid, totalDue: dueAmount } },
          { session },
        );
      }

      // Claimed inside the transaction so the claim and the sale commit together.
      await claimOperation(
        {
          business: objectBusinessId!,
          operationId: syncOperationId,
          entityType: 'sale',
          entity: sale._id as Types.ObjectId,
          createdBy: objectUserId,
        },
        session,
      );
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

/* ─── Return / cancel ─────────────────────────────────────
   POST /sales/:id/return  { items?: [{ product, quantity }], refundMethod?, note? }
   No `items` = cancel: everything not yet returned comes back.
   Stock goes back up, the customer's due drops first and only the rest is
   refunded, and a "Sales Return" expense entry takes the refund out of the
   cash/bank balance. Owner/admin only: it hands money back. */
const RETURN_METHODS = ['cash', 'bank', 'bkash', 'nagad', 'other'];

const returnSale = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid sale id');
  const { items, refundMethod: rawMethod, note } = req.body ?? {};

  const session = await mongoose.startSession();
  let saleId: Types.ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      const sale = await Sale.findById(id).session(session);
      if (!sale) throw new ApiError(404, 'Sale not found');
      saleId = sale._id as Types.ObjectId;
      const business = sale.business as Types.ObjectId;
      await requireMembership(business, objectUserId, ['owner', 'admin']);
      if (sale.status === 'cancelled') throw new ApiError(400, 'This sale is already cancelled');

      const plan = planSaleReturn(sale, items === undefined ? null : items);
      const refundMethod = RETURN_METHODS.includes(rawMethod) ? rawMethod : sale.paymentMethod || 'cash';

      for (const line of plan.lines) {
        await adjustStock(new Types.ObjectId(line.product), line.quantity, session);
        const item = sale.items[line.index];
        item.returnedQuantity = round2((item.returnedQuantity ?? 0) + line.quantity);
      }

      sale.returnedTotal = round2((sale.returnedTotal ?? 0) + plan.amount);
      sale.dueAmount = round2(sale.dueAmount - plan.dueReduced);
      sale.paidAmount = round2(sale.paidAmount - plan.refunded);
      sale.status = plan.fullyReturned ? 'cancelled' : statusFor(sale.paidAmount, sale.dueAmount);

      if (sale.customer) {
        await Customer.updateOne(
          { _id: sale.customer, business },
          { $inc: { totalSales: -plan.amount, totalDue: -plan.dueReduced, totalPaid: -plan.refunded } },
          { session },
        );
      }

      let category = await TransactionCategory.findOne({ business, name: 'Sales Return' }).session(session);
      if (!category) {
        [category] = await TransactionCategory.create(
          [{ business, name: 'Sales Return', type: 'expense', group: 'business', icon: '↩️' }],
          { session },
        );
      }

      const label = plan.fullyReturned ? `Cancelled ${sale.invoiceNumber}` : `Return on ${sale.invoiceNumber}`;
      const { cashDelta, bankDelta } = balanceDeltaFor(refundMethod, -plan.refunded);
      const transaction = await recordLedgerEntry(
        {
          business,
          type: 'expense',
          amount: plan.amount,
          category: category!._id as Types.ObjectId,
          note: typeof note === 'string' && note.trim() ? note.trim() : label,
          reference: sale.invoiceNumber,
          createdBy: objectUserId,
          member: objectUserId,
          paymentMethod: refundMethod,
          customer: (sale.customer as Types.ObjectId) ?? null,
          source: { type: 'sale', id: sale._id as Types.ObjectId },
          cashDelta,
          bankDelta,
        },
        session,
      );

      sale.returns.push({
        date: new Date(),
        items: plan.lines.map((l) => ({
          product: new Types.ObjectId(l.product),
          productName: l.productName,
          quantity: l.quantity,
          amount: l.amount,
        })),
        amount: plan.amount,
        dueReduced: plan.dueReduced,
        refunded: plan.refunded,
        refundMethod,
        note: typeof note === 'string' ? note.trim() || undefined : undefined,
        createdBy: objectUserId,
        linkedTransaction: transaction._id as Types.ObjectId,
      });
      await sale.save({ session });
    });
  } finally {
    await session.endSession();
  }

  const updated = await Sale.findById(saleId)
    .populate('customer', 'name phone email address')
    .populate('items.product', 'name unit sku')
    .lean();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: updated?.status === 'cancelled' ? 'Sale cancelled' : 'Return recorded',
    data: updated,
  });
});

export const saleController = {
  createSale,
  getSales,
  getSale,
  returnSale,
};
