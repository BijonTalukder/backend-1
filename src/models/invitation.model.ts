// models/invitation.model.ts
import mongoose, { Document } from 'mongoose';

export type InviteStatus = 'pending' | 'accepted' | 'rejected' | 'expired';
export type InviteRole = 'admin' | 'member';

export interface IInvitation extends Document {
  business: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  email: string;
  role: InviteRole;
  token: string;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const invitationSchema = new mongoose.Schema<IInvitation>(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'expired'],
      default: 'pending',
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  },
  { timestamps: true, versionKey: false },
);

invitationSchema.index({ token: 1 });
invitationSchema.index({ email: 1, business: 1 });

const Invitation = mongoose.model<IInvitation>('Invitation', invitationSchema);
export default Invitation;
