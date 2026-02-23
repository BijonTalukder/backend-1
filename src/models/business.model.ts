import mongoose, { Document } from 'mongoose';

export const BUSINESS_TYPES = ['individual', 'company', 'others'];
export interface Business extends Document {
  name: string;
  category: mongoose.Types.ObjectId; // category এর reference
  status: boolean;
  owner: mongoose.Types.ObjectId; // যে user বা admin create করেছে
  createdAt: Date;
  updatedAt: Date;
  type: (typeof BUSINESS_TYPES)[number];
}
const businessSchema = new mongoose.Schema<Business>(
  {
    name: {
      type: String,
      required: true,
      unique: false, // এখন multiple users same name দিতে পারবে
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
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
      enum: BUSINESS_TYPES,
      default: 'individual',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);
businessSchema.index({ name: 1, owner: 1 });
const Business = mongoose.model<Business>('Business', businessSchema);
export default Business;
