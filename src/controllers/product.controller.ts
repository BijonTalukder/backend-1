// controllers/product.controller.ts
import { Request } from 'express';
import mongoose, { Types } from 'mongoose';
import Product from '../models/product.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import { adjustStock } from '../utils/inventory';
import {
  claimOperation,
  findReplay,
  parseClientObjectId,
  parseOperationId,
} from '../utils/idempotency';

const createProduct = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const {
    businessId, name, sku, category,
    purchasePrice, sellingPrice, stock, minStock, unit, imageUrl,
    clientId, operationId,
  } = req.body;
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  // Replay of a queued offline create — hand back the product already stored.
  const clientProductId = parseClientObjectId(clientId, 'product id');
  const syncOperationId = parseOperationId(operationId);
  if (syncOperationId && !clientProductId) {
    throw new ApiError(400, 'clientId is required when operationId is sent');
  }

  const replayedId = await findReplay(Product, objectBusinessId!, syncOperationId);
  if (replayedId) {
    return sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Product already created',
      data: await Product.findById(replayedId),
    });
  }

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'Product name is required');
  }

  const parsedStock = Number(stock) || 0;
  const parsedMinStock = Number(minStock) || 0;
  if (parsedStock < 0 || parsedMinStock < 0) {
    throw new ApiError(400, 'Stock values cannot be negative');
  }

  const product = await Product.create({
    ...(clientProductId ? { _id: clientProductId } : {}),
    business: objectBusinessId,
    name: name.trim(),
    sku,
    category,
    purchasePrice: Number(purchasePrice) || 0,
    sellingPrice: Number(sellingPrice) || 0,
    stock: parsedStock,
    minStock: parsedMinStock,
    unit: unit || 'pcs',
    imageUrl,
    createdBy: objectUserId,
  });

  await claimOperation({
    business: objectBusinessId!,
    operationId: syncOperationId,
    entityType: 'product',
    entity: product._id as Types.ObjectId,
    createdBy: objectUserId,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Product created successfully',
    data: product,
  });
});

const getProducts = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) {
    throw new ApiError(400, 'Invalid business id');
  }
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { search, lowStock } = req.query;
  const filter: Record<string, unknown> = { business: objectBusinessId, status: true };
  if (search && typeof search === 'string') {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }

  let products = await Product.find(filter).sort({ name: 1 }).lean();

  if (lowStock === 'true') {
    products = products.filter((p) => p.stock <= p.minStock);
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Products fetched successfully',
    data: products,
  });
});

const getProduct = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid product id');
  }

  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'Product not found');

  await requireMembership(product.business, objectUserId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Product fetched successfully',
    data: product,
  });
});

const updateProduct = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid product id');
  }

  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'Product not found');

  await requireMembership(product.business, objectUserId, ['owner', 'admin']);

  const { name, sku, category, purchasePrice, sellingPrice, minStock, unit, imageUrl } = req.body;
  if (name !== undefined) product.name = name;
  if (sku !== undefined) product.sku = sku;
  if (category !== undefined) product.category = category;
  if (purchasePrice !== undefined) product.purchasePrice = Number(purchasePrice) || 0;
  if (sellingPrice !== undefined) product.sellingPrice = Number(sellingPrice) || 0;
  if (minStock !== undefined) product.minStock = Number(minStock) || 0;
  if (unit !== undefined) product.unit = unit;
  if (imageUrl !== undefined) product.imageUrl = imageUrl;

  await product.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Product updated successfully',
    data: product,
  });
});

const adjustProductStock = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid product id');
  }

  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'Product not found');

  await requireMembership(product.business, objectUserId);

  const { type, quantity, operationId } = req.body as {
    type: 'increase' | 'decrease' | 'set';
    quantity: number;
    operationId?: string;
  };
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new ApiError(400, 'A valid quantity is required');
  }

  // A stock adjustment is the one write here with no document of its own, so a
  // blind retry would apply the delta twice. The operation ledger is what makes
  // it safe to replay.
  const syncOperationId = parseOperationId(operationId);
  if (syncOperationId) {
    const replayedId = await findReplay(Product, product.business, syncOperationId);
    if (replayedId) {
      return sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Stock already adjusted',
        data: await Product.findById(replayedId),
      });
    }
  }

  let delta = 0;
  if (type === 'increase') delta = qty;
  else if (type === 'decrease') delta = -qty;
  else if (type === 'set') delta = qty - product.stock;
  else throw new ApiError(400, 'Invalid adjustment type');

  let updated;
  if (syncOperationId) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        updated = await adjustStock(product._id as any, delta, session);
        await claimOperation(
          {
            business: product.business,
            operationId: syncOperationId,
            entityType: 'stock_adjustment',
            entity: product._id as Types.ObjectId,
            createdBy: objectUserId,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  } else {
    updated = await adjustStock(product._id as any, delta);
  }

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Stock adjusted successfully',
    data: updated,
  });
});

const deleteProduct = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { id } = req.params;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid product id');
  }

  const product = await Product.findById(id);
  if (!product) throw new ApiError(404, 'Product not found');

  await requireMembership(product.business, objectUserId, ['owner', 'admin']);

  product.status = false;
  await product.save();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Product deleted successfully',
  });
});

export const productController = {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  adjustProductStock,
  deleteProduct,
};
