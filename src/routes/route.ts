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
import { businessInvoicesController } from '../controllers/invoice.controller';
import { aiChat } from '../controllers/ai.controller';
import { dashboardController } from '../controllers/dashboard.controller';
import { customerController } from '../controllers/customer.controller';
import { supplierController } from '../controllers/supplier.controller';
import { productController } from '../controllers/product.controller';
import { saleController } from '../controllers/sale.controller';
import { purchaseController } from '../controllers/purchase.controller';
import { expenseController } from '../controllers/expense.controller';
import { paymentController } from '../controllers/payment.controller';
import { reportController } from '../controllers/report.controller';
import { health } from '../controllers/health.controller';

const route: Router = express.Router();

// ── Connectivity probe (public — the offline client polls this) ──
route.get('/health', health);

route.post('/auth/register', authController.register);
route.post('/auth/login', authController.login);
route.patch('/auth/profile', auth, authController.updateProfile);
route.patch('/auth/change-password', auth, authController.changePassword);
route.delete('/auth/account', auth, authController.deleteAccount);
route.patch('/users/default-business', auth, userController.setDefaultBusiness);

route.post('/businesses', auth, businessController.createBusiness);
route.get('/businesses/my', auth, businessController.getMyBusinesses);
route.patch('/businesses/:id', auth, businessController.updateBusiness);
route.delete('/businesses/:id', auth, businessController.deleteBusiness);
route.post(
  '/businesses/complete-onboarding',
  auth,
  businessController.completeOnboarding,
);
route.get(
  '/dashboard/:businessId',
  auth,
  dashboardController.getBusinessSummary,
);

// ── Customers (Business Mode) ─────────────────────────
route.post('/customers', auth, customerController.createCustomer);
route.get(
  '/customers/business/:businessId',
  auth,
  customerController.getCustomers,
);
route.get('/customers/:id', auth, customerController.getCustomer);
route.patch('/customers/:id', auth, customerController.updateCustomer);
route.delete('/customers/:id', auth, customerController.deleteCustomer);

// ── Suppliers (Business Mode) ─────────────────────────
route.post('/suppliers', auth, supplierController.createSupplier);
route.get(
  '/suppliers/business/:businessId',
  auth,
  supplierController.getSuppliers,
);
route.get('/suppliers/:id', auth, supplierController.getSupplier);
route.patch('/suppliers/:id', auth, supplierController.updateSupplier);
route.delete('/suppliers/:id', auth, supplierController.deleteSupplier);

// ── Products & Inventory (Business Mode) ──────────────
route.post('/products', auth, productController.createProduct);
route.get(
  '/products/business/:businessId',
  auth,
  productController.getProducts,
);
route.get('/products/:id', auth, productController.getProduct);
route.patch('/products/:id', auth, productController.updateProduct);
route.post(
  '/products/:id/adjust-stock',
  auth,
  productController.adjustProductStock,
);
route.delete('/products/:id', auth, productController.deleteProduct);

// ── Sales (Business Mode) ─────────────────────────────
route.post('/sales', auth, saleController.createSale);
route.get('/sales/business/:businessId', auth, saleController.getSales);
route.get('/sales/:id', auth, saleController.getSale);

// ── Purchases (Business Mode) ─────────────────────────
route.post('/purchases', auth, purchaseController.createPurchase);
route.get('/purchases/business/:businessId', auth, purchaseController.getPurchases);
route.get('/purchases/:id', auth, purchaseController.getPurchase);

// ── Expenses (Business Mode) ──────────────────────────
route.post('/expenses', auth, expenseController.createExpense);
route.get('/expenses/business/:businessId', auth, expenseController.getExpenses);

// ── Payments (Business Mode) ──────────────────────────
route.post('/payments/receive', auth, paymentController.receivePayment);
route.post('/payments/pay', auth, paymentController.makePayment);
route.get('/payments/business/:businessId', auth, paymentController.getPayments);

// ── Reports (Business Mode) ───────────────────────────
route.get('/reports/profit-loss/:businessId', auth, reportController.getProfitLoss);
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
route.post(
  '/invoices/:businessId/generate', auth,
  businessInvoicesController.generateInvoice,
);
route.get(
  '/invoices/:businessId',
  auth,
  businessInvoicesController.listInvoices,
);
route.get(
  '/invoices/:businessId/:invoiceId',
  auth,
  businessInvoicesController.getInvoice,
);
route.delete(
  '/invoices/:businessId/:invoiceId',
  auth,
  businessInvoicesController.deleteInvoice,
);
route.post('/ai/chat', auth, aiChat)
export default route;
