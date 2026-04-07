import { Request } from 'express';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { BusinessMembersModel } from '../models/business-members.model';
import Transaction from '../models/transaction.model';
import Business from '../models/business.model';
import { Types } from 'mongoose';
import TransactionCategory from '../models/transaction-category.model';

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
  const amountMatch = text.match(/\d+/);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[0]);

  if (/income|received|paichi|paisi|income hoice|income hoyeche/i.test(text))
    return {
      action: 'create_transaction',
      type: 'income',
      amount,
      category: 'Income',
      note: text,
    };

  if (/bazar|khawa|khabo|expense|khoroce|spend|buy|kine/i.test(text))
    return {
      action: 'create_transaction',
      type: 'expense',
      amount,
      category: 'Food',
      note: text,
    };

  return null;
};

/* ───────── Build Context ───────── */

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

  const currency = business.currency ?? '৳';
  const categories = await TransactionCategory.find({ business: bizId })
    .select('name')
    .lean();
  const categoryNames = categories.map((c) => c.name).join(', ') || 'None';

  const transactions = await Transaction.find({ business: bizId })
    .limit(50)
    .lean();
  let income = 0,
    expense = 0;
  for (const t of transactions) {
    if (t.type === 'income') income += t.amount;
    if (t.type === 'expense') expense += t.amount;
  }

  return {
    text: `Business: ${business.name}\nCategories: ${categoryNames}\nIncome: ${currency}${income}\nExpense: ${currency}${expense}\nNet: ${currency}${income - expense}`,
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
  const { businessId, messages } = req.body as {
    businessId: string;
    messages: Message[];
  };

  if (!userId) throw new ApiError(401, 'Unauthorized');
  if (!businessId) throw new ApiError(400, 'businessId required');
  if (!Array.isArray(messages) || !messages.length)
    throw new ApiError(400, 'messages required');

  const lastMessage = messages[messages.length - 1].content;
  let reply = '';
  let tx = null;

  /* 1️⃣ Quick detect — no AI call needed */
  const quickTx = detectSimpleTransaction(lastMessage);

  if (quickTx) {
    tx = await createTransactionFromAI(quickTx, businessId, String(userId));
    reply = `✅ Transaction recorded: ${quickTx.amount}৳ (${quickTx.type})`;
  } else {
    /* 2️⃣ Gemini */
    const context = await buildBusinessContext(businessId, String(userId));

    const systemPrompt = `You are "HisabBoi AI", a bookkeeping assistant.
If user mentions creating income or expense, respond ONLY with JSON:
{"action":"create_transaction","type":"expense","amount":500,"category":"Food","note":"বাজার"}
Available Categories: ${context.categoryList}
Business Summary:
${context.text}
Otherwise reply conversationally in Bangla.`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ApiError(500, 'AI service not configured');
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

    const geminiMessages = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'ঠিক আছে, আমি সাহায্য করব।' }] },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: geminiMessages,
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
        }),
      },
    );

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

    reply =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('') ?? '';

    const json = extractJSON(reply);
    if (json?.action === 'create_transaction') {
      tx = await createTransactionFromAI(json, businessId, String(userId));
      reply = `✅ Transaction recorded: ${json.amount}৳ (${json.type}) — ${json.category}`;
    }
  }

  sendResponse(res, {
    statusCode: tx ? 201 : 200,
    success: true,
    message: tx ? 'Transaction recorded successfully' : 'OK',
    data: { reply, transaction: tx ?? null },
  });
});
