import mongoose, { Document } from 'mongoose';

export interface BusinessMembers extends Document {
  business: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  role: 'owner' | 'admin' | 'member';

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
  },
  {
    timestamps: true,
    versionKey: false,
  },
);
businessMembersSchema.index({ business: 1, user: 1 }, { unique: true });
export const BusinessMembersModel = mongoose.model<BusinessMembers>(
  'BusinessMembers',
  businessMembersSchema,
  'BusinessMembers',
);
export default BusinessMembers;
