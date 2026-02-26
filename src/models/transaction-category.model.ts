// models/transaction-category.model.ts
import mongoose, { Document, Types } from 'mongoose';

export type TransactionType = 'income' | 'expense' | 'both';

export interface ITransactionCategory extends Document {
  name: string; // e.g. "Basa Vara", "Utility Bill", "Salary", "Others"
  type: TransactionType; // income / expense / both
  business: Types.ObjectId; // belongs to which business
  createdBy: Types.ObjectId | null; // null = admin/global
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const transactionCategorySchema = new mongoose.Schema<ITransactionCategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['income', 'expense', 'both'],
      required: true,
      default: 'both',
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      required: false,
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

transactionCategorySchema.index({ business: 1, name: 1 });

const TransactionCategory = mongoose.model<ITransactionCategory>(
  'TransactionCategory',
  transactionCategorySchema,
);

export default TransactionCategory;
