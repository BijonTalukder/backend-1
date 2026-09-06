// models/payment.model.ts
import mongoose, { Document } from 'mongoose';

export type PaymentDirection = 'in' | 'out';
export type PaymentPartyType = 'customer' | 'supplier';

export interface IPayment extends Document {
  business: mongoose.Types.ObjectId;
  direction: PaymentDirection;
  partyType: PaymentPartyType;
  partyModel: 'Customer' | 'Supplier';
  party: mongoose.Types.ObjectId;
  amount: number;
  method: string;
  note?: string;
  date: Date;
  createdBy: mongoose.Types.ObjectId;
  linkedTransaction?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new mongoose.Schema<IPayment>(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    partyType: { type: String, enum: ['customer', 'supplier'], required: true },
    partyModel: { type: String, enum: ['Customer', 'Supplier'], required: true },
    party: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'partyModel' },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, default: 'cash' },
    note: { type: String, trim: true },
    date: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    linkedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { timestamps: true, versionKey: false },
);

paymentSchema.index({ business: 1, date: -1 });
paymentSchema.index({ business: 1, party: 1 });
paymentSchema.index({ business: 1, direction: 1, date: -1 });

const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
export default Payment;
