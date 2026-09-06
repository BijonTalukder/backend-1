// models/sale.model.ts
import mongoose, { Document } from 'mongoose';

export interface ISaleItem {
  product: mongoose.Types.ObjectId;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type SaleStatus = 'paid' | 'partial' | 'due';

export interface ISale extends Document {
  business: mongoose.Types.ObjectId;
  invoiceNumber: string;
  customer?: mongoose.Types.ObjectId | null;
  items: ISaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paymentMethod: string;
  status: SaleStatus;
  date: Date;
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  linkedTransaction?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const saleItemSchema = new mongoose.Schema<ISaleItem>(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0.01 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const saleSchema = new mongoose.Schema<ISale>(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    invoiceNumber: { type: String, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    items: { type: [saleItemSchema], required: true, validate: (v: ISaleItem[]) => v.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
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

saleSchema.index({ business: 1, date: -1 });
saleSchema.index({ business: 1, customer: 1 });
saleSchema.index({ business: 1, customer: 1, date: -1 });
saleSchema.index({ business: 1, invoiceNumber: 1 }, { unique: true });

const Sale = mongoose.model<ISale>('Sale', saleSchema);
export default Sale;
