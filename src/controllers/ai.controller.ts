// controllers/ai.controller.ts
//
// Unified AI Assistant Controller for HisabBoi.
// Supports:
// 1. Natural-language and slash command business analytics (/sales, /report, /profit, etc.)
// 2. Quick income/expense transaction logging ("বাজার ৫০০ টাকা")
// 3. Conversational financial advising & greetings
// 4. Metadata-driven command registry discovery for the UI

import { Request } from 'express';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { BusinessMembersModel } from '../models/business-members.model';
import Transaction from '../models/transaction.model';
import Business, { BusinessType } from '../models/business.model';
import { Types } from 'mongoose';
import TransactionCategory from '../models/transaction-category.model';
import { planQuery, QuerySpec } from '../services/aiQueryPlanner.service';
import { executeQuery, AnalyticsResult } from '../services/queryExecutor.service';
import {
  getAvailableCommandsForBusiness,
  AnalyticsRole,
  AnalyticsVisualization,
} from '../services/analyticsRegistry.service';
import { getValidIds, requireMembership } from '../utils/businessAuth';

/* ───────── Types ───────── */

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AITransaction {
  action: 'create_transaction';
  type: 'income' | 'expense';
  amount: number;
  category: string;
  note?: string;
}

interface IBizLean {
  _id: Types.ObjectId;
  name: string;
  type: string;
  currency?: string;
}

interface GeminiPart {
  text?: string;
}
interface GeminiError {
  error?: { message?: string };
}

/* ───────── Helpers ───────── */

const isBengaliText = (text: string): boolean => {
  return /[\u0980-\u09FF]/.test(text);
};

const isAnalyticsQuery = (text: string): boolean => {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('/')) return true;

  const analyticsKeywords = [
    'বিক্রি', 'লাভ', 'খরচ', 'বকেয়া', 'স্টক', 'ক্যাশ', 'পাওনা', 'দেনা', 'আয়', 'মাল', 'সাপ্লায়ার', 'কাস্টমার',
    'sales', 'sale', 'profit', 'expense', 'due', 'stock', 'inventory', 'balance', 'revenue',
    'report', 'purchase', 'customer', 'supplier', 'overview', 'summary', 'cogs',
  ];

  return analyticsKeywords.some((kw) => trimmed.includes(kw));
};

const generateAnalyticsNarrative = (analytics: AnalyticsResult, isBn: boolean): string => {
  const kpiLines = analytics.summary
    .map(
      (s) =>
        `• **${s.label}**: ${s.currency ? s.currency + ' ' : ''}${
          typeof s.value === 'number' ? s.value.toLocaleString('en-IN') : s.value
        }`,
    )
    .join('\n');

  if (isBn) {
    return `📊 **${analytics.title}**\n\n${kpiLines}\n\nনিচের চার্ট বা টেবিল অপশন থেকে বিস্তারিত তথ্য দেখে নিতে পারেন।`;
  }
  return `📊 **${analytics.title}**\n\n${kpiLines}\n\nYou can switch to the chart or table format below for detailed insights.`;
};

/* ───────── JSON Extract ───────── */

const extractJSON = (text: string): AITransaction | null => {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(cleaned.slice(start, end + 1)) as AITransaction;
  } catch {
    return null;
  }
};

/* ───────── Simple Transaction Detect ───────── */

const detectSimpleTransaction = (text: string): AITransaction | null => {
  // If user typed a slash command, do NOT treat it as a quick transaction
  if (text.trim().startsWith('/')) return null;

  const amountMatch = text.match(/\d+/);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[0]);

  if (/income|received|paichi|paisi|income hoice|income hoyeche/i.test(text)) {
    return {
      action: 'create_transaction',
      type: 'income',
      amount,
      category: 'Income',
      note: text,
    };
  }

  if (/bazar|khawa|khabo|expense|khoroce|spend|buy|kine|বাজার|খরচ/i.test(text)) {
    return {
      action: 'create_transaction',
      type: 'expense',
      amount,
      category: 'Food',
      note: text,
    };
  }

  return null;
};

/* ───────── Build Business Context for Chat ───────── */

