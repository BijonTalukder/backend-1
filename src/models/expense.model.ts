// models/expense.model.ts
import mongoose, { Document } from 'mongoose';

export interface IExpense extends Document {
  business: mongoose.Types.ObjectId;
  category: mongoose.Types.ObjectId;
  amount: number;
  paymentMethod: string;
  date: Date;
  note?: string;
  attachmentUrl?: string;
  createdBy: mongoose.Types.ObjectId;
  linkedTransaction?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const expenseSchema = new mongoose.Schema<IExpense>(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'TransactionCategory', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentMethod: { type: String, default: 'cash' },
    date: { type: Date, default: Date.now },
    note: { type: String, trim: true },
    attachmentUrl: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    linkedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { timestamps: true, versionKey: false },
);

expenseSchema.index({ business: 1, date: -1 });
expenseSchema.index({ business: 1, category: 1 });

const Expense = mongoose.model<IExpense>('Expense', expenseSchema);
export default Expense;
