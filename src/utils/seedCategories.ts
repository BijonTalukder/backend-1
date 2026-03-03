// utils/seedCategories.ts
import TransactionCategory from '../models/transaction-category.model';

export const seedDefaultCategories = async () => {
  const count = await TransactionCategory.countDocuments({ isGlobal: true });
  if (count > 0) return; // already seeded

  const defaults = [
    // ── Income ─────────────────────────────────────
    { name: 'Salary', type: 'income', group: 'salary', icon: '💰', isGlobal: true },
    { name: 'Business Income', type: 'income', group: 'business', icon: '🏢', isGlobal: true },
    { name: 'Freelance', type: 'income', group: 'business', icon: '💻', isGlobal: true },
    { name: 'Investment', type: 'income', group: 'business', icon: '📈', isGlobal: true },
    { name: 'Rental Income', type: 'income', group: 'housing', icon: '🏠', isGlobal: true },
    { name: 'Gift Received', type: 'income', group: 'other', icon: '🎁', isGlobal: true },
    { name: 'Loan Received', type: 'income', group: 'loan', icon: '🤝', isGlobal: true },
    { name: 'Refund', type: 'income', group: 'general', icon: '↩️', isGlobal: true },

    // ── Expense ────────────────────────────────────
    { name: 'Meal / Food', type: 'expense', group: 'food', icon: '🍱', isGlobal: true },
    { name: 'Grocery', type: 'expense', group: 'food', icon: '🛒', isGlobal: true },
    { name: 'House Rent', type: 'expense', group: 'housing', icon: '🏘️', isGlobal: true },
    { name: 'Utility Bill', type: 'expense', group: 'utility', icon: '💡', isGlobal: true },
    { name: 'Internet / SIM', type: 'expense', group: 'utility', icon: '📡', isGlobal: true },
    { name: 'Transport', type: 'expense', group: 'transport', icon: '🚌', isGlobal: true },
    { name: 'Fuel', type: 'expense', group: 'transport', icon: '⛽', isGlobal: true },
    { name: 'Doctor / Medical', type: 'expense', group: 'healthcare', icon: '🏥', isGlobal: true },
    { name: 'Medicine', type: 'expense', group: 'healthcare', icon: '💊', isGlobal: true },
    { name: 'Education', type: 'expense', group: 'education', icon: '📚', isGlobal: true },
    { name: 'Shopping', type: 'expense', group: 'shopping', icon: '🛍️', isGlobal: true },
    { name: 'Entertainment', type: 'expense', group: 'entertainment', icon: '🎬', isGlobal: true },
    { name: 'Loan Given', type: 'expense', group: 'loan', icon: '💸', isGlobal: true },
    { name: 'Loan Repayment', type: 'expense', group: 'loan', icon: '🔄', isGlobal: true },
    { name: 'Salary Paid', type: 'expense', group: 'salary', icon: '👷', isGlobal: true },
    { name: 'Office Expense', type: 'expense', group: 'business', icon: '🗂️', isGlobal: true },

    // ── Both ───────────────────────────────────────
    { name: 'Transfer', type: 'both', group: 'transfer', icon: '↔️', isGlobal: true },
    { name: 'Adjustment', type: 'both', group: 'general', icon: '⚖️', isGlobal: true },
    { name: 'Other', type: 'both', group: 'other', icon: '📌', isGlobal: true },
  ];

  await TransactionCategory.insertMany(defaults);
  console.log('✅ Default transaction categories seeded');
};

/* ─────────────────────────────────────────────────────────
   Mess-type business categories
   Call this after creating a new "mass" business:
   await seedMessCategories(businessId)
───────────────────────────────────────────────────────── */
export const seedMessCategories = async (businessId: string) => {
  // Don't seed if this business already has categories
  const existing = await TransactionCategory.countDocuments({ business: businessId });
  if (existing > 0) return;

  const messCategories = [
    // ── Mess Costs (expense) ────────────────────────
    { name: 'House Rent', type: 'expense', group: 'housing', icon: '🏠', business: businessId },
    { name: 'Electricity Bill', type: 'expense', group: 'utility', icon: '⚡', business: businessId },
    { name: 'Gas Bill', type: 'expense', group: 'utility', icon: '🔥', business: businessId },
    { name: 'Water Bill', type: 'expense', group: 'utility', icon: '💧', business: businessId },
    { name: 'WiFi / Internet', type: 'expense', group: 'utility', icon: '📶', business: businessId },
    { name: 'Housekeeper', type: 'expense', group: 'service', icon: '🧹', business: businessId },
    { name: 'Grocery / Bazar', type: 'expense', group: 'food', icon: '🛒', business: businessId },
    { name: 'Cooking Gas', type: 'expense', group: 'utility', icon: '🍳', business: businessId },
    { name: 'Maintenance', type: 'expense', group: 'housing', icon: '🔧', business: businessId },
    { name: 'Medicine', type: 'expense', group: 'healthcare', icon: '💊', business: businessId },
    { name: 'Other Cost', type: 'expense', group: 'other', icon: '📌', business: businessId },

    // ── Mess Deposits (income) ──────────────────────
    { name: 'Monthly Deposit', type: 'income', group: 'deposit', icon: '💵', business: businessId },
    { name: 'Extra Deposit', type: 'income', group: 'deposit', icon: '➕', business: businessId },
  ];

  await TransactionCategory.insertMany(messCategories);
  console.log(`✅ Mess categories seeded for business ${businessId}`);
};