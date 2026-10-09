// services/aiQueryPlanner.service.ts
//
// Translates natural-language business questions and slash commands into
// a strongly-validated QuerySpec via Google Gemini.
// Uses resilient fallback on 429/503 (gemini-2.5-pro → gemini-2.5-flash).

import ApiError from '../Error/handleApiError';
import { BusinessType } from '../models/business.model';
import { callGeminiWithFallback, extractGeminiError } from '../utils/gemini';
import { extractJson } from '../utils/extractJson';
import {
  resolveCommand,
  COMMAND_REGISTRY,
  RangePreset,
  AnalyticsVisualization,
} from './analyticsRegistry.service';

/* ───────── Types ───────── */

export type QueryOp =
  | 'overview'
  | 'sales'
  | 'expense'
  | 'profit'
  | 'income'
  | 'due'
  | 'balance'
  | 'inventory'
  | 'purchase'
  | 'customer'
  | 'supplier'
  | 'help'
  | 'answer';

export interface DateRangeSpec {
  preset?: RangePreset;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
}

export interface BaseQuerySpec {
  op: QueryOp;
  command?: string;
  range?: DateRangeSpec;
  groupBy?: string;
  limit?: number;
  visualization?: AnalyticsVisualization;
}

export interface OverviewSpec extends BaseQuerySpec {
  op: 'overview';
}

export interface SalesSpec extends BaseQuerySpec {
  op: 'sales';
  metric?: 'total' | 'trend' | 'items' | 'customer' | 'paymentMethod';
}

export interface ExpenseSpec extends BaseQuerySpec {
  op: 'expense';
  metric?: 'total' | 'category' | 'trend';
  category?: string;
}

export interface ProfitSpec extends BaseQuerySpec {
  op: 'profit';
}

export interface IncomeSpec extends BaseQuerySpec {
  op: 'income';
}

export interface DueSpec extends BaseQuerySpec {
  op: 'due';
  party?: 'customer' | 'supplier' | 'all';
}

export interface BalanceSpec extends BaseQuerySpec {
  op: 'balance';
}

export interface InventorySpec extends BaseQuerySpec {
  op: 'inventory';
  filter?: 'low_stock' | 'valuation' | 'all';
}

export interface PurchaseSpec extends BaseQuerySpec {
  op: 'purchase';
}

export interface CustomerSpec extends BaseQuerySpec {
  op: 'customer';
  metric?: 'sales' | 'due';
}

export interface SupplierSpec extends BaseQuerySpec {
  op: 'supplier';
  metric?: 'purchases' | 'payable';
}

export interface HelpSpec extends BaseQuerySpec {
  op: 'help';
}

export interface AnswerSpec extends BaseQuerySpec {
  op: 'answer';
  text: string;
}

export type QuerySpec =
  | OverviewSpec
  | SalesSpec
  | ExpenseSpec
  | ProfitSpec
  | IncomeSpec
  | DueSpec
  | BalanceSpec
  | InventorySpec
  | PurchaseSpec
  | CustomerSpec
  | SupplierSpec
  | HelpSpec
  | AnswerSpec;

export interface BusinessPlannerContext {
  currency: string;
  businessType: BusinessType;
  categories: string[];
  role: 'owner' | 'admin' | 'member';
}

export interface PlanArgs {
  text: string;
  businessContext: BusinessPlannerContext;
  formatPreference?: AnalyticsVisualization;
}

/* ───────── Intent Rules & Fast Detection ───────── */

const QUICK_COMMAND_MAP: Record<string, QueryOp> = {
  '/report': 'overview',
  '/overview': 'overview',
  '/summary': 'overview',
  '/sales': 'sales',
  '/sale': 'sales',
  '/expense': 'expense',
  '/expenses': 'expense',
  '/profit': 'profit',
  '/income': 'income',
  '/due': 'due',
  '/dues': 'due',
  '/balance': 'balance',
  '/inventory': 'inventory',
  '/stock': 'inventory',
  '/purchase': 'purchase',
  '/purchases': 'purchase',
  '/customer': 'customer',
  '/customers': 'customer',
  '/supplier': 'supplier',
  '/suppliers': 'supplier',
  '/help': 'help',
};

const VALID_PRESETS = new Set<RangePreset>([
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'last7',
  'last30',
  'thisYear',
  'custom',
]);

const VALID_VISUALIZATIONS = new Set<AnalyticsVisualization>([
  'summary',
  'bar',
  'line',
  'pie',
  'table',
  'number',
]);

