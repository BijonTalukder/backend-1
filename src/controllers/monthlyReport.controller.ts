// controllers/monthlyReport.controller.ts
//
// Admin-only endpoints for the monthly transaction report.
//
// The report is personal: each recipient gets figures computed from their
// own businesses for the previous calendar month, worded for their business
// vertical. The admin picks users, previews exactly what each will get, and
// sends it over email + FCM.
//
// Every recipient gets their own campaign row, because a campaign stores a
// single body and a single subject. That also means the existing History tab
// and the per-recipient delivery log work unchanged for these reports.

import { Request } from 'express';
import { Types } from 'mongoose';
import User from '../models/user.model';
import Business from '../models/business.model';
import { BusinessMembersModel } from '../models/business-members.model';
import Transaction from '../models/transaction.model';
import NotificationCampaign from '../models/notification-campaign.model';
import { resolveDateRange } from '../utils/timezone';
import {
  buildMonthlyReport,
  businessTypeLabel,
  type MonthlyReport,
} from '../services/monthlyReport.service';
import {
  runCampaign,
  type CampaignTarget,
} from '../services/notificationSender.service';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';

/** How many recipients one admin may select in a single send. */
const MAX_SEND_BATCH = 200;

/** The verticals the admin panel offers as a filter. */
const FILTERABLE_BUSINESS_TYPES = [
  'retail_shop',
  'restaurant',
  'online_shop',
  'service_business',
  'freelancer',
  'wholesale',
  'other',
] as const;

const parseUserIds = (raw: unknown): string[] => {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
};

const uniqueValidIds = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!Types.ObjectId.isValid(id)) continue;
    const key = String(new Types.ObjectId(id));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
};

// ── listUsers ─────────────────────────────────────────────────────────────

/**
 * The picker data: users who belong to at least one active business, with
 * their business type and last month's totals.
 *
 * A user with no business has no report to receive, so they are left out
 * entirely. Users with no transactions last month are still listed, with
 * zero totals, so the admin can decide whether to include them.
 */
const listUsers = asyncHandler(async (req: Request, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const businessTypeFilter =
    typeof req.query.businessType === 'string' ? req.query.businessType.trim() : '';

  // The business set drives everything else, so resolve memberships first.
  const memberships = await BusinessMembersModel.find({ status: true })
    .select('user business')
    .lean();

  const businessIds = Array.from(
    new Set(
      memberships
        .map((m) => m.business)
        .filter((id): id is Types.ObjectId => Boolean(id))
        .map((id) => String(id)),
    ),
  );

  if (businessIds.length === 0) {
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Monthly report users fetched',
      data: { items: [], total: 0, page, limit },
    });
    return;
  }

  const businesses = await Business.find({
    _id: { $in: businessIds.map((id) => new Types.ObjectId(id)) },
    status: true,
  })
    .select('name businessType currency')
    .lean();

  const businessById = new Map(
    businesses.map((b) => [String(b._id), b] as const),
  );

  // User → their active businesses.
  const businessesByUser = new Map<string, typeof businesses>();
  for (const m of memberships) {
    const business = businessById.get(String(m.business));
    if (!business) continue;
    const key = String(m.user);
    const list = businessesByUser.get(key) ?? [];
    list.push(business);
    businessesByUser.set(key, list);
  }

  let userIds = Array.from(businessesByUser.keys());

  const userQuery: Record<string, unknown> = {
    _id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
    isActive: true,
  };
  if (search) {
    userQuery.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const users = await User.find(userQuery)
    .select('firstName lastName email fcmTokens')
    .lean();

  // The totals are computed for the whole candidate set, not just the page:
  // the business-type filter and the dominant-business rule both depend on
  // the transaction counts.
  const stats = await computeStatsFor(userIds);
  const totalsByUser = stats.totalsByUser;
  const countsByBusiness = stats.countsByBusiness;

  // Apply the business-type filter on the user's dominant business.
  let candidates = users.map((u) => {
    const list = businessesByUser.get(String(u._id)) ?? [];
    const dominant = pickDominant(list, countsByBusiness);
    return {
      user: u,
      business: dominant,
      businessType: dominant?.businessType ?? null,
      businessTypeLabel: businessTypeLabel(dominant?.businessType ?? null),
    };
  });

  if (businessTypeFilter && FILTERABLE_BUSINESS_TYPES.includes(businessTypeFilter as never)) {
    candidates = candidates.filter((c) => c.businessType === businessTypeFilter);
  }

  const total = candidates.length;
  const pageItems = candidates.slice(skip, skip + limit);

  const items = pageItems.map((c) => {
    const totals = totalsByUser.get(String(c.user._id));
    return {
      userId: String(c.user._id),
      firstName: c.user.firstName,
      lastName: c.user.lastName,
      email: c.user.email,
      businessType: c.businessType,
      businessTypeLabel: c.businessTypeLabel,
      businessName: c.business?.name ?? null,
      hasFcmToken: (c.user.fcmTokens ?? []).length > 0,
      income: totals?.income ?? 0,
      expense: totals?.expense ?? 0,
      net: (totals?.income ?? 0) - (totals?.expense ?? 0),
      transactionCount: totals?.transactionCount ?? 0,
    };
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Monthly report users fetched',
    data: { items, total, page, limit },
  });
});

