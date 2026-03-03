import express, { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { auth } from '../middlewares/auth.middleware';
import { transactionCategoryController } from '../controllers/transaction-category.controller';
import { invitationController } from '../controllers/invitation.controller';
import { businessController } from '../controllers/business.controller';
import { categoryController } from '../controllers/category.controller';
import { userController } from '../controllers/user.controller';
import { transactionController } from '../controllers/transaction.controller';
import { businessMembersController } from '../controllers/business-member.controller';
import { mealController } from '../controllers/meal.controller';
import { massController } from '../controllers/mass.controller';

const route: Router = express.Router();

route.post('/auth/register', authController.register);
route.post('/auth/login', authController.login);

route.patch('/users/default-business', auth, userController.setDefaultBusiness);

route.post('/businesses', auth, businessController.createBusiness);
route.get('/businesses/my', auth, businessController.getMyBusinesses);
route.patch('/businesses/:id', auth, businessController.updateBusiness);
route.delete('/businesses/:id', auth, businessController.deleteBusiness);
route.post('/businesses/complete-onboarding', auth, businessController.completeOnboarding);
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

route.post(
  '/business-members/:businessId/invite',
  auth,
  invitationController.sendInvitation,
);

// ── Get invite details by token (public — no auth needed)
route.get(
  '/invitations/token/:token',
  invitationController.getInvitationByToken,
);

// ── Accept (auth required)
route.post(
  '/invitations/token/:token/accept',
  auth,
  invitationController.acceptInvitation,
);

// ── Decline (no auth needed — anyone with link can decline)
route.post(
  '/invitations/token/:token/decline',
  invitationController.declineInvitation,
);

// ── My pending invitations
route.get('/invitations/mine', auth, invitationController.getMyInvitations);

// ── Sent invitations for a business
route.get(
  '/invitations/sent/:businessId',
  auth,
  invitationController.getSentInvitations,
);

// ── Cancel invitation
route.delete(
  '/invitations/:invitationId',
  auth,
  invitationController.cancelInvitation,
);

route.get(
  '/business-members/:businessId',
  auth,
  businessMembersController.getMembers,
);
route.post(
  '/business-members/:businessId/invite',
  auth,
  businessMembersController.inviteMember,
);
route.delete(
  '/business-members/:businessId/:memberId',
  auth,
  businessMembersController.removeMember,
);
route.patch(
  '/business-members/:businessId/:memberId',
  auth,
  businessMembersController.updateMemberRole,
);

route.get('/meals/summary', auth, mealController.getMealSummary);
route.get('/meals/', auth, mealController.getMeals);
route.post('/meals/', auth, mealController.addMeal);
route.patch('/meals/:id', auth, mealController.updateMeal);
route.delete('meals/:id', auth, mealController.deleteMeal);
route.get('/mess/summary', auth, massController.getMessSummary);

export default route;