/* ───────── System Prompt Generator ───────── */

const buildPlannerPrompt = (ctx: BusinessPlannerContext): string => {
  return `You are "HisabBoi AI Query Planner", an expert business analytics planner for HisabBoi bookkeeping.
Your job is to translate a user question or slash command into a STRICT, TYPED JSON QuerySpec.
You only return valid JSON. No markdown fences, no explanatory comments.

Business Context:
- Currency: ${ctx.currency}
- Business Type: ${ctx.businessType}
- User Role: ${ctx.role}
- Categories: ${ctx.categories.join(', ') || 'General'}

Supported Operations ("op"):
1. "overview"  - Business overview (/report, sales, expenses, profit summary).
2. "sales"     - Sales revenue, sales trend, cash collected, invoice dues (/sales).
3. "expense"   - Business and cashbook expenses, categorized expenses (/expense).
4. "profit"    - Profit & Loss, gross profit, COGS, expenses, net margin (/profit).
5. "income"    - Direct income entries and receipts (/income).
6. "due"       - Customer receivables and supplier payables (/due).
7. "balance"   - Current cash in hand and bank balance (/balance).
8. "inventory" - Product stock, low stock alert, stock valuation (/inventory).
9. "purchase"  - Procurement expenses, supplier orders (/purchase).
10. "customer" - Top customers by sales volume or outstanding dues (/customer).
11. "supplier" - Top suppliers by purchases or pending payables (/supplier).
12. "help"     - Command guide and documentation (/help).
13. "answer"   - Non-analytical general conversational chat or questions that cannot be queried.

Allowed Range Presets:
"today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "last7", "last30", "thisYear"

Allowed Visualizations:
"summary" (KPI cards), "bar" (bar chart), "line" (trend line), "pie" (category breakdown), "table" (detailed rows)

JSON Output Schema:
{
  "op": "sales" | "expense" | "profit" | "overview" | "due" | "balance" | "inventory" | "purchase" | "customer" | "supplier" | "help" | "answer",
  "command": "/sales",
  "range": { "preset": "thisMonth" },
  "groupBy": "day" | "category" | "customer" | "supplier" | "paymentMethod",
  "visualization": "bar" | "line" | "pie" | "table" | "summary",
  "limit": 10,
  "text": "Answer text only when op is answer"
}

Bengali / Language Guidance:
- "আজকের বিক্রি" -> op: "sales", range: { "preset": "today" }
- "এই মাসের লাভ কত?" -> op: "profit", range: { "preset": "thisMonth" }
- "বকেয়া কত আছে?" -> op: "due"
- "কোন কোন পণ্যের স্টক কম?" -> op: "inventory", filter: "low_stock"
- "গত ৩০ দিনের খরচ" -> op: "expense", range: { "preset": "last30" }
- "ক্যাশ ও ব্যাংক ব্যালেন্স" -> op: "balance"`;
};

/* ───────── Spec Validator ───────── */

