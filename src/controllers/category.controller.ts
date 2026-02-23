import Category from '../models/category.model';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';

const createCategory = asyncHandler(async (req, res, next) => {
  const category = await Category.create({
    ...req.body,
  });
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: 'Category created successfully',
    data: category,
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
  const categories = await Category.find({ isActive: true });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Active categories fetched successfully',
    data: categories,
  });
});
const getMyCategories = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const categories = await Category.find({
    status: true,
    $or: [
      { createdBy: userId }, // user-created
      { createdBy: null }, // admin-created, or you can mark admin id explicitly
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
  getAllCategories,
  getAllActiveCategories,
  getMyCategories,
  updateCategory,
  deleteCategory,
};
