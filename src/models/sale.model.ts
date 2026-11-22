// models/sale.model.ts
import mongoose, { Document } from 'mongoose';

export interface ISaleItem {
  product: mongoose.Types.ObjectId;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Product cost when sold: profit must not change when the cost price is edited later. */
  unitCost?: number;
  /** How much of this line has been returned. */
  returnedQuantity: number;
}

/** paid/partial/due describe what the customer still owes; cancelled = everything returned. */
export type SaleStatus = 'paid' | 'partial' | 'due' | 'cancelled';

export interface ISaleReturn {
  date: Date;
  items: { product: mongoose.Types.ObjectId; productName: string; quantity: number; amount: number }[];
  /** Value of the goods returned (after the sale's discount/tax share). */
  amount: number;
  /** Part of `amount` that reduced the customer's due. */
  dueReduced: number;
  /** Part of `amount` paid back in cash/bank. */
  refunded: number;
  refundMethod: string;
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  linkedTransaction?: mongoose.Types.ObjectId | null;
}

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
  attachmentUrl?: string;
  createdBy: mongoose.Types.ObjectId;
  linkedTransaction?: mongoose.Types.ObjectId | null;
  /** Total value returned so far; net sale = total - returnedTotal. */
  returnedTotal: number;
  returns: ISaleReturn[];
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
    unitCost: { type: Number, min: 0 },
    returnedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const saleReturnSchema = new mongoose.Schema<ISaleReturn>(
  {
    date: { type: Date, default: Date.now },
    items: [
      {
        _id: false,
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        productName: { type: String, required: true },
        quantity: { type: Number, required: true, min: 0 },
        amount: { type: Number, required: true, min: 0 },
      },
    ],
    amount: { type: Number, required: true, min: 0 },
    dueReduced: { type: Number, default: 0, min: 0 },
    refunded: { type: Number, default: 0, min: 0 },
    refundMethod: { type: String, default: 'cash' },
    note: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    linkedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  },
  { _id: true },
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
    status: { type: String, enum: ['paid', 'partial', 'due', 'cancelled'], default: 'due' },
    date: { type: Date, default: Date.now },
    note: { type: String, trim: true },
    attachmentUrl: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    linkedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    returnedTotal: { type: Number, default: 0, min: 0 },
    returns: { type: [saleReturnSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

saleSchema.index({ business: 1, date: -1 });
saleSchema.index({ date: -1 });
saleSchema.index({ business: 1, customer: 1 });
saleSchema.index({ business: 1, customer: 1, date: -1 });
saleSchema.index({ business: 1, invoiceNumber: 1 }, { unique: true });

const Sale = mongoose.model<ISale>('Sale', saleSchema);
export default Sale;
