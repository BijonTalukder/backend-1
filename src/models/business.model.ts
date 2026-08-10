// models/business.model.ts
import mongoose, { Document } from 'mongoose';

export const BUSINESS_TYPES = ['personal', 'company', 'mass', 'business'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_SUB_TYPES = [
  'retail_shop',
  'restaurant',
  'online_shop',
  'service_business',
  'freelancer',
  'wholesale',
  'other',
] as const;
export type BusinessSubType = (typeof BUSINESS_SUB_TYPES)[number];

export const PAYMENT_METHODS = ['cash', 'bank', 'bkash', 'nagad', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface IInvoiceSettings {
  prefix: string;
  nextNumber: number;
}

export interface IBusiness extends Document {
  name: string;
  category?: mongoose.Types.ObjectId;
  status: boolean;
  owner: mongoose.Types.ObjectId;
  type: BusinessType;
  mealEnabled: boolean;
  currency: string;

  // ── Business Mode fields ──────────────────────────
  businessType?: BusinessSubType;
  phone?: string;
  address?: string;
  logoUrl?: string;
  openingBalance: number;
  cashBalance: number;
  bankBalance: number;
  invoiceSettings: IInvoiceSettings;
  paymentMethods: PaymentMethod[];

  createdAt: Date;
  updatedAt: Date;
}

const businessSchema = new mongoose.Schema<IBusiness>(
  {
    name: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BusinessCategory',
      required: false, // ✅ optional
      default: null,
    },
    status: {
      type: Boolean,
      default: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      // enum: BUSINESS_TYPES, // ✅ ['personal', 'company', 'mass', 'business']
      default: 'personal',
    },
    mealEnabled: {
      type: Boolean,
      default: false,
    },
    currency: {
      type: String,
      default: 'BDT',
    },

    // ── Business Mode fields ────────────────────────
    businessType: {
      type: String,
      enum: BUSINESS_SUB_TYPES,
      default: undefined,
    },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    logoUrl: { type: String, trim: true },
    openingBalance: { type: Number, default: 0 },
    cashBalance: { type: Number, default: 0 },
    bankBalance: { type: Number, default: 0 },
    invoiceSettings: {
      prefix: { type: String, default: 'INV' },
      nextNumber: { type: Number, default: 1 },
    },
    paymentMethods: {
      type: [String],
      enum: PAYMENT_METHODS,
      default: ['cash', 'bank', 'bkash', 'nagad'],
    },
  },
  { timestamps: true, versionKey: false },
);

businessSchema.index({ name: 1, owner: 1 });

const Business = mongoose.model<IBusiness>('Business', businessSchema);
export default Business;
