// controllers/ai.controller.ts
import { Request } from 'express';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { BusinessMembersModel } from '../models/business-members.model';
import Transaction from '../models/transaction.model';
import Business from '../models/business.model';
import { Types } from 'mongoose';
import { Meal } from '../models/Meal.model';

/* ── Types ────────────────────────────────────────────── */
interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface IBizLean {
    _id: Types.ObjectId;
    name: string;
    type: 'personal' | 'company' | 'mass';
    currency?: string;
    mealEnabled?: boolean;
}

interface IMemUserLean {
    _id: Types.ObjectId;
    firstName: string;
    lastName: string;
}

interface IMemberLean {
    _id: Types.ObjectId;
    user: IMemUserLean | Types.ObjectId;
    status: boolean;
}

interface IMealLean {
    _id: Types.ObjectId;
    member: Types.ObjectId;
    count?: number;
    date: Date;
    business: Types.ObjectId;
}

interface ITxLean {
    _id: Types.ObjectId;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    date: Date;
    member?: Types.ObjectId | { _id: Types.ObjectId };
    category?: { _id: Types.ObjectId; name: string } | Types.ObjectId;
    status?: boolean;
}

/* ── Helpers ──────────────────────────────────────────── */
const monthRange = (date: Date) => ({
    start: new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
});

const getCatName = (cat: ITxLean['category']): string => {
    if (!cat) return 'Uncategorized';
    if (typeof cat === 'object' && 'name' in cat) return cat.name;
    return 'Uncategorized';
};

const getMemberId = (member: ITxLean['member']): string => {
    if (!member) return '';
    if (typeof member === 'object' && '_id' in member) return String(member._id);
    return String(member);
};

/* ── Build context from DB ───────────────────────────── */
const buildBusinessContext = async (
    businessId: string,
    userId: string,
): Promise<string> => {

    const bizObjId = new Types.ObjectId(businessId);
    const userObjId = new Types.ObjectId(userId);

    // Verify membership
    const membership = await BusinessMembersModel.findOne({
        business: bizObjId,
        user: userObjId,
        status: true,
    });
    if (!membership) throw new ApiError(403, 'Access denied');

    const business = await Business.findById(bizObjId).lean() as IBizLean | null;
    if (!business) throw new ApiError(404, 'Business not found');

    const now = new Date();
    const { start, end } = monthRange(now);
    const currency = business.currency ?? '৳';

    /* ── Transactions this month ── */
    const transactions = await Transaction.find({
        business: bizObjId,
        date: { $gte: start, $lte: end },
        status: true,
    })
        .populate('category', 'name')
        .populate('member', 'firstName lastName')
        .lean() as ITxLean[];

    const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const transfer = transactions.filter(t => t.type === 'transfer').reduce((s, t) => s + t.amount, 0);

    /* ── Category breakdown ── */
    const catBreakdown: Record<string, number> = {};
    transactions
        .filter(t => t.type === 'expense')
        .forEach(t => {
            const name = getCatName(t.category);
            catBreakdown[name] = (catBreakdown[name] ?? 0) + t.amount;
        });

    const topCats = Object.entries(catBreakdown)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
        .map(([k, v]) => `  - ${k}: ${currency}${v.toFixed(0)}`)
        .join('\n');

    /* ── Members ── */
    const members = await BusinessMembersModel.find({ business: bizObjId, status: true })
        .populate('user', 'firstName lastName')
        .lean() as IMemberLean[];

    const memberCount = members.length;

    /* ── Mess-specific ── */
    let messContext = '';
    if (business.type === 'mass') {
        const meals = await Meal.find({
            business: bizObjId,
            date: { $gte: start, $lte: end },
        }).lean() as IMealLean[];

        const totalMeals = meals.reduce((s, m) => s + (m.count ?? 1), 0);

        const mealByMember: Record<string, number> = {};
        for (const meal of meals) {
            const uid = String(meal.member);
            mealByMember[uid] = (mealByMember[uid] ?? 0) + (meal.count ?? 1);
        }

        const memberLines: string[] = [];
        for (const mem of members) {
            const userObj = mem.user as IMemUserLean;
            const uid = String(userObj._id ?? mem.user);
            const uname = userObj.firstName
                ? `${userObj.firstName} ${userObj.lastName}`
                : 'Unknown';

            const deposits = transactions
                .filter(t => t.type === 'income' && getMemberId(t.member) === uid)
                .reduce((s, t) => s + t.amount, 0);

            const expenses = transactions
                .filter(t => t.type === 'expense' && getMemberId(t.member) === uid)
                .reduce((s, t) => s + t.amount, 0);

            const mealCount = mealByMember[uid] ?? 0;
            memberLines.push(
                `  - ${uname}: deposit=${currency}${deposits}, expense=${currency}${expenses}, meals=${mealCount}`
            );
        }

        messContext = `
Mess বিশেষ তথ্য:
মোট meals: ${totalMeals}
প্রতিজনের তথ্য:
${memberLines.join('\n')}`;
    }

    /* ── Last 3 months trend ── */
    const trends: string[] = [];
    for (let i = 1; i <= 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const { start: s, end: e } = monthRange(d);
        const txs = await Transaction.find({
            business: bizObjId,
            date: { $gte: s, $lte: e },
            status: true,
        }).lean() as ITxLean[];

        const inc = txs.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const exp = txs.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const mName = d.toLocaleString('default', { month: 'long', year: 'numeric' });
        trends.push(`  - ${mName}: income=${currency}${inc.toFixed(0)}, expense=${currency}${exp.toFixed(0)}`);
    }

    return `
Business: ${business.name} (${business.type === 'mass' ? 'Mess' : business.type})
Currency: ${currency}
Members: ${memberCount} জন
Report Period: ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}

এই মাসের সারসংক্ষেপ:
  Income:   ${currency}${income.toFixed(0)}
  Expense:  ${currency}${expense.toFixed(0)}
  Transfer: ${currency}${transfer.toFixed(0)}
  Net:      ${currency}${(income - expense).toFixed(0)}
  মোট transactions: ${transactions.length}টি

Expense category breakdown:
${topCats || '  কোনো expense নেই'}
${messContext}
গত ৩ মাসের trend:
${trends.join('\n')}`.trim();
};

