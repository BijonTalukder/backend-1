// models/invoice.model.ts
import mongoose, { Document, Schema } from 'mongoose';

/* ── Shared transaction snapshot ─────────────────────── */
export interface ITransactionSnapshot {
  _id: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  date: Date;
  categoryName: string;
  note?: string;
  memberName: string;
}

/* ── Mess: per-member summary ────────────────────────── */
export interface IMessMemberSummary {
  userId: string;
  name: string;
  totalDeposit: number; // income entries
  totalMeals: number; // meal count
  mealCost: number; // meals × mealRate
  otherExpense: number; // expense entries (non-meal-category)
  totalCost: number; // mealCost + otherExpense
  balance: number; // totalDeposit - totalCost (+ve = advance, -ve = due)
}

/* ── Invoice document ────────────────────────────────── */
export interface IInvoice extends Document {
  business: mongoose.Types.ObjectId;
  businessName: string;
  businessType: 'personal' | 'company' | 'mass';
  month: number; // 1-12
  year: number;
  generatedBy: mongoose.Types.ObjectId;
  generatedAt: Date;

  /* Standard fields */
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  transactions: ITransactionSnapshot[];

  /* Mess-only fields */
  isMess: boolean;
  mealCategoryId?: string;
  mealCategoryName?: string;
  totalMealCost?: number;
  totalMeals?: number;
  mealRate?: number;
  members?: IMessMemberSummary[];

  createdAt: Date;
  updatedAt: Date;
}

const transactionSnapshotSchema = new Schema<ITransactionSnapshot>(
  {
    _id: { type: String },
    type: { type: String, enum: ['income', 'expense', 'transfer'] },
    amount: { type: Number },
    date: { type: Date },
    categoryName: { type: String },
    note: { type: String },
    memberName: { type: String },
  },
  { _id: false },
);

const messMemberSchema = new Schema<IMessMemberSummary>(
  {
    userId: { type: String },
    name: { type: String },
    totalDeposit: { type: Number, default: 0 },
    totalMeals: { type: Number, default: 0 },
    mealCost: { type: Number, default: 0 },
    otherExpense: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema<IInvoice>(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    businessName: { type: String, required: true },
    businessType: {
      type: String,
      enum: ['personal', 'company', 'mass'],
      required: true,
    },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    generatedAt: { type: Date, default: Date.now },

    totalIncome: { type: Number, default: 0 },
    totalExpense: { type: Number, default: 0 },
    netBalance: { type: Number, default: 0 },
    transactions: { type: [transactionSnapshotSchema], default: [] },

    isMess: { type: Boolean, default: false },
    mealCategoryId: { type: String },
    mealCategoryName: { type: String },
    totalMealCost: { type: Number },
    totalMeals: { type: Number },
    mealRate: { type: Number },
    members: { type: [messMemberSchema], default: [] },
  },
  { timestamps: true },
);

// একই business এর একই month/year এ একটাই invoice
invoiceSchema.index({ business: 1, month: 1, year: 1 }, { unique: true });
invoiceSchema.index({ business: 1, generatedAt: -1 });

const Invoice =
  mongoose.models.Invoice || mongoose.model<IInvoice>('Invoice', invoiceSchema);

export default Invoice;
