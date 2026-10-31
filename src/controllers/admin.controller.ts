// Platform-wide aggregates + paginated lists for the admin panel.
// Reachable from the language-larn gateway via the static
// X-Internal-Service-Key header (see middleware/auth.middleware.ts),
// which injects a super_admin identity past the authorizeRoles gate.

import { Request, Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';

import User from '../models/user.model';
import Business from '../models/business.model';
import Product from '../models/product.model';
import Sale from '../models/sale.model';
import Customer from '../models/customer.model';
import Supplier from '../models/supplier.model';
import Transaction from '../models/transaction.model';
import {
  resolveDateRange,
  DHAKA_OFFSET_MINUTES,
} from '../utils/timezone';

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function normalisePageParams(req: Request) {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  return { page, limit, search };
}

function buildMeta(total: number, page: number, limit: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNextPage: page * limit < total,
    hasPrevPage: page > 1,
  };
}

interface PlatformStats {
  totalUsers: number;
  totalBusinesses: number;
  totalProducts: number;
  totalSales: number;
  totalCustomers: number;
  totalSuppliers: number;
  totalTransactions: number;
  totalRevenue: number;
  totalDue: number;
}

async function computePlatformStats(): Promise<PlatformStats> {
  const [
    totalUsers,
    totalBusinesses,
    totalProducts,
    totalSales,
    totalCustomers,
    totalSuppliers,
    totalTransactions,
    revenueAgg,
    dueAgg,
  ] = await Promise.all([
    User.countDocuments({}),
    Business.countDocuments({}),
    Product.countDocuments({}),
    Sale.countDocuments({}),
    Customer.countDocuments({}),
    Supplier.countDocuments({}),
    Transaction.countDocuments({}),
    Sale.aggregate<{ _id: null; total: number }>([
      { $group: { _id: null, total: { $sum: '$paidAmount' } } },
    ]),
    Sale.aggregate<{ _id: null; total: number }>([
      { $group: { _id: null, total: { $sum: '$dueAmount' } } },
    ]),
  ]);

  return {
    totalUsers,
    totalBusinesses,
    totalProducts,
    totalSales,
    totalCustomers,
    totalSuppliers,
    totalTransactions,
    totalRevenue: revenueAgg[0]?.total ?? 0,
    totalDue: dueAgg[0]?.total ?? 0,
  };
}

// Zero-fill a daily series so chart output never has missing days.
function fillDailyBuckets<T, R>(
  start: Date,
  days: number,
  source: Map<string, T>,
  shape: (key: string, bucket: T | undefined) => R,
): R[] {
  const out: R[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push(shape(key, source.get(key)));
  }
  return out;
}

export const getOverview = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await computePlatformStats();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Overview fetched',
    data: { stats },
  });
});

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await computePlatformStats();
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Stats fetched',
    data: stats,
  });
});

export const getUserGrowth = asyncHandler(async (req: Request, res: Response) => {
  const safeDays = clampInt(req.query.days, 30, 1, 365);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));

  const buckets = await User.aggregate<{ _id: string; count: number }>([
    { $match: { createdAt: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = new Map(buckets.map((b) => [b._id, b.count]));
  const out = fillDailyBuckets(start, safeDays, counts, (key, bucket) => ({
    date: key,
    count: bucket ?? 0,
  }));
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'User growth fetched',
    data: out,
  });
});

export const getRecentSignups = asyncHandler(async (req: Request, res: Response) => {
  const limit = clampInt(req.query.limit, 10, 1, 50);
  const docs = await User.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('firstName lastName email role isActive createdAt')
    .lean();

  const items = docs.map((u) => ({
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    isActive: Boolean(u.isActive),
    createdAt: u.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Recent signups fetched',
    data: items,
  });
});

export const getRevenueTrend = asyncHandler(async (req: Request, res: Response) => {
  const safeDays = clampInt(req.query.days, 30, 1, 365);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));

  const buckets = await Sale.aggregate<{
    _id: string;
    total: number;
    saleCount: number;
  }>([
    { $match: { date: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        total: { $sum: '$paidAmount' },
        saleCount: { $sum: 1 },
      },
    },
  ]);

  const map = new Map(buckets.map((b) => [b._id, b]));
  const out = fillDailyBuckets(start, safeDays, map, (key, bucket) => ({
    date: key,
    total: bucket?.total ?? 0,
    saleCount: bucket?.saleCount ?? 0,
  }));
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Revenue trend fetched',
    data: out,
  });
});