const validatePlannedSpec = (
  raw: any,
  userText: string,
  formatPreference?: AnalyticsVisualization,
): QuerySpec => {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError(400, 'Invalid query plan generated');
  }

  const op = String(raw.op || '').toLowerCase() as QueryOp;

  if (op === 'help') {
    return { op: 'help', command: '/help', visualization: 'summary' };
  }

  if (op === 'answer') {
    return {
      op: 'answer',
      text: typeof raw.text === 'string' && raw.text ? raw.text : 'I could not find an analytics query for that question.',
      visualization: 'summary',
    };
  }

  // Range validation
  let range: DateRangeSpec = { preset: 'thisMonth' };
  if (raw.range && typeof raw.range === 'object') {
    if (raw.range.preset && VALID_PRESETS.has(raw.range.preset as RangePreset)) {
      range = { preset: raw.range.preset };
    } else if (raw.range.from || raw.range.to) {
      range = { from: raw.range.from, to: raw.range.to, preset: 'custom' };
    }
  }

  // Quick preset detection from userText if AI missed it
  const lower = userText.toLowerCase();
  if (lower.includes('today') || lower.includes('আজকে') || lower.includes('আজকের')) {
    range = { preset: 'today' };
  } else if (lower.includes('yesterday') || lower.includes('গতকাল') || lower.includes('গতকালের')) {
    range = { preset: 'yesterday' };
  } else if (lower.includes('last 7') || lower.includes('গত ৭')) {
    range = { preset: 'last7' };
  } else if (lower.includes('last 30') || lower.includes('গত ৩০')) {
    range = { preset: 'last30' };
  } else if (lower.includes('last month') || lower.includes('গত মাস') || lower.includes('গত মাসের')) {
    range = { preset: 'lastMonth' };
  }

  // Visualization validation
  let visualization: AnalyticsVisualization | undefined = formatPreference;
  if (!visualization && raw.visualization && VALID_VISUALIZATIONS.has(raw.visualization)) {
    visualization = raw.visualization;
  }

  const canonicalCommand = `/${op}`;
  const def = resolveCommand(canonicalCommand);
  if (!visualization) {
    visualization = def ? def.defaultVisualization : 'summary';
  }

  const limit = typeof raw.limit === 'number' && raw.limit > 0 && raw.limit <= 100 ? Math.floor(raw.limit) : 20;

  switch (op) {
    case 'overview':
      return { op: 'overview', command: '/report', range, visualization };
    case 'sales':
      return { op: 'sales', command: '/sales', range, groupBy: raw.groupBy, visualization, limit };
    case 'expense':
      return { op: 'expense', command: '/expense', range, groupBy: raw.groupBy || 'category', visualization, limit };
    case 'profit':
      return { op: 'profit', command: '/profit', range, visualization };
    case 'income':
      return { op: 'income', command: '/income', range, groupBy: raw.groupBy, visualization, limit };
    case 'due':
      return { op: 'due', command: '/due', visualization: visualization || 'summary' };
    case 'balance':
      return { op: 'balance', command: '/balance', visualization: 'summary' };
    case 'inventory':
      return { op: 'inventory', command: '/inventory', visualization: visualization || 'table', limit };
    case 'purchase':
      return { op: 'purchase', command: '/purchase', range, groupBy: raw.groupBy, visualization, limit };
    case 'customer':
      return { op: 'customer', command: '/customer', visualization: visualization || 'table', limit };
    case 'supplier':
      return { op: 'supplier', command: '/supplier', visualization: visualization || 'table', limit };
    default:
      return {
        op: 'answer',
        text: 'I could not interpret that as a supported business analytics query.',
        visualization: 'summary',
      };
  }
};

/* ───────── Fast Slash-Command Parser ───────── */

const parseSlashCommand = (
  text: string,
  formatPreference?: AnalyticsVisualization,
): QuerySpec | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  const firstWord = parts[0].toLowerCase();
  const restText = parts.slice(1).join(' ');

  const op = QUICK_COMMAND_MAP[firstWord];
  if (!op) return null;

  if (op === 'help') {
    return { op: 'help', command: '/help', visualization: 'summary' };
  }

  // If there is no extra prompt after the slash command, use default preset
  if (!restText) {
    const def = COMMAND_REGISTRY[firstWord] || resolveCommand(firstWord);
    return {
      op,
      command: def?.name || firstWord,
      range: { preset: 'thisMonth' },
      visualization: formatPreference || def?.defaultVisualization || 'summary',
    } as QuerySpec;
  }

  return null; // Let Gemini parse the command + natural language text
};

/* ───────── Public Plan Query API ───────── */

export const planQuery = async ({
  text,
  businessContext,
  formatPreference,
}: PlanArgs): Promise<QuerySpec> => {
  // 1️⃣ Fast path: clean slash command with no trailing prompt (e.g. "/sales", "/profit", "/due")
  const fastSpec = parseSlashCommand(text, formatPreference);
  if (fastSpec) return fastSpec;

  // 2️⃣ Gemini planning for natural language / command + questions
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ApiError(500, 'AI service not configured');

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-pro';
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-2.5-flash';

  const systemPrompt = buildPlannerPrompt(businessContext);
  const preferenceHint = formatPreference ? `\nUser preferred format: ${formatPreference}\n` : '';

  const payload = {
    contents: [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I will output only strict JSON.' }] },
      { role: 'user', parts: [{ text: `${preferenceHint}User Request: ${text.trim()}` }] },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 600,
    },
  };

  const res = await callGeminiWithFallback(apiKey, model, fallbackModel, payload);
  if (!res.ok) {
    throw new ApiError(502, `AI service error: ${await extractGeminiError(res)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const responseText =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  const parsed = extractJson<Record<string, unknown>>(responseText);
  if (!parsed) {
    throw new ApiError(502, 'AI planner produced an invalid response. Please try rephrasing.');
  }

  return validatePlannedSpec(parsed, text, formatPreference);
};
