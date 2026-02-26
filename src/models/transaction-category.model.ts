// models/transaction-category.model.ts
import mongoose, { Document } from 'mongoose';

export type TCategoryType = 'income' | 'expense' | 'both';
export type TCategoryGroup =
  | 'general'
  | 'food'
  | 'transport'
  | 'housing'
  | 'utility'
  | 'healthcare'
  | 'education'
  | 'entertainment'
  | 'shopping'
  | 'salary'
  | 'business'
  | 'loan'
  | 'transfer'
  | 'other';

export interface ITransactionCategory extends Document {
  name: string;
  type: TCategoryType;
  group: TCategoryGroup;
  icon?: string; // emoji or icon name
  business: mongoose.Types.ObjectId | null; // null = global/admin
  createdBy: mongoose.Types.ObjectId | null;
  isGlobal: boolean;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const transactionCategorySchema = new mongoose.Schema<ITransactionCategory>(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['income', 'expense', 'both'],
      default: 'both',
    },
    group: {
      type: String,
      enum: [
        'general',
        'food',
        'transport',
        'housing',
        'utility',
        'healthcare',
        'education',
        'entertainment',
        'shopping',
        'salary',
        'business',
        'loan',
        'transfer',
        'other',
      ],
      default: 'general',
    },
    icon: { type: String },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isGlobal: { type: Boolean, default: false },
    status: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

transactionCategorySchema.index({ business: 1, status: 1 });
transactionCategorySchema.index({ isGlobal: 1, status: 1 });

const TransactionCategory = mongoose.model<ITransactionCategory>(
  'TransactionCategory',
  transactionCategorySchema,
);
export default TransactionCategory;
