// models/business.model.ts
import mongoose, { Document } from 'mongoose';

export const BUSINESS_TYPES = ['personal', 'company', 'mass'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface IBusiness extends Document {
  name: string;
  category?: mongoose.Types.ObjectId;
  status: boolean;
  owner: mongoose.Types.ObjectId;
  type: BusinessType;
  mealEnabled: boolean;
  currency: string;
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
      enum: BUSINESS_TYPES, // ✅ ['personal', 'company', 'mass']
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
  },
  { timestamps: true, versionKey: false },
);

businessSchema.index({ name: 1, owner: 1 });

const Business = mongoose.model<IBusiness>('Business', businessSchema);
export default Business;
