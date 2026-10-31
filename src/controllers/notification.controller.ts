// controllers/notification.controller.ts
//
// Admin-only endpoints that send a campaign (email + FCM) to a filtered set
// of HisabBoi users and persist a history record. AI compose and template
// listing are also exposed here so the admin panel can call them through
// the gateway.

import { Request } from 'express';
import { Types } from 'mongoose';
import User from '../models/user.model';
import NotificationCampaign, {
  type IAudienceFilter,
  type IChannelStats,
} from '../models/notification-campaign.model';
import NotificationDelivery, {
  type DeliveryChannel,
  type DeliveryStatus,
} from '../models/notification-delivery.model';
import sendEmail, { isMailboxLimitError } from '../utils/sendEmail';
import { sendFcmToTokens, type FcmPayload } from '../utils/sendPush';
import {
  NOTIFICATION_TEMPLATES,
  renderTemplate,
  type NotificationTemplateDef,
} from '../utils/template/emailTemplates';
import { composeNotification } from '../services/aiCompose.service';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';

const buildAudienceQuery = (audience: IAudienceFilter) => {
  const q: Record<string, unknown> = {};
  if (audience.emails?.length) q.email = { $in: audience.emails };
  if (audience.userIds?.length) q._id = { $in: audience.userIds.map((id) => new Types.ObjectId(id)) };
  if (audience.roles?.length) q.role = { $in: audience.roles };
  if (audience.hasFcmToken) q['fcmTokens.0'] = { $exists: true };
  if (audience.activeInLastDays && audience.activeInLastDays > 0) {
    const since = new Date(Date.now() - audience.activeInLastDays * 24 * 60 * 60 * 1000);
    q.lastLogin = { $gte: since };
  }
  if (audience.signupFrom || audience.signupTo) {
    const range: Record<string, Date> = {};
    if (audience.signupFrom) range.$gte = audience.signupFrom;
    if (audience.signupTo) range.$lte = audience.signupTo;
    q.createdAt = range;
  }
  return q;
};

const isEmptyAudience = (a: IAudienceFilter) =>
  !a.all &&
  !a.emails?.length &&
  !a.userIds?.length &&
  !a.roles?.length &&
  !a.hasFcmToken &&
  !a.activeInLastDays &&
  !a.signupFrom &&
  !a.signupTo;

const validateSendInput = (body: Record<string, unknown>) => {
  const channels = body.channels as { email?: boolean; fcm?: boolean } | undefined;
  const audience = body.audience as IAudienceFilter | undefined;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml : '';

  if (!channels || (!channels.email && !channels.fcm)) {
    throw new ApiError(400, 'Enable at least one channel (email or fcm).');
  }
  if (!subject) throw new ApiError(400, 'subject is required.');
  if (channels.email && !bodyHtml) {
    throw new ApiError(400, 'bodyHtml is required for email channel.');
  }
  if (!audience || isEmptyAudience(audience)) {
    throw new ApiError(400, 'Provide an audience filter (audience.all, roles, …).');
  }

  return {
    subject: String(subject),
    bodyHtml: String(bodyHtml),
    preview: typeof body.preview === 'string' ? body.preview : undefined,
    audience,
    templateId: typeof body.templateId === 'string' ? body.templateId : undefined,
    variables: (body.variables as Record<string, string>) ?? undefined,
    pushTitle: typeof body.pushTitle === 'string' ? body.pushTitle : undefined,
    pushBody: typeof body.pushBody === 'string' ? body.pushBody : undefined,
    pushData: (body.pushData as Record<string, string>) ?? undefined,
    channels: { email: !!channels.email, fcm: !!channels.fcm },
  };
};

// ── listTemplates ──────────────────────────────────────────────────────────

const listTemplates = asyncHandler(async (_req: Request, res) => {
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Templates fetched',
    data: { templates: NOTIFICATION_TEMPLATES },
  });
});

// ── previewCount ───────────────────────────────────────────────────────────

const previewCount = asyncHandler(async (req: Request, res) => {
  const audience = (req.body?.audience ?? {}) as IAudienceFilter;
  if (isEmptyAudience(audience)) {
    throw new ApiError(400, 'Provide an audience filter.');
  }
  const query = buildAudienceQuery(audience);
  const count = await User.countDocuments(query);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Audience count',
    data: { count },
  });
});

// ── composeAi ──────────────────────────────────────────────────────────────

const composeAi = asyncHandler(async (req: Request, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : '';
  const tone = typeof req.body?.tone === 'string' ? req.body.tone : undefined;
  const templateHint =
    typeof req.body?.templateHint === 'string' ? req.body.templateHint : undefined;

  if (!prompt.trim()) throw new ApiError(400, 'prompt is required.');

  const result = await composeNotification({ prompt, tone, templateHint });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'AI draft ready',
    data: result,
  });
});

// ── delivery log ──────────────────────────────────────────────────────────

/**
 * One row per recipient × channel attempt, pending persistence.
 * `campaignId` and `channel` are supplied by recordDeliveries().
 */
