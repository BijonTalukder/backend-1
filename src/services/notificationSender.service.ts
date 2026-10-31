// services/notificationSender.service.ts
//
// The delivery half of a campaign: sending the email and the push, and
// recording what happened per recipient.
//
// These helpers used to live inside notification.controller.ts, but the
// monthly report needs to send a *different body per recipient*, so it
// cannot go through the controller's single-body sendNotification path.
// Both callers share this service instead.

import { Types } from 'mongoose';
import User from '../models/user.model';
import NotificationCampaign, {
  type IChannelStats,
} from '../models/notification-campaign.model';
import NotificationDelivery, {
  type DeliveryChannel,
  type DeliveryStatus,
} from '../models/notification-delivery.model';
import sendEmail, { isMailboxLimitError } from '../utils/sendEmail';
import { sendFcmToTokens, type FcmPayload } from '../utils/sendPush';

/**
 * One recipient of a campaign.
 *
 * `email` is only needed for the email channel, `fcmTokens` only for the
 * push channel. The monthly report builds one of these per user.
 */
export interface CampaignTarget {
  _id: Types.ObjectId;
  firstName?: string;
  email?: string;
  fcmTokens?: { token: string }[];
}

export interface CampaignChannels {
  email: boolean;
  fcm: boolean;
}

export interface CampaignInput {
  subject: string;
  bodyHtml: string;
  channels: CampaignChannels;
  pushTitle?: string;
  pushBody?: string;
  pushData?: Record<string, string>;
}

// ── delivery log ──────────────────────────────────────────────────────────

/**
 * One row per recipient × channel attempt, pending persistence.
 * `campaignId` and `channel` are supplied by recordDeliveries().
 */
export interface DeliveryAttemptRow {
  userId: Types.ObjectId;
  recipient: string;
  status: DeliveryStatus;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Bulk-write the per-recipient delivery log for a channel. Failures here
 * must never fail the campaign, so errors are logged and swallowed.
 */
export async function recordDeliveries(
  campaignId: string,
  channel: DeliveryChannel,
  attempts: DeliveryAttemptRow[],
): Promise<void> {
  if (attempts.length === 0) return;
  try {
    await NotificationDelivery.insertMany(
      attempts.map((a) => ({
        campaignId: new Types.ObjectId(campaignId),
        userId: a.userId,
        channel,
        status: a.status,
        recipient: a.recipient,
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        attemptedAt: new Date(),
      })),
    );
  } catch (err) {
    console.error(
      `[notification] Failed to record ${channel} delivery log for campaign ${campaignId}:`,
      err,
    );
  }
}

export async function runCampaign(
  campaignId: string,
  users: Array<{ _id: Types.ObjectId; firstName?: string; email?: string; fcmTokens?: { token: string }[] }>,
  input: {
    subject: string;
    bodyHtml: string;
    channels: { email: boolean; fcm: boolean };
    pushTitle?: string;
    pushBody?: string;
    pushData?: Record<string, string>;
  },
) {
  // Run each channel independently: a failure in email must not stop FCM
  // from being attempted, and vice versa. Each runner records its own stats,
  // so the campaign still reflects whatever did complete.
  const channelErrors: string[] = [];

  if (input.channels.email) {
    try {
      await runEmail(campaignId, users, input.subject, input.bodyHtml);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      channelErrors.push(`email: ${message}`);
      console.error(`[notification] email channel failed for ${campaignId}:`, err);
    }
  }

  if (input.channels.fcm) {
    try {
      await runFcm(campaignId, users, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      channelErrors.push(`fcm: ${message}`);
      console.error(`[notification] fcm channel failed for ${campaignId}:`, err);
    }
  }

  try {
    const campaign = await NotificationCampaign.findById(campaignId);
    if (!campaign) return;
    const failed = campaign.email.failed + campaign.fcm.failed;
    const delivered = campaign.email.delivered + campaign.fcm.delivered;
    const attempted =
      (campaign.email.attempted || 0) + (campaign.fcm.attempted || 0);
    let status: 'completed' | 'partial' | 'failed' = 'completed';
    if (delivered === 0 && attempted > 0) status = 'failed';
    else if (failed > 0) status = 'partial';
    campaign.status = status;
    campaign.completedAt = new Date();
    if (channelErrors.length > 0) {
      campaign.errorMessage = channelErrors.join('; ');
    }
    await campaign.save();
  } catch (err) {
    await NotificationCampaign.findByIdAndUpdate(campaignId, {
      status: 'failed',
      errorMessage:
        channelErrors.length > 0
          ? channelErrors.join('; ')
          : err instanceof Error
            ? err.message
            : 'unknown',
      completedAt: new Date(),
    });
  }
}

/**
 * How many emails to send at once. Sending one-by-one to ~110 recipients
 * took longer than the serverless function's budget, so the campaign was
 * killed mid-flight and the counters were never written.
 */
const EMAIL_CONCURRENCY = 5;

/**
 * How many times to retry a send that failed for a transient reason.
 *
 * Gmail replies "421-4.3.0 Temporary System Problem" when the account is
 * momentarily rate-limited. Those recipients were never contacted, so it
 * is worth trying again rather than recording them as hard failures.
 */
const EMAIL_MAX_ATTEMPTS = 3;

/** Backoff between retries, in milliseconds. */
const EMAIL_RETRY_DELAYS = [2_000, 5_000];

function isTransientEmailError(message: string): boolean {
  // A hard daily-cap error is NOT transient: retrying the same account
  // just burns the function's time budget. sendEmail already fails over to
  // the secondary account for those, so let the failure through.
  if (isMailboxLimitError(message)) {
    return /421|4.3.0|temporary|try again later/i.test(message);
  }
  return /421|4.3.0|454|4.7.0|temporary|try again later|too many login attempts|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|too many connections/i.test(
    message,
  );
}

/**
 * How many completed sends to buffer before flushing to Mongo.
 *
 * Stats are flushed as sends complete rather than only at the very end. If
 * the function is killed by its time budget mid-campaign, the counters and
 * the delivery rows for everything already sent are still on record — the
 * campaign no longer sits at 0/0/0.
 */
const EMAIL_FLUSH_BATCH = 10;

export async function runEmail(
  campaignId: string,
  users: Array<{ _id: Types.ObjectId; email?: string; firstName?: string }>,
  subject: string,
  bodyHtml: string,
) {
  const stats: IChannelStats = { attempted: 0, delivered: 0, failed: 0, invalidTokens: [] };
  let attempts: DeliveryAttemptRow[] = [];

  const targets = users.filter((u): u is { _id: Types.ObjectId; email: string; firstName?: string } =>
    Boolean(u.email),
  );
  stats.attempted = targets.length;

  // Publish the attempted count straight away so the panel shows the real
  // size of the job even while the sends are still in flight.
  await NotificationCampaign.findByIdAndUpdate(campaignId, { email: stats });

  // Bounded concurrency — enough parallelism to finish inside the function
  // budget without tripping SMTP rate limits.
  let cursor = 0;
  let pendingFlush: Promise<void> = Promise.resolve();

  const flush = async (): Promise<void> => {
    if (attempts.length === 0) return;
    const batch = attempts;
    attempts = [];
    await recordDeliveries(campaignId, 'email', batch);
    await NotificationCampaign.findByIdAndUpdate(campaignId, { email: stats });
  };

  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const index = cursor++;
      const u = targets[index];
      let lastError = 'unknown';

      for (let attempt = 1; attempt <= EMAIL_MAX_ATTEMPTS; attempt++) {
        try {
          await sendEmail({ to: u.email, subject, html: bodyHtml });
          stats.delivered += 1;
          attempts.push({ userId: u._id, recipient: u.email, status: 'delivered' });
          lastError = '';
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'unknown';
          // Only transient failures (rate limits, dropped sockets) are worth
          // retrying — a bad address will fail the same way every time.
          const canRetry =
            attempt < EMAIL_MAX_ATTEMPTS && isTransientEmailError(lastError);
          if (!canRetry) break;
          await new Promise((resolve) =>
            setTimeout(resolve, EMAIL_RETRY_DELAYS[attempt - 1] ?? 5_000),
          );
        }
      }

      if (lastError) {
        stats.failed += 1;
        attempts.push({
          userId: u._id,
          recipient: u.email,
          status: 'failed',
          errorMessage: lastError,
        });
      }

      if (attempts.length >= EMAIL_FLUSH_BATCH) {
        // Chain flushes so two workers never write the same rows twice.
        pendingFlush = pendingFlush.then(() => flush());
        await pendingFlush;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(EMAIL_CONCURRENCY, targets.length) }, () => worker()),
  );

