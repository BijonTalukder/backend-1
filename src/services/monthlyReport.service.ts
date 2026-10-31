// services/monthlyReport.service.ts
//
// Builds a per-user "here is how last month went" report from that user's
// own business transactions, and renders it as an email + push message.
//
// The report is personal: a user who runs a restaurant sees restaurant
// wording, a freelancer sees freelancer wording, and the numbers come from
// the businesses that user is actually a member of.
//
// Reporting period is always the previous calendar month in the business
// timezone (Asia/Dhaka), resolved by resolveDateRange() so the boundaries
// are start-inclusive / end-exclusive and cannot drift by a day.

import { Types } from 'mongoose';
import User from '../models/user.model';
import Business from '../models/business.model';
import { BusinessMembersModel } from '../models/business-members.model';
import Transaction from '../models/transaction.model';
import { resolveDateRange } from '../utils/timezone';
import { cashbookEmailBase } from '../utils/template/emailTemplates';

/** Where users can get help. Shown at the end of every report. */
export const SUPPORT_PHONE = '01632354922';
export const SUPPORT_LINK = 'https://hisabboi.vercel.app/';
export const FACEBOOK_LINK = 'https://www.facebook.com/hisabboy/';

/**
 * Human labels for the business verticals. A user in "retail_shop" gets a
 * report headed "Your Retail Shop".
 */
const BUSINESS_TYPE_LABELS: Record<string, string> = {
  retail_shop: 'Retail Shop',
  restaurant: 'Restaurant',
  online_shop: 'Online Shop',
  service_business: 'Service Business',
  freelancer: 'Freelancer',
  wholesale: 'Wholesale Business',
  other: 'Business',
};

/** Used when the business has no vertical set (personal / mess / cashbook mode). */
const GENERIC_LABEL = 'Your Business';

export interface MonthlyReportTotals {
  income: number;
  expense: number;
  net: number;
  transactionCount: number;
  topIncomeCategory: { name: string; amount: number } | null;
  topExpenseCategory: { name: string; amount: number } | null;
}

export interface MonthlyReport {
  userId: string;
  firstName: string;
  email: string;
  /** e.g. 'Retail Shop' — drives the headline. */
  businessTypeLabel: string;
  /** The raw vertical key, e.g. 'retail_shop'. Null for non-business modes. */
  businessType: string | null;
  businessName: string | null;
  /** e.g. 'October 2026'. */
  monthLabel: string;
  currency: string;
  totals: MonthlyReportTotals;
  subject: string;
  bodyHtml: string;
  pushTitle: string;
  pushBody: string;
}

/** A user's business, reduced to what the report needs. */
interface UserBusiness {
  _id: Types.ObjectId;
  name: string;
  businessType: string | null;
  currency: string;
  createdAt: Date;
}

/**
 * Format a number as Bangladeshi Taka.
 *
 * Amounts are plain numbers in the database (BDT, no minor units). We round
 * to whole Taka because a report showing "৳85,000.37" implies a precision
 * the underlying data does not really have.
 */
const formatMoney = (amount: number): string =>
  `৳${Math.round(amount).toLocaleString('en-US')}`;

/**
 * A human month label for the reporting period.
 *
 * `start` is the first instant of the month in local time, but it is stored
 * as a UTC Date. To read the month off it we shift forward by the Dhaka
 * offset before reading the UTC fields.
 */
