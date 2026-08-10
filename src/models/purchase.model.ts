// models/purchase.model.ts
import mongoose, { Document } from 'mongoose';

export interface IPurchaseItem {
  product: mongoose.Types.ObjectId;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type PurchaseStatus = 'paid' | 'partial' | 'due';

export interface IPurchase extends Document {
  business: mongoose.Types.ObjectId;
  referenceNumber: string;
  supplier?: mongoose.Types.ObjectId | null;
  items: IPurchaseItem[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string;
  status: PurchaseStatus;
  date: Date;
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  linkedTransaction?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const purchaseItemSchema = new mongoose.Schema<IPurchaseItem>(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const purchaseSchema = new mongoose.Schema<IPurchase>(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    referenceNumber: { type: String, required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    items: { type: [purchaseItemSchema], required: true, validate: (v: IPurchaseItem[]) => v.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    dueAmount: { type: Number, default: 0, min: 0 },
    paymentMethod: { type: String, default: 'cash' },
    status: { type: String, enum: ['paid', 'partial', 'due'], default: 'due' },
    date: { type: Date, default: Date.now },
    note: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    linkedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { timestamps: true, versionKey: false },
);

purchaseSchema.index({ business: 1, date: -1 });
purchaseSchema.index({ business: 1, supplier: 1 });
purchaseSchema.index({ business: 1, referenceNumber: 1 }, { unique: true });

const Purchase = mongoose.model<IPurchase>('Purchase', purchaseSchema);
export default Purchase;
