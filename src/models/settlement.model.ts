// models/settlement.model.ts
import mongoose, { Document } from 'mongoose';

export type SettlementType = 'full' | 'partial';

export interface ISettlement extends Document {
  business: mongoose.Types.ObjectId;
  transaction: mongoose.Types.ObjectId; // original transaction
  paidBy: mongoose.Types.ObjectId; // যে পরিশোধ করেছে
  paidTo: mongoose.Types.ObjectId; // যাকে দিয়েছে
  amount: number;
  type: SettlementType;
  note?: string;
  date: Date;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const settlementSchema = new mongoose.Schema<ISettlement>(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    paidTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Amount must be positive'],
    },
    type: {
      type: String,
      enum: ['full', 'partial'],
      required: true,
    },
    note: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

settlementSchema.index({ transaction: 1 });
settlementSchema.index({ business: 1, paidBy: 1 });
settlementSchema.index({ business: 1, paidTo: 1 });

const Settlement = mongoose.model<ISettlement>('Settlement', settlementSchema);
export default Settlement;
