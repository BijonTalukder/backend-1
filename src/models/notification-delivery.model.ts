// models/notification-delivery.model.ts
//
// Per-recipient delivery log for notification campaigns.
//
// The campaign document (notification-campaign.model.ts) only keeps aggregate
// counters — attempted / delivered / failed per channel. That answers "how
// many failed" but not "who failed" or "why". This collection stores one row
// per recipient × channel attempt so the admin panel can show a true
// delivery log for both email and push.

import mongoose, { Document } from 'mongoose';

export type DeliveryChannel = 'email' | 'fcm';
export type DeliveryStatus = 'delivered' | 'failed';

export interface IDeliveryAttempt {
  campaignId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  /** email → the address; fcm → the device token. */
  recipient: string;
  /** Machine-readable cause, e.g. 'messaging/registration-token-not-registered'. */
  errorCode?: string;
  /** Human-readable cause, e.g. the SMTP or FCM error text. */
  errorMessage?: string;
  attemptedAt: Date;
}

const notificationDeliverySchema = new mongoose.Schema<IDeliveryAttempt>(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NotificationCampaign',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    channel: {
      type: String,
      enum: ['email', 'fcm'],
      required: true,
    },
    status: {
      type: String,
      enum: ['delivered', 'failed'],
      required: true,
    },
    recipient: { type: String, required: true, trim: true },
    errorCode: { type: String, trim: true },
    errorMessage: { type: String, trim: true },
    attemptedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
);

// Main read path: "show me this campaign's email/FCM log, newest first".
notificationDeliverySchema.index({ campaignId: 1, channel: 1, attemptedAt: -1 });

const NotificationDelivery = mongoose.model<IDeliveryAttempt>(
  'NotificationDelivery',
  notificationDeliverySchema,
);

export default NotificationDelivery;
