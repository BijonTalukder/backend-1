// models/supplier.model.ts
import mongoose, { Document } from 'mongoose';

export interface ISupplier extends Document {
  business: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  openingBalance: number;
  notes?: string;

  // ── Cached, ledger-derived totals ─────────────────
  totalPurchases: number;
  totalPaid: number;
  totalPayable: number;

  status: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new mongoose.Schema<ISupplier>(
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

    totalPurchases: { type: Number, default: 0 },
    totalPaid: { type: Number, default: 0 },
    totalPayable: { type: Number, default: 0 },

    status: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

supplierSchema.index({ business: 1, status: 1 });
supplierSchema.index({ business: 1, name: 1 });

const Supplier = mongoose.model<ISupplier>('Supplier', supplierSchema);
export default Supplier;
