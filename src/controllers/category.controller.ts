import { Types } from 'mongoose';
import Category from '../models/category.model';
import Product from '../models/product.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';

const createCategory = asyncHandler(async (req, res, next) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { name, businessId, ...rest } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'Category name is required');
  }

  const trimmedName = name.trim();
  let businessObjectId: Types.ObjectId | null = null;

  if (businessId && typeof businessId === 'string') {
    const { objectBusinessId } = getValidIds(req.user?._id, businessId);
    businessObjectId = objectBusinessId!;
    await requireMembership(businessObjectId, objectUserId);

    const escaped = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Category.findOne({
      business: businessObjectId,
      name: { $regex: new RegExp(`^${escaped}$`, 'i') },
      status: true,
    });

    if (existing) {
      return sendResponse(res, {
        statusCode: 200,
        success: true,
        message: 'Category already exists',
        data: existing,
      });
    }
  }

  const category = await Category.create({
    ...rest,
    name: trimmedName,
    business: businessObjectId,
    status: true,
    createdBy: objectUserId,
  });

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Category created successfully',
    data: category,
  });
});

const getCategoriesByBusiness = asyncHandler(async (req, res, next) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const paramBizId = req.params.businessId;
  const businessId = Array.isArray(paramBizId) ? paramBizId[0] : paramBizId;

  if (!businessId) {
    throw new ApiError(400, 'Invalid business id');
  }

  const { objectBusinessId } = getValidIds(req.user?._id, businessId);
  await requireMembership(objectBusinessId!, objectUserId);

  // 1. Fetch categories from Category model
  const categories = await Category.find({
    business: objectBusinessId,
    status: true,
  })
    .sort({ name: 1 })
    .lean();

  // 2. Fetch distinct product categories from Product model for backwards compatibility
  const productCategories: string[] = await Product.distinct('category', {
    business: objectBusinessId,
    status: true,
    category: { $nin: ['', null] },
  });

  const seen = new Set(categories.map((c) => c.name.toLowerCase()));
  const extraCategories = [];

  for (const catName of productCategories) {
    if (catName && !seen.has(catName.trim().toLowerCase())) {
      extraCategories.push({
        _id: catName.trim(),
        name: catName.trim(),
        business: objectBusinessId,
        status: true,
      });
      seen.add(catName.trim().toLowerCase());
    }
  }

  const allCategories = [...categories, ...extraCategories].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Categories fetched successfully',
    data: allCategories,
  });
});

const getAllCategories = asyncHandler(async (req, res, next) => {
  const categories = await Category.find({});
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Categories fetched successfully',
    data: categories,
  });
});

const getAllActiveCategories = asyncHandler(async (req, res, next) => {
  const categories = await Category.find({ status: true });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Active categories fetched successfully',
    data: categories,
  });
});

const getMyCategories = asyncHandler(async (req, res, next) => {
  const userId = req.user?._id;
  const categories = await Category.find({
    status: true,
    $or: [
      { createdBy: userId },
      { createdBy: null },
    ],
  });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'My categories fetched successfully',
    data: categories,
  });
});

const updateCategory = asyncHandler(async (req, res, next) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Category updated successfully',
    data: category,
  });
});

const deleteCategory = asyncHandler(async (req, res, next) => {
  await Category.findByIdAndUpdate(req.params.id, { status: false });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Category deleted successfully',
  });
});

export const categoryController = {
  createCategory,
  getCategoriesByBusiness,
  getAllCategories,
  getAllActiveCategories,
  getMyCategories,
  updateCategory,
  deleteCategory,
};