const monthLabelFor = (start: Date, offsetMinutes = 360): string => {
  const local = new Date(start.getTime() + offsetMinutes * 60 * 1000);
  return local.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/**
 * Resolve the businesses a user belongs to.
 *
 * BusinessMembers is the source of truth: createBusiness writes an 'owner'
 * row for the creator, so owner-only businesses are covered too.
 */
export async function getUserBusinesses(
  userId: string,
): Promise<UserBusiness[]> {
  if (!Types.ObjectId.isValid(userId)) return [];

  const memberships = await BusinessMembersModel.find({
    user: new Types.ObjectId(userId),
    status: true,
  })
    .select('business')
    .lean();

  const businessIds = memberships
    .map((m) => m.business)
    .filter((id): id is Types.ObjectId => Boolean(id));

  if (businessIds.length === 0) return [];

  const businesses = await Business.find({
    _id: { $in: businessIds },
    status: true,
  })
    .select('name businessType currency createdAt')
    .lean();

  return businesses.map((b) => ({
    _id: b._id,
    name: b.name,
    businessType: b.businessType ?? null,
    currency: b.currency || 'BDT',
    createdAt: b.createdAt,
  }));
}

interface AggregateResult {
  income: number;
  expense: number;
  transactionCount: number;
  topIncomeCategory: { name: string; amount: number } | null;
  topExpenseCategory: { name: string; amount: number } | null;
  /** Transactions per business, so we can pick the dominant one for the label. */
  perBusiness: Map<string, number>;
}

const EMPTY_AGGREGATE: AggregateResult = {
  income: 0,
  expense: 0,
  transactionCount: 0,
  topIncomeCategory: null,
  topExpenseCategory: null,
  perBusiness: new Map(),
};

/**
 * Aggregate last month's transactions across the given businesses.
 *
 * Transfers are excluded from income and expense: moving money between
 * accounts is not income. The count still includes them so the report
 * reflects everything that happened.
 */
export async function aggregateMonthlyTotals(
  businessIds: Types.ObjectId[],
): Promise<AggregateResult> {
  if (businessIds.length === 0) return EMPTY_AGGREGATE;

  const { start, endExclusive } = resolveDateRange({ preset: 'lastmonth' });

  // Per-business totals and counts.
  //
  // The type lives inside _id because that is where $group puts it — there
  // is no top-level "type" field on the result rows.
  const rows = await Transaction.aggregate<{
    _id: { business: Types.ObjectId; type: string };
    total: number;
    count: number;
  }>([
    {
      $match: {
        business: { $in: businessIds },
        // Start-inclusive, end-exclusive — see resolveDateRange().
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

  // A second pass finds the top category per income/expense type.
  const categoryRows = await Transaction.aggregate<{
    _id: { type: string; category: Types.ObjectId };
    name: string;
    amount: number;
  }>([
    {
      $match: {
        business: { $in: businessIds },
        date: { $gte: start, $lt: endExclusive },
        type: { $in: ['income', 'expense'] },
      },
    },
    {
      $lookup: {
        from: 'transactioncategories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryDoc',
      },
    },
    { $unwind: { path: '$categoryDoc', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { type: '$type', category: '$category' },
        name: { $first: '$categoryDoc.name' },
        amount: { $sum: '$amount' },
      },
    },
    { $sort: { amount: -1 } },
  ]);

  const result: AggregateResult = {
    income: 0,
    expense: 0,
    transactionCount: 0,
    topIncomeCategory: null,
    topExpenseCategory: null,
    perBusiness: new Map(),
  };

  for (const row of rows) {
    const businessKey = String(row._id.business);
    const count = row.count ?? 0;
    result.perBusiness.set(
      businessKey,
      (result.perBusiness.get(businessKey) ?? 0) + count,
    );
    result.transactionCount += count;
    const type = String(row._id.type ?? '');
    if (type === 'income') result.income += row.total ?? 0;
    else if (type === 'expense') result.expense += row.total ?? 0;
  }

  for (const row of categoryRows) {
    const name = row.name || 'Other';
    const entry = { name, amount: row.amount ?? 0 };
    const type = String(row._id.type ?? '');
    if (type === 'income' && !result.topIncomeCategory) {
      result.topIncomeCategory = entry;
    } else if (type === 'expense' && !result.topExpenseCategory) {
      result.topExpenseCategory = entry;
    }
  }

  return result;
}

/**
 * Decide which business the report should be written for.
 *
 * A user can belong to several businesses with different verticals. The one
 * they transacted in most is the one their month is really about, so it
 * drives the headline. The totals still cover every business they are in.
 */
function pickDominantBusiness(
  businesses: UserBusiness[],
  totals: AggregateResult,
): UserBusiness | null {
  if (businesses.length === 0) return null;

  let best = businesses[0];
  let bestCount = -1;
  for (const business of businesses) {
    const count = totals.perBusiness.get(String(business._id)) ?? 0;
    if (count > bestCount) {
      best = business;
      bestCount = count;
    }
  }
  return best;
}

/** The label shown in the headline, derived from the business vertical. */
export function businessTypeLabel(businessType: string | null): string {
  if (!businessType) return GENERIC_LABEL;
  return BUSINESS_TYPE_LABELS[businessType] ?? GENERIC_LABEL;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Render the report body.
 *
 * Inline styles only — Gmail strips <style> blocks, so every rule has to
 * live on the element itself.
 */
function renderReportBody(
  report: Omit<MonthlyReport, 'subject' | 'bodyHtml' | 'pushTitle' | 'pushBody'>,
): string {
  const { firstName, businessTypeLabel: label, monthLabel, totals } = report;

  const metricRow = (name: string, value: string, color: string) => `
    <td style="padding:10px 0;text-align:center;border-right:1px solid rgba(255,255,255,0.06);">
      <div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;">${name}</div>
      <div style="color:${color};font-size:20px;font-weight:700;margin-top:4px;">${value}</div>
    </td>`;

  const categoryRow = (
    labelText: string,
    entry: { name: string; amount: number } | null,
  ) => `
    <tr>
      <td style="padding:9px 0;color:#94a3b8;font-size:13px;width:45%;">${labelText}</td>
      <td style="padding:9px 0;color:#e2e8f0;font-size:13px;">${entry ? escapeHtml(entry.name) : '—'}</td>
      <td style="padding:9px 0;color:#e2e8f0;font-size:13px;text-align:right;font-weight:600;">${entry ? formatMoney(entry.amount) : '—'}</td>
    </tr>`;

  const noActivity = `
    <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:20px;text-align:center;margin:18px 0;">
      <div style="color:#cbd5e1;font-size:14px;">No transactions were recorded last month.</div>
      <div style="color:#64748b;font-size:13px;margin-top:6px;">Add your income and expenses in HisabBoi to see them here next month.</div>
    </div>`;

  const summary = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:rgba(255,255,255,0.04);border-radius:12px;">
      <tr>
        ${metricRow('Income', formatMoney(totals.income), '#10b981')}
        ${metricRow('Expense', formatMoney(totals.expense), '#f87171')}
        ${metricRow('Net', formatMoney(totals.net), totals.net >= 0 ? '#10b981' : '#f87171')}
      </tr>
    </table>`;

  const breakdown = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">
      <tr>
        <td style="padding:0 0 8px;color:#e2e8f0;font-size:15px;font-weight:700;">Where it came from</td>
      </tr>
      ${categoryRow('Top income', totals.topIncomeCategory)}
      ${categoryRow('Top expense', totals.topExpenseCategory)}
      <tr>
        <td style="padding:9px 0;color:#94a3b8;font-size:13px;border-top:1px solid rgba(255,255,255,0.06);">Transactions</td>
        <td style="padding:9px 0;color:#e2e8f0;font-size:13px;border-top:1px solid rgba(255,255,255,0.06);">Total</td>
        <td style="padding:9px 0;color:#e2e8f0;font-size:13px;text-align:right;font-weight:600;border-top:1px solid rgba(255,255,255,0.06);">${totals.transactionCount}</td>
      </tr>
    </table>`;

  const support = `
    <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:18px;margin:22px 0 4px;">
      <div style="color:#10b981;font-size:14px;font-weight:700;margin-bottom:8px;">Need help?</div>
      <div style="color:#cbd5e1;font-size:13px;line-height:1.7;">
        Call or WhatsApp: <a href="https://wa.me/8801632354922" style="color:#10b981;font-weight:600;text-decoration:none;">${SUPPORT_PHONE}</a><br/>
        Visit: <a href="${SUPPORT_LINK}" style="color:#10b981;font-weight:600;text-decoration:none;">${SUPPORT_LINK}</a><br/>
        Facebook: <a href="${FACEBOOK_LINK}" style="color:#10b981;font-weight:600;text-decoration:none;">${FACEBOOK_LINK}</a>
      </div>
    </div>`;

  const body = `
    <p style="margin:0 0 6px;color:#94a3b8;font-size:13px;">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 4px;color:#e2e8f0;font-size:15px;line-height:1.7;">
      Here is how your <strong>${escapeHtml(label)}</strong> did in ${escapeHtml(monthLabel)}.
    </p>
    ${totals.transactionCount > 0 ? summary + breakdown : noActivity}
    ${support}`;

  return cashbookEmailBase({
    label: 'Monthly report',
    title: `Your <span style="color:#10b981;">${escapeHtml(monthLabel)}</span> summary`,
    bodyHtml: body,
    footer: `HisabBoi · ${SUPPORT_PHONE} · ${SUPPORT_LINK}`,
  });
}

/**
 * Build the report for one user.
 *
 * Returns null when the user has no active business — there is no report
 * to send them.
 */
export async function buildMonthlyReport(
  userId: string,
): Promise<MonthlyReport | null> {
  if (!Types.ObjectId.isValid(userId)) return null;

  const [user, businesses] = await Promise.all([
    User.findById(userId).select('firstName email').lean(),
    getUserBusinesses(userId),
  ]);

  if (!user || businesses.length === 0) return null;

  const totals = await aggregateMonthlyTotals(businesses.map((b) => b._id));
  const dominant = pickDominantBusiness(businesses, totals);
  const { start } = resolveDateRange({ preset: 'lastmonth' });
  const monthLabel = monthLabelFor(start);

  const label = businessTypeLabel(dominant?.businessType ?? null);

  const base = {
    userId: String(user._id),
    firstName: user.firstName,
    email: user.email,
    businessTypeLabel: label,
    businessType: dominant?.businessType ?? null,
    businessName: dominant?.name ?? null,
    monthLabel,
    currency: dominant?.currency || 'BDT',
    totals: {
      income: totals.income,
      expense: totals.expense,
      net: totals.income - totals.expense,
      transactionCount: totals.transactionCount,
      topIncomeCategory: totals.topIncomeCategory,
      topExpenseCategory: totals.topExpenseCategory,
    },
  };

  return {
    ...base,
    bodyHtml: renderReportBody(base),
    subject: `Your ${monthLabel} summary — ${label} · HisabBoi`,
    pushTitle: `Your ${monthLabel} summary`,
    pushBody:
      totals.transactionCount > 0
        ? `Income ${formatMoney(totals.income)} · Expense ${formatMoney(totals.expense)} · Net ${formatMoney(totals.income - totals.expense)}. Tap to see the breakdown.`
        : 'No transactions recorded last month. Tap to get started.',
  };
}

/**
 * Build reports for several users.
 *
 * Each user's aggregation is done separately because their business set
 * differs, but they run concurrently — the queries are cheap and the panel
 * only ever asks for a page worth of users.
 */
export async function buildMonthlyReportsFor(
  userIds: string[],
): Promise<MonthlyReport[]> {
  const unique = Array.from(
    new Set(userIds.filter((id) => Types.ObjectId.isValid(id))),
  );
  if (unique.length === 0) return [];

  const reports = await Promise.all(unique.map((id) => buildMonthlyReport(id)));
  return reports.filter((r): r is MonthlyReport => r !== null);
}
