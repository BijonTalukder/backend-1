import { Request } from 'express';
import { Types } from 'mongoose';
import Category from '../models/category.model';
import Product from '../models/product.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';

const createCategory = asyncHandler(async (req, res, next) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const { name, businessId } = req.body;

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

/** Global business-type categories (onboarding). Used to return every
 *  business's product categories too, with their business and creator ids. */
const GLOBAL_FIELDS = '_id name status';

const getAllCategories = asyncHandler(async (req, res, next) => {
  const categories = await Category.find({ business: null, status: true }).select(GLOBAL_FIELDS).sort({ name: 1 }).lean();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Categories fetched successfully',
    data: categories,
  });
});

const getAllActiveCategories = asyncHandler(async (req, res, next) => {
  const categories = await Category.find({ business: null, status: true }).select(GLOBAL_FIELDS).sort({ name: 1 }).lean();
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
    business: null,
    $or: [
      { createdBy: userId },
      { createdBy: null },
    ],
  })
    .select(GLOBAL_FIELDS)
    .lean();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'My categories fetched successfully',
    data: categories,
  });
});

/**
 * Who may rename or delete a category: a business's category needs an owner
 * or admin of that business; a global one only its creator or a platform
 * admin. (Both routes used to accept any logged-in user, and PATCH wrote the
 * raw body, so anyone could move or rename another business's category.)
 */
const loadManageableCategory = async (req: Request) => {
  const id = req.params.id;
  if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid category id');
  }
  const { objectUserId } = getValidIds(req.user?._id);
  const category = await Category.findById(id);
  if (!category || !category.status) throw new ApiError(404, 'Category not found');

  if (category.business) {
    await requireMembership(category.business as Types.ObjectId, objectUserId, ['owner', 'admin']);
  } else {
    const isCreator = category.createdBy?.toString() === objectUserId.toString();
    const isPlatformAdmin = ['admin', 'super_admin'].includes(String(req.user?.role));
    if (!isCreator && !isPlatformAdmin) throw new ApiError(403, 'Access denied');
  }
  return category;
};

const updateCategory = asyncHandler(async (req, res, next) => {
  const category = await loadManageableCategory(req);
  const { name } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
    throw new ApiError(400, 'Category name is required (max 60 characters)');
  }
  category.name = name.trim();
  await category.save();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Category updated successfully',
    data: category,
  });
});

const deleteCategory = asyncHandler(async (req, res, next) => {
  const category = await loadManageableCategory(req);
  category.status = false;
  await category.save();
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