interface TxThin {
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  date: Date;
  note?: string;
  category: Types.ObjectId;
  _id: Types.ObjectId;
}

const MONEY = (n: number, c: string) => `${c}${n.toLocaleString('en-IN')}`;

const pctChange = (cur: number, prev: number) =>
  prev === 0 ? 'N/A' : `${cur > prev ? '+' : ''}${(((cur - prev) / prev) * 100).toFixed(1)}%`;

const buildBusinessContext = async (businessId: string, userId: string) => {
  const bizId = new Types.ObjectId(businessId);

  const membership = await BusinessMembersModel.findOne({
    business: bizId,
    user: userId,
    status: true,
  });
  if (!membership) throw new ApiError(403, 'Access denied');

  const business = (await Business.findById(bizId).lean()) as IBizLean | null;
  if (!business) throw new ApiError(404, 'Business not found');

  const currency = business.currency === 'BDT' ? '৳' : (business.currency ?? '৳');
  const categories = await TransactionCategory.find({ business: bizId })
    .select('name')
    .lean();
  const categoryNames = categories.map((c) => c.name).join(', ') || 'None';
  const catNameMap = new Map(categories.map((c) => [String(c._id), c.name]));

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [thisMonthTx, lastMonthTx, recentTx] = (await Promise.all([
    Transaction.find({
      business: bizId,
      date: { $gte: currentMonthStart, $lt: currentMonthEnd },
    })
      .select('type amount date note category')
      .lean(),
    Transaction.find({
      business: bizId,
      date: { $gte: lastMonthStart, $lt: currentMonthStart },
    })
      .select('type amount date note category')
      .lean(),
    Transaction.find({ business: bizId })
      .sort({ date: -1 })
      .limit(5)
      .select('date amount type note category')
      .lean(),
  ])) as unknown as [TxThin[], TxThin[], TxThin[]];

  const sumBy = (rows: TxThin[]) =>
    rows.reduce(
      (acc, t) => {
        if (t.type === 'income') acc.income += t.amount;
        else if (t.type === 'expense') acc.expense += t.amount;
        return acc;
      },
      { income: 0, expense: 0 },
    );

  const thisAgg = sumBy(thisMonthTx);
  const lastAgg = sumBy(lastMonthTx);

  const catSpend = new Map<string, { amount: number; count: number }>();
  for (const t of thisMonthTx) {
    if (t.type !== 'expense') continue;
    const id = String(t.category);
    const cur = catSpend.get(id) ?? { amount: 0, count: 0 };
    cur.amount += t.amount;
    cur.count += 1;
    catSpend.set(id, cur);
  }
  const topCats = [...catSpend.entries()]
    .map(([id, v]) => ({ name: catNameMap.get(id) ?? 'Other', ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const text = [
    `Business: ${business.name} (${business.type})`,
    `Currency: ${currency}`,
    `Available Categories: ${categoryNames}`,
    '',
    '=== THIS MONTH SUMMARY ===',
    `Income: ${MONEY(thisAgg.income, currency)}`,
    `Expense: ${MONEY(thisAgg.expense, currency)}`,
    `Net: ${MONEY(thisAgg.income - thisAgg.expense, currency)}`,
    '',
    '=== LAST MONTH SUMMARY ===',
    `Income: ${MONEY(lastAgg.income, currency)}`,
    `Expense: ${MONEY(lastAgg.expense, currency)}`,
    `Income change: ${pctChange(thisAgg.income, lastAgg.income)}`,
    `Expense change: ${pctChange(thisAgg.expense, lastAgg.expense)}`,
    '',
    '=== TOP EXPENSE CATEGORIES THIS MONTH ===',
    ...(topCats.length
      ? topCats.map((c) => `- ${c.name}: ${MONEY(c.amount, currency)} (${c.count} tx)`)
      : ['- None this month']),
    '',
    '=== RECENT TRANSACTIONS ===',
    ...recentTx.map(
      (t) =>
        `- ${new Date(t.date).toLocaleDateString('en-GB')} | ${t.type} | ${t.note || catNameMap.get(String(t.category)) || ''} | ${MONEY(t.amount, currency)}`,
    ),
  ].join('\n');

  return {
    text,
    categoryList: categoryNames,
  };
};

/* ───────── Create Transaction ───────── */

const createTransactionFromAI = async (
  aiData: AITransaction,
  businessId: string,
  userId: string,
) => {
  let category = await TransactionCategory.findOne({
    business: businessId,
    name: { $regex: aiData.category, $options: 'i' },
  });

  if (!category) {
    category = await TransactionCategory.create({
      business: businessId,
      name: aiData.category,
      type: aiData.type,
      createdBy: userId,
    });
  }

  return Transaction.create({
    business: businessId,
    type: aiData.type,
    amount: aiData.amount,
    category: category._id,
    note: aiData.note ?? '',
    createdBy: userId,
    member: userId,
    date: new Date(),
    paidFor: [],
    splitType: 'none',
    settlementStatus: 'not_applicable',
    settledAmount: 0,
  });
};

/* ─────────────────────────
   POST /api/ai/chat
───────────────────────── */

export const aiChat = asyncHandler(async (req: Request, res) => {
  const userId = req.user?._id;
  const { businessId, messages, formatPreference } = req.body as {
    businessId: string;
    messages: Message[];
    formatPreference?: AnalyticsVisualization;
  };

  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (!businessId) throw new ApiError(400, 'businessId required');
  if (!Array.isArray(messages) || !messages.length)
    throw new ApiError(400, 'messages required');

  const { objectUserId, objectBusinessId } = getValidIds(userId, businessId);
  const membership = await requireMembership(objectBusinessId!, objectUserId);

  const lastMessage = messages[messages.length - 1].content.trim();

  /* 1️⃣ Quick detect: /slash-command OR business analytics question */
  if (isAnalyticsQuery(lastMessage)) {
    const [business, categories] = await Promise.all([
      Business.findById(objectBusinessId).select('name type currency').lean<{
        name?: string;
        type?: string;
        currency?: string;
      }>(),
      TransactionCategory.find({ business: objectBusinessId }).select('name').lean(),
    ]);

    if (!business) throw new ApiError(404, 'Business not found');

    try {
      const spec = await planQuery({
        text: lastMessage,
        businessContext: {
          currency: business.currency ?? '৳',
          businessType: (business.type as BusinessType) ?? 'personal',
          categories: categories.map((c) => c.name),
          role: membership.role as AnalyticsRole,
        },
        formatPreference,
      });

      if (spec.op !== 'answer') {
        const analytics = await executeQuery(spec, {
          businessId: objectBusinessId!,
          userId: objectUserId,
        });

        const reply = generateAnalyticsNarrative(analytics, isBengaliText(lastMessage));

        return sendResponse(res, {
          statusCode: 200,
          success: true,
          message: 'Analytics fetched successfully',
          data: {
            reply,
            analytics,
            spec,
          },
        });
      }
    } catch (err: any) {
      // Fall through to general conversation if planner was not applicable
      console.warn('Analytics planner fallback:', err?.message);
    }
  }

  /* 2️⃣ Quick detect: Instant transaction creation ("বাজার ৫০০ টাকা") */
  const quickTx = detectSimpleTransaction(lastMessage);

  if (quickTx) {
    const tx = await createTransactionFromAI(quickTx, businessId, String(userId));
    const reply = `✅ Transaction recorded: ${quickTx.amount}৳ (${quickTx.type}) — ${quickTx.category}`;
    return sendResponse(res, {
      statusCode: 201,
      success: true,
      message: 'Transaction recorded successfully',
      data: { reply, transaction: tx },
    });
  }

  /* 3️⃣ General Gemini conversational response */
  const context = await buildBusinessContext(businessId, String(userId));

  const systemPrompt = `You are "HisabBoi AI", a smart bookkeeping assistant for businesses in Bangladesh.

Context data:
${context.text}

Instructions:
1. If the user wants to CREATE an income or expense transaction, respond with ONLY this JSON (no other text):
{"action":"create_transaction","type":"expense","amount":500,"category":"Food","note":"বাজার"}
Category must be one of the Available Categories listed above. amount = number only.
2. If the user is asking about business analytics, advise them to use slash commands (e.g. /sales, /report, /profit, /due, /inventory, /expense) for rich charts and graphs.
3. Otherwise reply in Bengali (unless the user writes in English). Be concise, helpful, and polite.
4. Quote exact amounts in the currency shown above. Do not invent numbers that are not in the context.`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ApiError(500, 'AI service not configured');
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-pro';
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-2.5-flash';

  const geminiMessages = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'ঠিক আছে, আমি সাহায্য করব।' }] },
    ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  const callGemini = async (modelName: string) => {
    return fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: geminiMessages,
          generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
        }),
      },
    );
  };

  let response = await callGemini(model);

  if (
    !response.ok &&
    (response.status === 429 || response.status === 503) &&
    fallbackModel !== model
  ) {
    response = await callGemini(fallbackModel);
  }

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as GeminiError;
    throw new ApiError(
      502,
      `AI error: ${err?.error?.message ?? response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  };

  let reply =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('') ?? '';

  let tx = null;
  const json = extractJSON(reply);
  if (json?.action === 'create_transaction') {
    tx = await createTransactionFromAI(json, businessId, String(userId));
    reply = `✅ Transaction recorded: ${json.amount}৳ (${json.type}) — ${json.category}`;
  }

  sendResponse(res, {
    statusCode: tx ? 201 : 200,
    success: true,
    message: tx ? 'Transaction recorded successfully' : 'OK',
    data: { reply, transaction: tx ?? null },
  });
});

/* ─────────────────────────
   GET /api/ai/commands
───────────────────────── */

export const getAiCommands = asyncHandler(async (req: Request, res) => {
  const userId = req.user?._id;
  const businessId = req.query.businessId as string;

  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (!businessId || !Types.ObjectId.isValid(businessId)) {
    throw new ApiError(400, 'Valid businessId query is required');
  }

  const { objectUserId, objectBusinessId } = getValidIds(userId, businessId);
  const membership = await requireMembership(objectBusinessId!, objectUserId);

  const business = await Business.findById(objectBusinessId).select('type').lean<{ type?: BusinessType }>();
  if (!business) throw new ApiError(404, 'Business not found');

  const commands = getAvailableCommandsForBusiness(
    (business.type as BusinessType) ?? 'personal',
    membership.role as AnalyticsRole,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Commands fetched successfully',
    data: commands,
  });
});

/* ─────────────────────────
   POST /api/ai/command
   (Direct programmatic analytics query endpoint)
───────────────────────── */

export const aiCommand = asyncHandler(async (req: Request, res) => {
  const userId = req.user?._id;
  const { businessId, text, formatPreference } = req.body as {
    businessId?: string;
    text?: string;
    formatPreference?: AnalyticsVisualization;
  };

  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (!businessId || !Types.ObjectId.isValid(businessId)) {
    throw new ApiError(400, 'A valid businessId is required');
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new ApiError(400, 'text is required');
  }
  if (text.length > 500) {
    throw new ApiError(400, 'text is too long (max 500 chars)');
  }

  const { objectUserId, objectBusinessId } = getValidIds(userId, businessId);
  const membership = await requireMembership(objectBusinessId!, objectUserId);

  const [business, categories] = await Promise.all([
    Business.findById(objectBusinessId).select('name type currency').lean<{
      name?: string;
      type?: string;
      currency?: string;
    }>(),
    TransactionCategory.find({ business: objectBusinessId }).select('name').lean(),
  ]);
  if (!business) throw new ApiError(404, 'Business not found');

  const spec = await planQuery({
    text,
    businessContext: {
      currency: business.currency ?? '৳',
      businessType: (business.type as BusinessType) ?? 'personal',
      categories: categories.map((c) => c.name),
      role: membership.role as AnalyticsRole,
    },
    formatPreference,
  });

  const analytics = await executeQuery(spec, {
    businessId: objectBusinessId!,
    userId: objectUserId,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'OK',
    data: { spec, analytics },
  });
});