export const getSalesStatusBreakdown = asyncHandler(async (_req: Request, res: Response) => {
  const buckets = await Sale.aggregate<{ _id: 'paid' | 'partial' | 'due'; count: number }>([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const map = new Map(buckets.map((b) => [b._id, b.count]));
  const paid = map.get('paid') ?? 0;
  const partial = map.get('partial') ?? 0;
  const due = map.get('due') ?? 0;

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Sales status fetched',
    data: { paid, partial, due, total: paid + partial + due },
  });
});

export const getPaymentMethodBreakdown = asyncHandler(async (_req: Request, res: Response) => {
  const buckets = await Sale.aggregate<{
    _id: string;
    saleCount: number;
    total: number;
    due: number;
  }>([
    {
      $group: {
        _id: { $ifNull: ['$paymentMethod', 'unknown'] },
        saleCount: { $sum: 1 },
        total: { $sum: '$paidAmount' },
        due: { $sum: '$dueAmount' },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const data = buckets.map((b) => ({
    paymentMethod: b._id,
    saleCount: b.saleCount,
    total: b.total ?? 0,
    due: b.due ?? 0,
  }));
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Payment methods fetched',
    data,
  });
});

export const getBusinessTypeMix = asyncHandler(async (_req: Request, res: Response) => {
  const buckets = await Business.aggregate<{ _id: string; count: number }>([
    {
      $group: {
        _id: { $ifNull: ['$businessType', 'unknown'] },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const data = buckets.map((b) => ({ businessType: b._id, count: b.count }));
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Business type mix fetched',
    data,
  });
});

export const getTopBusinessesByRevenue = asyncHandler(async (req: Request, res: Response) => {
  const safeLimit = clampInt(req.query.limit, 5, 1, 50);

  const buckets = await Sale.aggregate<{
    _id: string;
    revenue: number;
    saleCount: number;
    due: number;
  }>([
    {
      $group: {
        _id: '$business',
        revenue: { $sum: '$paidAmount' },
        saleCount: { $sum: 1 },
        due: { $sum: '$dueAmount' },
      },
    },
    { $match: { _id: { $ne: null } } },
    { $sort: { revenue: -1 } },
    { $limit: safeLimit },
  ]);

  if (buckets.length === 0) {
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: 'Top businesses fetched',
      data: [],
    });
    return;
  }

  const ids = buckets.map((b) => b._id);
  const businesses = await Business.find({ _id: { $in: ids } })
    .select('name businessType')
    .lean();
  const byId = new Map(businesses.map((b) => [String(b._id), b]));

  const data = buckets.map((b) => {
    const biz = byId.get(String(b._id));
    return {
      id: String(b._id),
      name: biz?.name ?? 'Unknown',
      businessType: biz?.businessType ?? null,
      revenue: b.revenue ?? 0,
      saleCount: b.saleCount ?? 0,
      due: b.due ?? 0,
    };
  });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Top businesses fetched',
    data,
  });
});

