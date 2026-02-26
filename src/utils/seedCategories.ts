// utils/seedCategories.ts
import TransactionCategory from '../models/transaction-category.model';

export const seedDefaultCategories = async () => {
  const count = await TransactionCategory.countDocuments({ isGlobal: true });
  if (count > 0) return; // already seeded

  const defaults = [
    // ── Income ─────────────────────────────────────
    {
      name: 'Salary',
      type: 'income',
      group: 'salary',
      icon: '💰',
      isGlobal: true,
    },
    {
      name: 'Business Income',
      type: 'income',
      group: 'business',
      icon: '🏢',
      isGlobal: true,
    },
    {
      name: 'Freelance',
      type: 'income',
      group: 'business',
      icon: '💻',
      isGlobal: true,
    },
    {
      name: 'Investment',
      type: 'income',
      group: 'business',
      icon: '📈',
      isGlobal: true,
    },
    {
      name: 'Rental Income',
      type: 'income',
      group: 'housing',
      icon: '🏠',
      isGlobal: true,
    },
    {
      name: 'Gift Received',
      type: 'income',
      group: 'other',
      icon: '🎁',
      isGlobal: true,
    },
    {
      name: 'Loan Received',
      type: 'income',
      group: 'loan',
      icon: '🤝',
      isGlobal: true,
    },
    {
      name: 'Refund',
      type: 'income',
      group: 'general',
      icon: '↩️',
      isGlobal: true,
    },

    // ── Expense ────────────────────────────────────
    {
      name: 'Meal / Food',
      type: 'expense',
      group: 'food',
      icon: '🍱',
      isGlobal: true,
    },
    {
      name: 'Grocery',
      type: 'expense',
      group: 'food',
      icon: '🛒',
      isGlobal: true,
    },
    {
      name: 'Basa Vara',
      type: 'expense',
      group: 'housing',
      icon: '🏘️',
      isGlobal: true,
    },
    {
      name: 'Utility Bill',
      type: 'expense',
      group: 'utility',
      icon: '💡',
      isGlobal: true,
    },
    {
      name: 'Internet / SIM',
      type: 'expense',
      group: 'utility',
      icon: '📡',
      isGlobal: true,
    },
    {
      name: 'Transport',
      type: 'expense',
      group: 'transport',
      icon: '🚌',
      isGlobal: true,
    },
    {
      name: 'Fuel',
      type: 'expense',
      group: 'transport',
      icon: '⛽',
      isGlobal: true,
    },
    {
      name: 'Doctor / Medical',
      type: 'expense',
      group: 'healthcare',
      icon: '🏥',
      isGlobal: true,
    },
    {
      name: 'Medicine',
      type: 'expense',
      group: 'healthcare',
      icon: '💊',
      isGlobal: true,
    },
    {
      name: 'Education',
      type: 'expense',
      group: 'education',
      icon: '📚',
      isGlobal: true,
    },
    {
      name: 'Shopping',
      type: 'expense',
      group: 'shopping',
      icon: '🛍️',
      isGlobal: true,
    },
    {
      name: 'Entertainment',
      type: 'expense',
      group: 'entertainment',
      icon: '🎬',
      isGlobal: true,
    },
    {
      name: 'Loan Given',
      type: 'expense',
      group: 'loan',
      icon: '💸',
      isGlobal: true,
    },
    {
      name: 'Loan Repayment',
      type: 'expense',
      group: 'loan',
      icon: '🔄',
      isGlobal: true,
    },
    {
      name: 'Salary Paid',
      type: 'expense',
      group: 'salary',
      icon: '👷',
      isGlobal: true,
    },
    {
      name: 'Office Expense',
      type: 'expense',
      group: 'business',
      icon: '🗂️',
      isGlobal: true,
    },

    // ── Both ───────────────────────────────────────
    {
      name: 'Transfer',
      type: 'both',
      group: 'transfer',
      icon: '↔️',
      isGlobal: true,
    },
    {
      name: 'Adjustment',
      type: 'both',
      group: 'general',
      icon: '⚖️',
      isGlobal: true,
    },
    { name: 'Other', type: 'both', group: 'other', icon: '📌', isGlobal: true },
  ];

  await TransactionCategory.insertMany(defaults);
  console.log('✅ Default transaction categories seeded');
};
