// models/notification-campaign.model.ts
import mongoose, { Document } from 'mongoose';

export type NotificationChannel = 'email' | 'fcm';
export type CampaignStatus = 'queued' | 'sending' | 'completed' | 'partial' | 'failed';

/**
 * Audience filter for picking which HisabBoi users receive the campaign.
 * Stored verbatim on the campaign so a later change in filter rules never
 * rewrites history.
 */
export interface IAudienceFilter {
  all?: boolean;
  emails?: string[];
  userIds?: string[];
  roles?: string[];
  hasFcmToken?: boolean;
  activeInLastDays?: number;
  signupFrom?: Date;
  signupTo?: Date;
}

export interface IChannelStats {
  attempted: number;
  delivered: number;
  failed: number;
  invalidTokens: string[];
}

export interface INotificationCampaign extends Document {
  subject: string;
  bodyHtml: string;
  /** Optional human-readable summary (the preview text). */
  preview?: string;
  channels: { email: boolean; fcm: boolean };
  pushTitle?: string;
  pushBody?: string;
  pushData?: Record<string, string>;
  audience: IAudienceFilter;
  /** Materialised recipients so we can show "X users got this" even after users churn. */
  recipientCount: number;
  email: IChannelStats;
  fcm: IChannelStats;
  status: CampaignStatus;
  errorMessage?: string;
  templateId?: string;
  variables?: Record<string, string>;
  createdBy: mongoose.Types.ObjectId;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const channelStatsSchema = new mongoose.Schema<IChannelStats>(
  {
    attempted: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    invalidTokens: { type: [String], default: [] },
  },
  { _id: false },
);

const notificationCampaignSchema = new mongoose.Schema<INotificationCampaign>(
  {
    subject: { type: String, required: true, trim: true },
    bodyHtml: { type: String, required: true },
    preview: { type: String, trim: true },
    channels: {
      email: { type: Boolean, default: false },
      fcm: { type: Boolean, default: false },
    },
    pushTitle: { type: String, trim: true },
    pushBody: { type: String, trim: true },
    pushData: { type: Map, of: String, default: undefined },
    audience: {
      all: { type: Boolean, default: false },
      emails: { type: [String], default: [] },
      userIds: { type: [String], default: [] },
      roles: { type: [String], default: [] },
      hasFcmToken: { type: Boolean, default: false },
      activeInLastDays: { type: Number },
      signupFrom: { type: Date },
      signupTo: { type: Date },
    },
    recipientCount: { type: Number, default: 0 },
    email: { type: channelStatsSchema, default: () => ({}) },
    fcm: { type: channelStatsSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ['queued', 'sending', 'completed', 'partial', 'failed'],
      default: 'queued',
    },
    errorMessage: { type: String, trim: true },
    templateId: { type: String, trim: true },
    variables: { type: Map, of: String, default: undefined },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

notificationCampaignSchema.index({ createdAt: -1 });
notificationCampaignSchema.index({ status: 1, createdAt: -1 });

const NotificationCampaign = mongoose.model<INotificationCampaign>(
  'NotificationCampaign',
  notificationCampaignSchema,
);

export default NotificationCampaign;