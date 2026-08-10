// models/customer.model.ts
import mongoose, { Document } from 'mongoose';

export interface ICustomer extends Document {
  business: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  openingBalance: number;
  notes?: string;

  // ── Cached, ledger-derived totals ─────────────────
  totalSales: number;
  totalPaid: number;
  totalDue: number;

  status: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new mongoose.Schema<ICustomer>(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    openingBalance: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true },

    totalSales: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    totalDue: { type: Number, default: 0 },

    status: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

customerSchema.index({ business: 1, status: 1 });
customerSchema.index({ business: 1, name: 1 });

const Customer = mongoose.model<ICustomer>('Customer', customerSchema);
export default Customer;
