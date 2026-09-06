import mongoose, { Document } from 'mongoose';

export interface BusinessMembers extends Document {
  business: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  role: 'owner' | 'admin' | 'member';
  status: boolean; // ✅ literal `true` থেকে `boolean` এ change
  createdAt: Date;
  updatedAt: Date;
}

const businessMembersSchema = new mongoose.Schema<BusinessMembers>(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member'],
      default: 'member',
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true, versionKey: false },
);

businessMembersSchema.index({ business: 1, user: 1 }, { unique: true });
// getMyBusinesses / deleteAccount query by user only (business not in filter).
businessMembersSchema.index({ user: 1, status: 1 });
// List all active members of a business (member listing, mess, invoices).
businessMembersSchema.index({ business: 1, status: 1 });

export const BusinessMembersModel = mongoose.model<BusinessMembers>(
  'BusinessMembers',
  businessMembersSchema,
  'BusinessMembers',
);

export default BusinessMembers;