interface DeliveryAttemptRow {
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
async function recordDeliveries(
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

// ── sendNotification ───────────────────────────────────────────────────────

const sendNotification = asyncHandler(async (req: Request, res) => {
  // Clear out any campaign left hanging by a previous timed-out run
  // before starting a new one, so the History tab never shows a stale
  // "sending" row.
  await reconcileStaleCampaigns();

  const input = validateSendInput(req.body ?? {});

  const query = buildAudienceQuery(input.audience);
  const projection = input.channels.email
    ? 'firstName email'
    : 'firstName';
  const users = await User.find(query)
    .select(`${projection} ${input.channels.fcm ? 'fcmTokens' : ''}`)
    .lean();

  const recipientCount = users.length;

  const campaign = await NotificationCampaign.create({
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    preview: input.preview,
    channels: input.channels,
    pushTitle: input.pushTitle,
    pushBody: input.pushBody,
    pushData: input.pushData,
    audience: input.audience,
    templateId: input.templateId,
    variables: input.variables,
    recipientCount,
    status: 'sending',
    startedAt: new Date(),
    createdBy: new Types.ObjectId(String(req.user?._id ?? new Types.ObjectId())),
  });

  // Await the send. On serverless (Vercel) the invocation is frozen as
  // soon as the response is written, so a fire-and-forget `void
  // runCampaign(...)` never ran to completion — campaigns stayed stuck at
  // status "sending" with every counter still at 0. Awaiting keeps the
  // function alive until the channels have been delivered and recorded.
  await runCampaign(campaign._id.toString(), users, input);

  sendResponse(res, {
    statusCode: 202,
    success: true,
    message: 'Campaign queued',
    data: {
      campaignId: campaign._id,
      recipientCount,
    },
  });
});

async function runCampaign(
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

async function runEmail(
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

async function runFcm(
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

/**
 * Reconcile campaigns that were killed mid-flight.
 *
 * A serverless invocation is frozen once it stops being awaited, so a
 * campaign whose function hit its time budget can be left at status
 * "sending" forever. On every send we sweep the stale ones: whatever was
 * delivered before the kill is already recorded, so the campaign is
 * marked "partial" (or "failed" if nothing got through) instead of
 * pretending to still be running.
 */
async function reconcileStaleCampaigns(): Promise<void> {
  try {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const stale = await NotificationCampaign.find({
      status: { $in: ['queued', 'sending'] },
      startedAt: { $lt: staleBefore },
    }).select('_id email fcm').lean();

    for (const campaign of stale) {
      const delivered = campaign.email.delivered + campaign.fcm.delivered;
      const attempted =
        (campaign.email.attempted || 0) + (campaign.fcm.attempted || 0);
      const failed = campaign.email.failed + campaign.fcm.failed;

      let status: 'partial' | 'failed' = 'partial';
      if (delivered === 0 && attempted === 0) status = 'failed';
      else if (delivered === 0) status = 'failed';

      await NotificationCampaign.findByIdAndUpdate(campaign._id, {
        status,
        completedAt: new Date(),
        errorMessage:
          'Campaign was interrupted by the server time limit. Partial results were kept.',
      });
      console.warn(
        `[notification] reconciled stale campaign ${campaign._id.toString()} -> ${status} (delivered=${delivered}, failed=${failed})`,
      );
    }
  } catch (err) {
    console.error('[notification] failed to reconcile stale campaigns:', err);
  }
}

// ── listCampaigns ──────────────────────────────────────────────────────────

const listCampaigns = asyncHandler(async (req: Request, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    NotificationCampaign.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('subject status channels recipientCount email fcm createdAt templateId')
      .lean(),
    NotificationCampaign.countDocuments({}),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Campaigns fetched',
    data: { items, total, page, limit },
  });
});

// ── getCampaign ────────────────────────────────────────────────────────────

const getCampaign = asyncHandler(async (req: Request, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid campaign id.');
  }
  const campaign = await NotificationCampaign.findById(id).lean();
  if (!campaign) throw new ApiError(404, 'Campaign not found.');
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Campaign fetched',
    data: campaign,
  });
});

// ── listDeliveries ────────────────────────────────────────────────────────

const listDeliveries = asyncHandler(async (req: Request, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid campaign id.');
  }
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const skip = (page - 1) * limit;

  const channelParam = typeof req.query.channel === 'string' ? req.query.channel : '';
  const filter: Record<string, unknown> = {
    campaignId: new Types.ObjectId(id),
  };
  if (channelParam === 'email' || channelParam === 'fcm') {
    filter.channel = channelParam;
  }

  const [items, total] = await Promise.all([
    NotificationDelivery.find(filter)
      .sort({ attemptedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    NotificationDelivery.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Deliveries fetched',
    data: { items, total, page, limit },
  });
});

// Expose template renderer for internal callers (admin previews the rendered
// HTML on the fly without going through Gemini).
export const renderNotificationTemplate = (
  templateId: string,
  variables: Record<string, string | number>,
) => {
  const tpl: NotificationTemplateDef | undefined = NOTIFICATION_TEMPLATES.find(
    (t) => t.id === templateId,
  );
  if (!tpl) throw new ApiError(404, `Template "${templateId}" not found.`);
  return {
    subject: renderTemplate(tpl.subject, variables),
    bodyHtml: renderTemplate(tpl.bodyHtml, variables),
    preview: renderTemplate(tpl.preview, variables),
    pushTitle: renderTemplate(tpl.pushTitle, variables),
    pushBody: renderTemplate(tpl.pushBody, variables),
  };
};

export const notificationController = {
  listTemplates,
  previewCount,
  composeAi,
  sendNotification,
  listCampaigns,
  getCampaign,
  listDeliveries,
};