export const getAuthProviderSplit = asyncHandler(async (_req: Request, res: Response) => {
  const buckets = await User.aggregate<{ _id: string; count: number }>([
    {
      $group: {
        _id: { $ifNull: ['$authProvider', 'unknown'] },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const data = buckets.map((b) => ({ provider: b._id, count: b.count }));
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Auth providers fetched',
    data,
  });
});

// ── Live activity ───────────────────────────────────────────────────────────
//
// "Today" always means the Asia/Dhaka calendar day. resolveDateRange gives
// start-inclusive / end-exclusive UTC boundaries, so a transaction recorded
// at 23:59 Dhaka lands in today and 00:00 tomorrow does not.
//
// Two different timestamps exist on a transaction and they answer different
// questions:
//   • createdAt — when the row was written. The truthful activity measure.
//   • date      — the day the user filed it under. Backdatable, so it can
//                 point at a different day than createdAt.
// Both are reported so the admin can see the difference.

/** Human label for a day, e.g. "1 November 2026", in Dhaka time. */
function formatDhakaDay(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Every counter the Dashboard's "Today" card needs, plus today's hourly
 * distribution — one endpoint so the page does not need four round-trips.
 */
export const getTodayActivity = asyncHandler(async (_req: Request, res: Response) => {
  const range = resolveDateRange({ preset: 'today' }, DHAKA_OFFSET_MINUTES);
  const { start, endExclusive } = range;

  const [
    transactionsRecordedToday,
    transactionsDatedToday,
    backdatedToday,
    usersLoggedInToday,
    activeBusinessesToday,
    hourlyRows,
  ] = await Promise.all([
    // Recorded today — the insertion time.
    Transaction.countDocuments({ createdAt: { $gte: start, $lt: endExclusive } }),
    // Dated today — the day the user filed it under.
    Transaction.countDocuments({ date: { $gte: start, $lt: endExclusive } }),
    // Filed under today but actually written before today.
    Transaction.countDocuments({
      date: { $gte: start, $lt: endExclusive },
      createdAt: { $lt: start },
    }),
    User.countDocuments({ lastLogin: { $gte: start, $lt: endExclusive } }),
    // Businesses that are both active and saw a transaction today. A
    // deactivated business can still hold historical rows, so counting the
    // raw distinct ids would overstate how many businesses are running.
    Business.aggregate<{ count: number }>([
      { $match: { status: true } },
      {
        $lookup: {
          from: 'transactions',
          let: { businessId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$business', '$businessId'] },
                date: { $gte: start, $lt: endExclusive },
              },
            },
            { $count: 'count' },
          ],
          as: 'todayActivity',
        },
      },
      { $match: { todayActivity: { $gt: [] } } },
      { $count: 'count' },
    ]),
    Transaction.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: start, $lt: endExclusive } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%H',
              date: '$createdAt',
              timezone: 'Asia/Dhaka',
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const hourlyCounts = new Map(hourlyRows.map((h) => [Number(h._id), h.count]));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: hourlyCounts.get(hour) ?? 0,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Today activity fetched',
    data: {
      dateLabel: formatDhakaDay(start),
      start,
      end: endExclusive,
      transactionsRecordedToday,
      transactionsDatedToday,
      backdatedToday,
      usersLoggedInToday,
      activeBusinessesToday: activeBusinessesToday[0]?.count ?? 0,
      hourly,
    },
  });
});

/**
 * The newest transactions by insertion time, with the related business,
 * member and category names hydrated in a single aggregation (no N+1).
 */
