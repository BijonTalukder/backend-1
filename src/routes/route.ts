import express, { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { auth } from '../middlewares/auth.middleware';
import { transactionCategoryController } from '../models/transaction-category.controller';
import { invitationController } from '../controllers/invitation.controller';
import { businessController } from '../controllers/business.controller';
import { categoryController } from '../controllers/category.controller';
import { userController } from '../controllers/user.controller';

const route: Router = express.Router();

route.post('/auth/register', authController.register);
route.post('/auth/login', authController.login);

route.patch('/users/default-business', auth, userController.setDefaultBusiness);

route.post('/businesses', auth, businessController.createBusiness);
route.get('/businesses', auth, businessController.getMyBusinesses);
route.patch('/businesses/:id', auth, businessController.updateBusiness);
route.delete('/businesses/:id', auth, businessController.deleteBusiness);

//category
route.post('/categories', auth, categoryController.createCategory);
route.get('/categories', auth, categoryController.getAllCategories);
route.get(
  '/categories/active',
  auth,
  categoryController.getAllActiveCategories,
);
route.get('/categories/my', auth, categoryController.getMyCategories);
route.patch('/categories/:id', auth, categoryController.updateCategory);
route.delete('/categories/:id', auth, categoryController.deleteCategory);

route.post(
  '/transaction-category',
  auth,
  transactionCategoryController.createTransactionCategory,
); // ✅ leading slash
route.get(
  '/transaction-category/:businessId',
  auth,
  transactionCategoryController.getTransactionCategories,
);
route.patch(
  '/transaction-category/:id',
  auth,
  transactionCategoryController.updateTransactionCategory,
);
route.delete(
  '/transaction-category/:id',
  auth,
  transactionCategoryController.deleteTransactionCategory,
);

route.post('/invitation/', auth, invitationController.sendInvitation);
route.get('/invitation/check/:token', invitationController.checkInvitation); // ✅ auth লাগবে না
route.post(
  '/invitation/accept/:token',
  auth,
  invitationController.acceptInvitation,
);
route.post('/invitation/reject/:token', invitationController.rejectInvitation); // ✅ auth লাগবে না
route.get(
  '/invitation/business/:businessId',
  auth,
  invitationController.getBusinessInvitations,
);

export default route;
