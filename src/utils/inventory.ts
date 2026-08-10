// utils/inventory.ts
// Single place stock ever changes from — manual adjustments (this module) and
// Sale/Purchase (later modules) both go through this, so stock math is never
// duplicated across controllers.
import { ClientSession, Types } from 'mongoose';
import Product from '../models/product.model';
import ApiError from '../Error/handleApiError';

export const adjustStock = async (
  productId: Types.ObjectId,
  delta: number,
  session?: ClientSession,
) => {
  const product = await Product.findById(productId).session(session ?? null);
  if (!product) throw new ApiError(404, 'Product not found');

  const nextStock = product.stock + delta;
  if (nextStock < 0) {
    throw new ApiError(400, `Insufficient stock for "${product.name}"`);
  }

  product.stock = nextStock;
  await product.save({ session: session ?? undefined });
  return product;
};