export const getLatestTransactions = asyncHandler(async (req: Request, res: Response) => {
  const safeLimit = clampInt(req.query.limit, 20, 1, 100);

  const rows = await Transaction.aggregate<{
    _id: unknown;
    type: string;
    amount: number;
    paymentMethod: string | null;
    settlementStatus: string;
    note: string | null;
    date: Date;
    createdAt: Date;
    businessName: string | null;
    memberName: string | null;
    categoryName: string | null;
  }>([
    { $sort: { createdAt: -1 } },
    { $limit: safeLimit },
    {
      $lookup: {
        from: 'businesses',
        localField: 'business',
        foreignField: '_id',
        as: 'businessDoc',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'member',
        foreignField: '_id',
        as: 'memberDoc',
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
    {
      $project: {
        type: 1,
        amount: 1,
        paymentMethod: 1,
        settlementStatus: 1,
        note: 1,
        date: 1,
        createdAt: 1,
        businessName: { $ifNull: [{ $first: '$businessDoc.name' }, null] },
        memberName: {
          $ifNull: [
            {
              $concat: [
                { $ifNull: [{ $first: '$memberDoc.firstName' }, ''] },
                ' ',
                { $ifNull: [{ $first: '$memberDoc.lastName' }, ''] },
              ],
            },
            null,
          ],
        },
        categoryName: { $ifNull: [{ $first: '$categoryDoc.name' }, null] },
      },
    },
  ]);

  const items = rows.map((t) => ({
    id: String(t._id),
    type: t.type,
    amount: t.amount ?? 0,
    paymentMethod: t.paymentMethod ?? null,
    settlementStatus: t.settlementStatus,
    note: t.note ?? null,
    businessName: t.businessName ?? null,
    memberName: t.memberName?.trim() ? t.memberName.trim() : null,
    categoryName: t.categoryName ?? null,
    datedAt: t.date,
    recordedAt: t.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Latest transactions fetched',
    data: items,
  });
});

/**
 * The most recent successful sign-ins. Users who have never logged in have
 * no lastLogin and are simply absent.
 */
export const getRecentLogins = asyncHandler(async (req: Request, res: Response) => {
  const safeLimit = clampInt(req.query.limit, 20, 1, 100);

  const docs = await User.find({ lastLogin: { $ne: null } })
    .sort({ lastLogin: -1 })
    .limit(safeLimit)
    .select('firstName lastName email role authProvider lastLogin createdAt')
    .lean();

  const items = docs.map((u) => ({
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    authProvider: u.authProvider,
    lastLoginAt: u.lastLogin,
    registeredAt: u.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Recent logins fetched',
    data: items,
  });
});

/**
 * Daily activity: transactions recorded vs. users who logged in, over the
 * last N days. Two sources, one dense series — gaps are zero-filled so the
 * chart never skips a day.
 */
export const getActivityTrend = asyncHandler(async (req: Request, res: Response) => {
  const safeDays = clampInt(req.query.days, 30, 1, 365);
  // "Today" gives the Dhaka calendar boundaries; the window then walks
  // backwards `days - 1` days from the start of today.
  const today = resolveDateRange({ preset: 'today' }, DHAKA_OFFSET_MINUTES);
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(today.start.getTime() - (safeDays - 1) * dayMs);
  const endExclusive = today.endExclusive;

  const [txnRows, loginRows] = await Promise.all([
    Transaction.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: start, $lt: endExclusive } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'Asia/Dhaka',
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    User.aggregate<{ _id: string; count: number }>([
      { $match: { lastLogin: { $gte: start, $lt: endExclusive } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$lastLogin',
              timezone: 'Asia/Dhaka',
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const txnCounts = new Map(txnRows.map((r) => [r._id, r.count]));
  const loginCounts = new Map(loginRows.map((r) => [r._id, r.count]));

  const points = fillDailyBuckets(
    start,
    safeDays,
    txnCounts,
    (key, bucket) => ({
      date: key,
      transactions: bucket ?? 0,
      logins: loginCounts.get(key) ?? 0,
    }),
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Activity trend fetched',
    data: { start, end: endExclusive, days: safeDays, points },
  });
});

/**
 * The categories that moved the most money over the window.
 */
export const getTopCategories = asyncHandler(async (req: Request, res: Response) => {
  const safeDays = clampInt(req.query.days, 30, 1, 365);
  const today = resolveDateRange({ preset: 'today' }, DHAKA_OFFSET_MINUTES);
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(today.start.getTime() - (safeDays - 1) * dayMs);
  const endExclusive = today.endExclusive;

  const rows = await Transaction.aggregate<{
    _id: { type: string; category: unknown };
    name: string | null;
    amount: number;
    count: number;
  }>([
    {
      $match: {
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
        count: { $sum: 1 },
      },
    },
    { $sort: { amount: -1 } },
    { $limit: 25 },
  ]);

  const items = rows.map((r) => ({
    name: r.name ?? 'Uncategorised',
    type: r._id.type === 'income' ? 'income' : 'expense',
    amount: r.amount ?? 0,
    count: r.count ?? 0,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Top categories fetched',
    data: { days: safeDays, items },
  });
});

// ── Lists ──────────────────────────────────────────────────────────────────

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = normalisePageParams(req);

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('firstName lastName email role isActive authProvider lastLogin createdAt')
      .lean(),
    User.countDocuments(filter),
  ]);

  const items = docs.map((u) => ({
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    isActive: Boolean(u.isActive),
    authProvider: u.authProvider,
    lastLogin: u.lastLogin ?? null,
    createdAt: u.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Users fetched',
    data: { items, total, page, limit },
    meta: buildMeta(total, page, limit),
  });
});

export const listBusinesses = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = normalisePageParams(req);

  const filter: Record<string, unknown> = {};
  if (search) filter.name = { $regex: search, $options: 'i' };

  const [docs, total] = await Promise.all([
    Business.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('name owner type businessType currency status cashBalance bankBalance createdAt')
      .lean(),
    Business.countDocuments(filter),
  ]);

  const items = docs.map((b) => ({
    id: String(b._id),
    name: b.name,
    owner: b.owner ? String(b.owner) : null,
    type: b.type,
    businessType: b.businessType ?? null,
    currency: b.currency,
    status: Boolean(b.status),
    cashBalance: b.cashBalance ?? 0,
    bankBalance: b.bankBalance ?? 0,
    createdAt: b.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Businesses fetched',
    data: { items, total, page, limit },
    meta: buildMeta(total, page, limit),
  });
});

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = normalisePageParams(req);

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku: { $regex: search, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'business name sku category purchasePrice sellingPrice stock minStock unit status createdAt',
      )
      .lean(),
    Product.countDocuments(filter),
  ]);

  const items = docs.map((p) => ({
    id: String(p._id),
    business: p.business ? String(p.business) : null,
    name: p.name,
    sku: p.sku ?? null,
    category: p.category ?? null,
    purchasePrice: p.purchasePrice ?? 0,
    sellingPrice: p.sellingPrice ?? 0,
    stock: p.stock ?? 0,
    minStock: p.minStock ?? 0,
    unit: p.unit,
    status: Boolean(p.status),
    createdAt: p.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Products fetched',
    data: { items, total, page, limit },
    meta: buildMeta(total, page, limit),
  });
});

export const listSales = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = normalisePageParams(req);

  const filter: Record<string, unknown> = {};
  if (search) filter.invoiceNumber = { $regex: search, $options: 'i' };

  const [docs, total] = await Promise.all([
    Sale.find(filter)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'business customer invoiceNumber total paidAmount dueAmount status paymentMethod date items createdAt',
      )
      .lean(),
    Sale.countDocuments(filter),
  ]);

  const items = docs.map((s) => ({
    id: String(s._id),
    business: s.business ? String(s.business) : null,
    invoiceNumber: s.invoiceNumber,
    customer: s.customer ? String(s.customer) : null,
    total: s.total ?? 0,
    paidAmount: s.paidAmount ?? 0,
    dueAmount: s.dueAmount ?? 0,
    status: s.status,
    paymentMethod: s.paymentMethod,
    date: s.date,
    itemCount: Array.isArray(s.items) ? s.items.length : 0,
    createdAt: s.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Sales fetched',
    data: { items, total, page, limit },
    meta: buildMeta(total, page, limit),
  });
});