  // Final flush for any remainder.
  await pendingFlush;
  await flush();
  await NotificationCampaign.findByIdAndUpdate(campaignId, { email: stats });
}

export async function runFcm(
  campaignId: string,
  users: Array<{ _id: Types.ObjectId; fcmTokens?: { token: string }[] }>,
  input: {
    pushTitle?: string;
    pushBody?: string;
    pushData?: Record<string, string>;
    subject: string;
  },
) {
  // Keep the token → user mapping so every push attempt can be attributed
  // to a recipient in the delivery log.
  const tokenOwners = users.flatMap((u) =>
    (u.fcmTokens ?? []).map((t) => ({ token: t.token, userId: u._id })),
  );
  const tokens = tokenOwners.map((t) => t.token);
  const stats: IChannelStats = { attempted: 0, delivered: 0, failed: 0, invalidTokens: [] };
  if (tokens.length === 0) {
    await NotificationCampaign.findByIdAndUpdate(campaignId, { fcm: stats });
    return;
  }
  stats.attempted = tokens.length;
  const payload: FcmPayload = {
    title: input.pushTitle || input.subject,
    body: input.pushBody || input.subject,
    data: input.pushData,
  };
  const result = await sendFcmToTokens(tokens, payload);
  stats.delivered = result.successCount;
  stats.failed = result.failureCount;
  stats.invalidTokens = result.invalidTokens;

  // sendFcmToTokens reports per-token failures; index them so we can write
  // one delivery row per token with its own reason.
  const errorByToken = new Map<string, { code?: string; message: string }>();
  for (const e of result.errors) {
    errorByToken.set(e.token, { code: e.code, message: e.message });
  }
  const ownerByToken = new Map<string, Types.ObjectId>();
  for (const t of tokenOwners) ownerByToken.set(t.token, t.userId);

  const attempts: DeliveryAttemptRow[] = tokenOwners.map(({ token, userId }) => {
    const failure = errorByToken.get(token);
    if (failure) {
      return {
        userId,
        recipient: token,
        status: 'failed',
        errorCode: failure.code,
        errorMessage: failure.message,
      };
    }
    return { userId, recipient: token, status: 'delivered' };
  });

  // Prune dead tokens so the next send is shorter.
  if (result.invalidTokens.length > 0) {
    await User.updateMany(
      { 'fcmTokens.token': { $in: result.invalidTokens } },
      { $pull: { fcmTokens: { token: { $in: result.invalidTokens } } } },
    );
  }
  await NotificationCampaign.findByIdAndUpdate(campaignId, { fcm: stats });
  await recordDeliveries(campaignId, 'fcm', attempts);
}
