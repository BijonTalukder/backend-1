// models/transaction.model.ts
import mongoose, { Document } from 'mongoose';

export type TransactionType = 'income' | 'expense' | 'transfer';
export type SplitType = 'none' | 'equal' | 'custom' | 'percentage';
export type SettlementStatus =
  | 'not_applicable'
  | 'pending'
  | 'partial'
  | 'settled';

// কার জন্য pay করা হয়েছে (split এর প্রতিটা অংশ)
export interface IPaidFor {
  member: mongoose.Types.ObjectId;
  amount: number;
  note?: string;
}

export interface ITransaction extends Document {
  // ─── Core ───────────────────────────────────────
  business: mongoose.Types.ObjectId;
  type: TransactionType;
  amount: number; // total amount (সবসময় positive)
  date: Date;

  // ─── Category & Note ────────────────────────────
  category: mongoose.Types.ObjectId;
  note?: string;
  reference?: string; // invoice/receipt no

  // ─── Who did it ─────────────────────────────────
  createdBy: mongoose.Types.ObjectId; // যে transaction add করেছে
  member: mongoose.Types.ObjectId; // যার account এ যাবে (payer)

  // ─── Pay for others ─────────────────────────────
  paidFor: IPaidFor[]; // কার কার জন্য pay করা হয়েছে
  splitType: SplitType; // কিভাবে split হয়েছে

  // ─── Transfer specific ──────────────────────────
  toMember?: mongoose.Types.ObjectId | null; // transfer এ receiver

  // ─── Settlement ─────────────────────────────────
  settlementStatus: SettlementStatus;
  settledAmount: number; // কত টাকা পরিশোধ হয়েছে

  // ─── Linked ─────────────────────────────────────
  linkedTransaction?: mongoose.Types.ObjectId; // adjustment এর জন্য
  isAdjustment: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const paidForSchema = new mongoose.Schema<IPaidFor>(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true },
  },
  { _id: false },
);

const transactionSchema = new mongoose.Schema<ITransaction>(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    type: {
      type: String,
      enum: ['income', 'expense', 'transfer'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Amount must be greater than 0'],
    },
    date: {
      type: Date,
      default: Date.now,
    },

    // Category & Note
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TransactionCategory',
      required: true,
    },
    note: { type: String, trim: true },
    reference: { type: String, trim: true },

    // Who
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Pay for others
    paidFor: {
      type: [paidForSchema],
      default: [],
    },
    splitType: {
      type: String,
      enum: ['none', 'equal', 'custom', 'percentage'],
      default: 'none',
    },

    // Transfer
    toMember: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Settlement
    settlementStatus: {
      type: String,
      enum: ['not_applicable', 'pending', 'partial', 'settled'],
      default: 'not_applicable',
    },
    settledAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Linked
    linkedTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    isAdjustment: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true, versionKey: false },
);

// Indexes
transactionSchema.index({ business: 1, date: -1 });
transactionSchema.index({ business: 1, member: 1, date: -1 });
transactionSchema.index({ business: 1, type: 1, date: -1 });
transactionSchema.index({ business: 1, settlementStatus: 1 });
transactionSchema.index({ business: 1, category: 1, date: -1 });
transactionSchema.index({ 'paidFor.member': 1, settlementStatus: 1 });

const Transaction = mongoose.model<ITransaction>(
  'Transaction',
  transactionSchema,
);
export default Transaction;
