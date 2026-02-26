import express, { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { auth } from '../middlewares/auth.middleware';
import { transactionCategoryController } from '../controllers/transaction-category.controller';
import { invitationController } from '../controllers/invitation.controller';
import { businessController } from '../controllers/business.controller';
import { categoryController } from '../controllers/category.controller';
import { userController } from '../controllers/user.controller';
import { transactionController } from '../controllers/transaction.controller';

const route: Router = express.Router();

route.post('/auth/register', authController.register);
route.post('/auth/login', authController.login);

route.patch('/users/default-business', auth, userController.setDefaultBusiness);

route.post('/businesses', auth, businessController.createBusiness);
route.get('/businesses/my', auth, businessController.getMyBusinesses);
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
route.post('/transactions', auth, transactionController.createTransaction);
route.get(
  '/transactions/business/:businessId',
  auth,
  transactionController.getBusinessTransactions,
);
route.get(
  '/transactions/dues/:businessId',
  auth,
  transactionController.getPendingDues,
);
route.get(
  '/transactions/summary/:businessId',
  auth,
  transactionController.getMonthlySummary,
);
route.patch('/transactions/:id', auth, transactionController.updateTransaction);
route.delete(
  '/transactions/:id',
  auth,
  transactionController.deleteTransaction,
);
route.post(
  '/transactions/:id/settle',
  auth,
  transactionController.settleTransaction,
);
route.get(
  '/transactions/:id/settlements',
  auth,
  transactionController.getSettlements,
);

// ── Transaction Categories ─────────────────────────────
route.post(
  '/transaction-categories',
  auth,
  transactionCategoryController.createTransactionCategory,
);
route.get(
  '/transaction-categories/:businessId',
  auth,
  transactionCategoryController.getTransactionCategories,
);
route.patch(
  '/transaction-categories/:id',
  auth,
  transactionCategoryController.updateTransactionCategory,
);
route.delete(
  '/transaction-categories/:id',
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