/**
 * The business a user transacted in most.
 *
 * This mirrors the rule the report service uses, so the wording the admin
 * sees in the picker is the wording the recipient gets. Businesses with no
 * activity last month fall back to the first one, so a user who has not
 * transacted anything still gets a sensible label.
 */
function pickDominant<T extends { _id: Types.ObjectId; businessType?: string | null }>(
  businesses: T[],
  countsByBusiness: Map<string, number>,
): T | null {
  if (businesses.length === 0) return null;

  let best = businesses[0];
  let bestCount = -1;
  for (const business of businesses) {
    const count = countsByBusiness.get(String(business._id)) ?? 0;
    if (count > bestCount) {
      best = business;
      bestCount = count;
    }
  }
  return best;
}

interface MonthlyStats {
  /** Per-user totals, keyed by user id. */
  totalsByUser: Map<
    string,
    { income: number; expense: number; transactionCount: number }
  >;
  /** Per-business transaction counts, keyed by business id. */
  countsByBusiness: Map<string, number>;
}

/**
 * Last month's totals for a set of users.
 *
 * Aggregated in one pass over the transactions of all the relevant
 * businesses, then attributed to each business's members. The per-business
 * counts come out of the same pass and decide which business drives a
 * user's headline.
 */
async function computeStatsFor(userIds: string[]): Promise<MonthlyStats> {
  const empty: MonthlyStats = {
    totalsByUser: new Map(),
    countsByBusiness: new Map(),
  };
  if (userIds.length === 0) return empty;

  const memberships = await BusinessMembersModel.find({
    user: { $in: userIds.map((id) => new Types.ObjectId(id)) },
    status: true,
  })
    .select('user business')
    .lean();

  const businessIds = Array.from(
    new Set(
      memberships
        .map((m) => m.business)
        .filter((id): id is Types.ObjectId => Boolean(id))
        .map((id) => String(id)),
    ),
  );

  if (businessIds.length === 0) return empty;

  const { start, endExclusive } = resolveDateRange({ preset: 'lastmonth' });

  const rows = await Transaction.aggregate<{
    _id: { business: Types.ObjectId; type: string };
    total: number;
    count: number;
  }>([
    {
      $match: {
        business: { $in: businessIds.map((id) => new Types.ObjectId(id)) },
        date: { $gte: start, $lt: endExclusive },
      },
    },
    {
      $group: {
        _id: { business: '$business', type: '$type' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);

  const totalsByBusiness = new Map<
    string,
    { income: number; expense: number; transactionCount: number }
  >();
  const countsByBusiness = new Map<string, number>();
  for (const row of rows) {
    const key = String(row._id.business);
    const entry = totalsByBusiness.get(key) ?? {
      income: 0,
      expense: 0,
      transactionCount: 0,
    };
    entry.transactionCount += row.count ?? 0;
    if (row._id.type === 'income') entry.income += row.total ?? 0;
    else if (row._id.type === 'expense') entry.expense += row.total ?? 0;
    totalsByBusiness.set(key, entry);
    countsByBusiness.set(key, (countsByBusiness.get(key) ?? 0) + (row.count ?? 0));
  }

  const totalsByUser = new Map<
    string,
    { income: number; expense: number; transactionCount: number }
  >();
  for (const m of memberships) {
    const businessTotals = totalsByBusiness.get(String(m.business));
    if (!businessTotals) continue;
    const key = String(m.user);
    const entry = totalsByUser.get(key) ?? {
      income: 0,
      expense: 0,
      transactionCount: 0,
    };
    entry.income += businessTotals.income;
    entry.expense += businessTotals.expense;
    entry.transactionCount += businessTotals.transactionCount;
    totalsByUser.set(key, entry);
  }

  return { totalsByUser, countsByBusiness };
}

// ── preview ───────────────────────────────────────────────────────────────

/**
 * The exact subject, body and push copy each requested user will receive.
 *
 * The admin panel renders this before sending, so what they approve is what
 * lands in the inbox.
 */
const preview = asyncHandler(async (req: Request, res) => {
  const ids = uniqueValidIds(parseUserIds(req.query.userIds));
  if (ids.length === 0) {
    throw new ApiError(400, 'Provide at least one valid user id in userIds.');
  }

  const reports = await Promise.all(ids.map((id) => buildMonthlyReport(id)));
  const items = reports
    .filter((r): r is MonthlyReport => r !== null)
    .map((r) => ({
      userId: r.userId,
      firstName: r.firstName,
      email: r.email,
      businessTypeLabel: r.businessTypeLabel,
      businessName: r.businessName,
      monthLabel: r.monthLabel,
      subject: r.subject,
      bodyHtml: r.bodyHtml,
      pushTitle: r.pushTitle,
      pushBody: r.pushBody,
    }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Monthly report preview ready',
    data: { items },
  });
});

// ── send ──────────────────────────────────────────────────────────────────

/**
 * Send the monthly report to the selected users.
 *
 * Each user gets their own campaign. Sending is sequential across users:
 * the serverless function has a hard time budget, and hammering one SMTP
 * account with parallel sends is what trips Gmail's rate limiter. The email
 * and the push for a single user still go out concurrently.
 *
 * The endpoint answers with whatever it managed to send. If the function is
 * killed part-way through, the admin sees "sent N of M" and can run it again
 * for the remainder — campaigns already delivered are never re-sent.
 */
const send = asyncHandler(async (req: Request, res) => {
  const rawIds = Array.isArray(req.body?.userIds)
    ? (req.body.userIds as unknown[])
    : [];
  const ids = uniqueValidIds(rawIds.filter((id): id is string => typeof id === 'string'));

  if (ids.length === 0) {
    throw new ApiError(400, 'Select at least one user to send the report to.');
  }
  if (ids.length > MAX_SEND_BATCH) {
    throw new ApiError(
      400,
      `Too many recipients in one run — select at most ${MAX_SEND_BATCH}.`,
    );
  }

  const createdBy = new Types.ObjectId(String(req.user?._id ?? new Types.ObjectId()));

  const campaigns: Array<{
    userId: string;
    email: string;
    campaignId: string;
    status: 'sent' | 'skipped' | 'failed';
    emailDelivered: number;
    emailFailed: number;
    fcmDelivered: number;
    fcmFailed: number;
    error?: string;
  }> = [];

  const notSent: string[] = [];

  for (const userId of ids) {
    let report: MonthlyReport | null = null;
    try {
      report = await buildMonthlyReport(userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error(`[monthly-report] failed to build report for ${userId}:`, err);
      notSent.push(userId);
      campaigns.push({
        userId,
        email: '',
        campaignId: '',
        status: 'failed',
        emailDelivered: 0,
        emailFailed: 0,
        fcmDelivered: 0,
        fcmFailed: 0,
        error: message,
      });
      continue;
    }

    if (!report) {
      // No active business — there is nothing to report.
      notSent.push(userId);
      campaigns.push({
        userId,
        email: '',
        campaignId: '',
        status: 'skipped',
        emailDelivered: 0,
        emailFailed: 0,
        fcmDelivered: 0,
        fcmFailed: 0,
        error: 'This user has no active business.',
      });
      continue;
    }

    try {
      const user = await User.findById(userId)
        .select('firstName email fcmTokens')
        .lean();

      if (!user) {
        notSent.push(userId);
        campaigns.push({
          userId,
          email: report.email,
          campaignId: '',
          status: 'skipped',
          emailDelivered: 0,
          emailFailed: 0,
          fcmDelivered: 0,
          fcmFailed: 0,
          error: 'User not found.',
        });
        continue;
      }

      const campaign = await NotificationCampaign.create({
        subject: report.subject,
        bodyHtml: report.bodyHtml,
        preview: report.pushBody,
        channels: { email: true, fcm: true },
        pushTitle: report.pushTitle,
        pushBody: report.pushBody,
        audience: { userIds: [userId] },
        templateId: 'monthly-report',
        variables: {
          businessType: report.businessTypeLabel,
          businessName: report.businessName ?? '',
          monthLabel: report.monthLabel,
          income: String(report.totals.income),
          expense: String(report.totals.expense),
          net: String(report.totals.net),
          transactionCount: String(report.totals.transactionCount),
        },
        recipientCount: 1,
        status: 'sending',
        startedAt: new Date(),
        createdBy,
      });

      await runCampaign(
        campaign._id.toString(),
        [user as unknown as CampaignTarget],
        {
          subject: report.subject,
          bodyHtml: report.bodyHtml,
          channels: { email: true, fcm: true },
          pushTitle: report.pushTitle,
          pushBody: report.pushBody,
        },
      );

      const settled = await NotificationCampaign.findById(campaign._id)
        .select('email fcm')
        .lean();

      const emailDelivered = settled?.email.delivered ?? 0;
      const emailFailed = settled?.email.failed ?? 0;
      const fcmDelivered = settled?.fcm.delivered ?? 0;
      const fcmFailed = settled?.fcm.failed ?? 0;

      const deliveredSomething = emailDelivered + fcmDelivered > 0;
      if (!deliveredSomething) notSent.push(userId);

      campaigns.push({
        userId,
        email: user.email,
        campaignId: campaign._id.toString(),
        status: deliveredSomething ? 'sent' : 'failed',
        emailDelivered,
        emailFailed,
        fcmDelivered,
        fcmFailed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.error(`[monthly-report] failed to send report to ${userId}:`, err);
      notSent.push(userId);
      campaigns.push({
        userId,
        email: report.email,
        campaignId: '',
        status: 'failed',
        emailDelivered: 0,
        emailFailed: 0,
        fcmDelivered: 0,
        fcmFailed: 0,
        error: message,
      });
    }
  }

  const sent = campaigns.filter((c) => c.status === 'sent').length;

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: `Sent ${sent} of ${ids.length} monthly reports.`,
    data: {
      campaigns,
      summary: {
        requested: ids.length,
        succeeded: sent,
        failed: campaigns.filter((c) => c.status === 'failed').length,
        skipped: campaigns.filter((c) => c.status === 'skipped').length,
        notSent,
      },
    },
  });
});

export const monthlyReportController = {
  listUsers,
  preview,
  send,
};