export const listCustomers = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = normalisePageParams(req);

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'business name phone email totalSales totalPaid totalDue status createdAt',
      )
      .lean(),
    Customer.countDocuments(filter),
  ]);

  const items = docs.map((c) => ({
    id: String(c._id),
    business: c.business ? String(c.business) : null,
    name: c.name,
    phone: c.phone ?? null,
    email: c.email ?? null,
    totalSales: c.totalSales ?? 0,
    totalPaid: c.totalPaid ?? 0,
    totalDue: c.totalDue ?? 0,
    status: Boolean(c.status),
    createdAt: c.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Customers fetched',
    data: { items, total, page, limit },
    meta: buildMeta(total, page, limit),
  });
});

export const listSuppliers = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = normalisePageParams(req);

  const filter: Record<string, unknown> = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    Supplier.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'business name phone email totalPurchases totalPaid totalPayable status createdAt',
      )
      .lean(),
    Supplier.countDocuments(filter),
  ]);

  const items = docs.map((s) => ({
    id: String(s._id),
    business: s.business ? String(s.business) : null,
    name: s.name,
    phone: s.phone ?? null,
    email: s.email ?? null,
    totalPurchases: s.totalPurchases ?? 0,
    totalPaid: s.totalPaid ?? 0,
    totalPayable: s.totalPayable ?? 0,
    status: Boolean(s.status),
    createdAt: s.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Suppliers fetched',
    data: { items, total, page, limit },
    meta: buildMeta(total, page, limit),
  });
});

export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, search } = normalisePageParams(req);

  const filter: Record<string, unknown> = {};
  if (search) filter.note = { $regex: search, $options: 'i' };

  const [docs, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'business type amount paymentMethod settlementStatus note date createdAt',
      )
      .lean(),
    Transaction.countDocuments(filter),
  ]);

  const items = docs.map((t) => ({
    id: String(t._id),
    business: t.business ? String(t.business) : null,
    type: t.type,
    amount: t.amount ?? 0,
    paymentMethod: t.paymentMethod ?? null,
    settlementStatus: t.settlementStatus,
    note: t.note ?? null,
    date: t.date,
    createdAt: t.createdAt,
  }));

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Transactions fetched',
    data: { items, total, page, limit },
    meta: buildMeta(total, page, limit),
  });
});

export const adminController = {
  getOverview,
  getTodayActivity,
  getLatestTransactions,
  getRecentLogins,
  getActivityTrend,
  getTopCategories,
  getStats,
  getUserGrowth,
  getRecentSignups,
  getRevenueTrend,
  getSalesStatusBreakdown,
  getPaymentMethodBreakdown,
  getBusinessTypeMix,
  getTopBusinessesByRevenue,
  getAuthProviderSplit,
  listUsers,
  listBusinesses,
  listProducts,
  listSales,
  listCustomers,
  listSuppliers,
  listTransactions,
};