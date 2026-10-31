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
import NotificationDelivery from '../models/notification-delivery.model';
import {
  runCampaign,
  type CampaignInput,
  type CampaignTarget,
} from '../services/notificationSender.service';
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

// ── sendNotification ───────────────────────────────────────────────────────

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
  await runCampaign(
    campaign._id.toString(),
    users as CampaignTarget[],
    input as CampaignInput,
  );

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

// ── deleteCampaign ────────────────────────────────────────────────────────

/**
 * Delete a campaign and its per-recipient delivery rows.
 *
 * A campaign still in flight cannot be deleted — the delivery loop holds a
 * reference to it and would keep writing counters to a document that no
 * longer exists. Wait for it to settle, then delete.
 */
const deleteCampaign = asyncHandler(async (req: Request, res) => {
  const id = req.params.id;
  if (!id || Array.isArray(id) || !Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid campaign id.');
  }

  const campaign = await NotificationCampaign.findById(id).lean();
  if (!campaign) throw new ApiError(404, 'Campaign not found.');

  if (campaign.status === 'sending' || campaign.status === 'queued') {
    throw new ApiError(
      409,
      'This campaign is still running. Wait for it to finish before deleting.',
    );
  }

  // The delivery rows belong to the campaign — remove them too, otherwise
  // they linger forever with no way to reach them from the panel.
  const deletedDeliveries = await NotificationDelivery.deleteMany({
    campaignId: new Types.ObjectId(id),
  });

  await NotificationCampaign.findByIdAndDelete(id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Campaign deleted',
    data: {
      campaignId: id,
      deletedDeliveries: deletedDeliveries.deletedCount ?? 0,
    },
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
  deleteCampaign,
  listDeliveries,
};