/* ════════════════════════════════════════════════════════
   POST /api/ai/chat
════════════════════════════════════════════════════════ */
export const aiChat = asyncHandler(async (req: Request, res) => {
    const userId = req.user?._id;
    const { businessId, messages } = req.body as {
        businessId: string;
        messages: Message[];
    };

    if (!userId) throw new ApiError(401, 'Unauthorized');
    if (!businessId) throw new ApiError(400, 'businessId required');
    if (!Array.isArray(messages) || messages.length === 0)
        throw new ApiError(400, 'messages required');
    if (messages.length > 20)
        throw new ApiError(400, 'Conversation too long. Please start a new one.');

    const context = await buildBusinessContext(businessId, String(userId));

    const systemPrompt = `তুমি HisabBoi অ্যাপের AI financial assistant। তোমার কাজ হলো business এর হিসাব বিশ্লেষণ করে সহজ বাংলায় জবাব দেওয়া।

${context}

নিয়মাবলি:
- সবসময় বাংলায় উত্তর দাও
- সংখ্যা সুন্দরভাবে format করো
- সংক্ষিপ্ত কিন্তু তথ্যসমৃদ্ধ উত্তর দাও
- প্রয়োজনে bullet point ব্যবহার করো
- financial পরামর্শ দিতে পারো
- শুধু এই business এর data নিয়ে কথা বলো`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ApiError(500, 'AI service not configured');

    // Gemini expects: [{ role: 'user'|'model', parts: [{ text }] }]
    // Convert: assistant → model, prepend system as first user turn
    const geminiMessages = [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'বুঝেছি, আমি HisabBoi AI assistant হিসেবে সাহায্য করব।' }] },
        ...messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        })),
    ];
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    // const response = await fetch(
    //     `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    console.log(apiKey, model)
    // );
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: geminiMessages,
                generationConfig: {
                    maxOutputTokens: 1024,
                    temperature: 0.7,
                },
            }),
        }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new ApiError(502, `AI API error: ${err.error?.message ?? response.statusText}`);
    }

    const data = await response.json() as {
        candidates: { content: { parts: { text: string }[] } }[];
        usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const reply = data.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        ?.join('') ?? 'উত্তর পাওয়া যায়নি।';

    sendResponse(res, {
        statusCode: 200,
        message: "ok",
        data:
        {
            reply,
            usage: {
                input_tokens: data.usageMetadata?.promptTokenCount ?? 0,
                output_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            },

        }
    });
});