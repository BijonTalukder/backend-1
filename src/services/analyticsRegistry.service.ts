// services/analyticsRegistry.service.ts
//
// Centralized metadata-driven command and analytics registry for HisabBoi.
// Defines supported commands, roles, business types, allowed metrics,
// grouping dimensions, date presets, and visualization candidates.

import { BusinessType, BusinessSubType } from '../models/business.model';

export type AnalyticsVisualization =
  | 'summary'
  | 'bar'
  | 'line'
  | 'pie'
  | 'table'
  | 'number';

export type AnalyticsRole = 'owner' | 'admin' | 'member';

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'last7'
  | 'last30'
  | 'thisYear'
  | 'custom';

export interface CommandDefinition {
  name: string; // e.g. '/sales'
  aliases: string[]; // e.g. ['/sale', '/bikri']
  label: string; // English label
  labelBn: string; // Bengali label
  description: string;
  descriptionBn: string;
  supportedBusinessTypes: BusinessType[];
  supportedBusinessSubTypes?: BusinessSubType[];
  requiredRoles: AnalyticsRole[];
  allowedMetrics: string[];
  allowedGrouping: string[];
  supportedDatePresets: RangePreset[];
  visualizationCandidates: AnalyticsVisualization[];
  defaultVisualization: AnalyticsVisualization;
  examples: {
    en: string;
    bn: string;
  }[];
}

export const COMMAND_REGISTRY: Record<string, CommandDefinition> = {
  '/report': {
    name: '/report',
    aliases: ['/overview', '/summary', '/dashboard'],
    label: 'Business Overview',
    labelBn: 'ব্যবসায়ের সংক্ষিপ্ত বিবরণ',
    description: 'Comprehensive financial report including sales, expenses, and net profit.',
    descriptionBn: 'বিক্রি, খরচ এবং মোট লাভের সার্বিক বিবরণী।',
    supportedBusinessTypes: ['business', 'company', 'personal', 'mass'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['totalSales', 'totalExpenses', 'netProfit', 'totalDue'],
    allowedGrouping: ['day', 'week', 'month', 'category'],
    supportedDatePresets: [
      'today',
      'yesterday',
      'thisWeek',
      'lastWeek',
      'thisMonth',
      'lastMonth',
      'last7',
      'last30',
      'thisYear',
    ],
    visualizationCandidates: ['summary', 'bar', 'line', 'table'],
    defaultVisualization: 'summary',
    examples: [
      { en: 'Show my last 10 days of business data', bn: 'গত ১০ দিনের ব্যবসায়িক তথ্য দেখাও' },
      { en: 'Overview of this month', bn: 'চলতি মাসের সার্বিক বিবরণ দেখাও' },
    ],
  },

  '/sales': {
    name: '/sales',
    aliases: ['/sale', '/revenue', '/bikri'],
    label: 'Sales Analytics',
    labelBn: 'বিক্রয় বিশ্লেষণ',
    description: 'Total sales volume, revenue, cash collected, and sales trends.',
    descriptionBn: 'মোট বিক্রি, নগদ আদায় ও বিক্রির গতিপ্রকৃতি।',
    supportedBusinessTypes: ['business', 'company'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['total', 'paidAmount', 'dueAmount', 'count'],
    allowedGrouping: ['day', 'week', 'month', 'customer', 'paymentMethod'],
    supportedDatePresets: [
      'today',
      'yesterday',
      'thisWeek',
      'lastWeek',
      'thisMonth',
      'lastMonth',
      'last7',
      'last30',
      'thisYear',
    ],
    visualizationCandidates: ['bar', 'line', 'table', 'summary'],
    defaultVisualization: 'bar',
    examples: [
      { en: 'Show total sales for this month', bn: 'এই মাসের মোট বিক্রি দেখাও' },
      { en: 'Sales trend over the last 7 days', bn: 'গত ৭ দিনের বিক্রয় ট্রেন্ড দেখাও' },
      { en: 'Which day had the highest sales this month?', bn: 'এই মাসে কোন দিনে সবচেয়ে বেশি বিক্রি হয়েছে?' },
    ],
  },

  '/expense': {
    name: '/expense',
    aliases: ['/expenses', '/khoroch', '/spend'],
    label: 'Expense Analytics',
    labelBn: 'খরচ বিশ্লেষণ',
    description: 'Categorized business expenses, payment methods, and spend comparisons.',
    descriptionBn: 'খাতভিত্তিক ব্যয়, পেমেন্ট মাধ্যম ও খরচের তুলনামূলক চিত্র।',
    supportedBusinessTypes: ['business', 'company', 'personal', 'mass'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['amount', 'count'],
    allowedGrouping: ['category', 'day', 'month', 'paymentMethod'],
    supportedDatePresets: [
      'today',
      'yesterday',
      'thisWeek',
      'lastWeek',
      'thisMonth',
      'lastMonth',
      'last7',
      'last30',
      'thisYear',
    ],
    visualizationCandidates: ['pie', 'bar', 'table', 'summary'],
    defaultVisualization: 'pie',
    examples: [
      { en: 'Compare my expenses over the last 30 days', bn: 'গত ৩০ দিনের খরচের হিসাব দেখাও' },
      { en: 'This month expenses by category', bn: 'এই মাসে খাতভিত্তিক খরচ দেখাও' },
      { en: 'Top expense categories this month', bn: 'এই মাসে সবচেয়ে বেশি খরচ কোন খাতে হয়েছে?' },
    ],
  },

  '/profit': {
    name: '/profit',
    aliases: ['/margin', '/netprofit', '/labh'],
    label: 'Profit & Loss',
    labelBn: 'লাভ ও লোকসান',
    description: 'Gross profit, cost of goods sold (COGS), expenses, and net profit margins.',
    descriptionBn: 'মোট বিক্রি, পণ্যের ক্রয়মূল্য (COGS) ও পরিচালন ব্যয় বাদ দিয়ে মোট লাভ।',
    supportedBusinessTypes: ['business', 'company'],
    requiredRoles: ['owner', 'admin'],
    allowedMetrics: ['grossProfit', 'netProfit', 'costOfGoodsSold', 'expenses', 'totalSales'],
    allowedGrouping: ['day', 'month'],
    supportedDatePresets: [
      'today',
      'thisWeek',
      'thisMonth',
      'lastMonth',
      'last30',
      'thisYear',
    ],
    visualizationCandidates: ['summary', 'bar', 'table'],
    defaultVisualization: 'summary',
    examples: [
      { en: 'Show my monthly profit', bn: 'এই মাসের লাভ দেখাও' },
      { en: 'Compare profit between this month and last month', bn: 'গত মাস এবং এই মাসের লাভের তুলনা দেখাও' },
    ],
  },

  '/income': {
    name: '/income',
    aliases: ['/earnings', '/aay'],
    label: 'Income & Cash In',
    labelBn: 'আয় ও ক্যাশ ইন',
    description: 'Direct income entries and revenue cash inflows.',
    descriptionBn: 'ক্যাশবুক ও ব্যবসায়িক সকল আয়ের বিবরণ।',
    supportedBusinessTypes: ['business', 'company', 'personal', 'mass'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['amount', 'count'],
    allowedGrouping: ['category', 'day', 'month', 'paymentMethod'],
    supportedDatePresets: [
      'today',
      'thisWeek',
      'thisMonth',
      'lastMonth',
      'last30',
      'thisYear',
    ],
    visualizationCandidates: ['bar', 'summary', 'table', 'pie'],
    defaultVisualization: 'bar',
    examples: [
      { en: 'Total income this month', bn: 'এই মাসের মোট আয় কত?' },
      { en: 'Income breakdown by category', bn: 'খাতভিত্তিক আয়ের তালিকা দেখাও' },
    ],
  },

  '/due': {
    name: '/due',
    aliases: ['/dues', '/baki', '/receivables', '/payables'],
    label: 'Outstanding Dues',
    labelBn: 'বকেয়া হিসাব',
    description: 'Customer receivables (টাকা পাওয়া যাবে) and supplier payables (টাকা দিতে হবে).',
    descriptionBn: 'গ্রাহকদের কাছে পাওনা এবং সরবরাহকারীদের দেনা বকেয়া।',
    supportedBusinessTypes: ['business', 'company'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['totalDue', 'totalPayable'],
    allowedGrouping: ['customer', 'supplier'],
    supportedDatePresets: ['today'],
    visualizationCandidates: ['summary', 'table', 'bar'],
    defaultVisualization: 'summary',
    examples: [
      { en: 'Show outstanding receivables', bn: 'কার কাছে কত টাকা বকেয়া আছে?' },
      { en: 'Who owes money and who do I owe?', bn: 'আমার কাছে কারা পাবে এবং কাদের দিতে হবে?' },
    ],
  },

  '/balance': {
    name: '/balance',
    aliases: ['/cash', '/bank', 'taka'],
    label: 'Cash & Bank Balance',
    labelBn: 'ক্যাশ ও ব্যাংক ব্যালেন্স',
    description: 'Current liquid cash balance, bank balance, and total reserves.',
    descriptionBn: 'বর্তমান ক্যাশ ইন হ্যান্ড এবং ব্যাংক একাউন্টের ব্যালেন্স।',
    supportedBusinessTypes: ['business', 'company', 'personal', 'mass'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['cashBalance', 'bankBalance', 'totalBalance'],
    allowedGrouping: ['paymentMethod'],
    supportedDatePresets: ['today'],
    visualizationCandidates: ['summary', 'pie'],
    defaultVisualization: 'summary',
    examples: [
      { en: 'Show my current cash and bank balance', bn: 'আমার বর্তমান ক্যাশ ও ব্যাংক ব্যালেন্স কত?' },
    ],
  },

  '/inventory': {
    name: '/inventory',
    aliases: ['/stock', '/products', '/mal'],
    label: 'Stock & Inventory',
    labelBn: 'মজুদ পণ্য ও স্টক',
    description: 'Product stock levels, low-stock warnings, and inventory valuation.',
    descriptionBn: 'পণ্যের স্টক, কম স্টক অ্যালার্ট এবং মোট পণ্যের আর্থিক মূল্য।',
    supportedBusinessTypes: ['business', 'company'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['stock', 'minStock', 'valuation'],
    allowedGrouping: ['category'],
    supportedDatePresets: ['today'],
    visualizationCandidates: ['table', 'summary', 'bar'],
    defaultVisualization: 'table',
    examples: [
      { en: 'Which products are low in stock?', bn: 'কোন কোন পণ্যের স্টক শেষ হয়ে আসছে?' },
      { en: 'Total inventory valuation', bn: 'আমার স্টকে মোট কত টাকার পণ্য আছে?' },
    ],
  },

  '/purchase': {
    name: '/purchase',
    aliases: ['/purchases', '/kroy', '/procurement'],
    label: 'Purchase & Procurement',
    labelBn: 'ক্রয় ও প্রকিউরমেন্ট',
    description: 'Supplier purchases, procurement spending, and payable balances.',
    descriptionBn: 'সরবরাহকারীদের থেকে মালামাল ক্রয়ের হিসাব।',
    supportedBusinessTypes: ['business', 'company'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['total', 'paidAmount', 'dueAmount', 'count'],
    allowedGrouping: ['supplier', 'day', 'month'],
    supportedDatePresets: [
      'today',
      'thisWeek',
      'thisMonth',
      'lastMonth',
      'last30',
      'thisYear',
    ],
    visualizationCandidates: ['bar', 'table', 'summary'],
    defaultVisualization: 'bar',
    examples: [
      { en: 'Total purchases this month', bn: 'এই মাসে মোট কত টাকার মাল কেনা হয়েছে?' },
      { en: 'Purchases by supplier', bn: 'সাপ্লায়ারভিত্তিক ক্রয়ের তালিকা দেখাও' },
    ],
  },

  '/customer': {
    name: '/customer',
    aliases: ['/customers', '/kretar'],
    label: 'Customer Analytics',
    labelBn: 'গ্রাহক বিশ্লেষণ',
    description: 'Top customers by sales volume and highest outstanding dues.',
    descriptionBn: 'সর্বোচ্চ বিক্রয় ও সবচেয়ে বেশি বকেয়া থাকা গ্রাহকদের তালিকা।',
    supportedBusinessTypes: ['business', 'company'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['totalSales', 'totalDue', 'totalPaid'],
    allowedGrouping: ['customer'],
    supportedDatePresets: ['thisMonth', 'lastMonth', 'thisYear'],
    visualizationCandidates: ['table', 'bar'],
    defaultVisualization: 'table',
    examples: [
      { en: 'Top 5 customers by sales', bn: 'শীর্ষ ৫ জন ক্রেতার তালিকা দেখাও' },
      { en: 'Customers with highest outstanding due', bn: 'কাদের কাছে সবচেয়ে বেশি বকেয়া আছে?' },
    ],
  },

  '/supplier': {
    name: '/supplier',
    aliases: ['/suppliers', '/vendor'],
    label: 'Supplier Analytics',
    labelBn: 'সরবরাহকারী বিশ্লেষণ',
    description: 'Top suppliers by procurement volume and pending payable dues.',
    descriptionBn: 'শীর্ষ সাপ্লায়ার এবং তাদের বকেয়া পাওনার তালিকা।',
    supportedBusinessTypes: ['business', 'company'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: ['totalPurchases', 'totalPayable', 'totalPaid'],
    allowedGrouping: ['supplier'],
    supportedDatePresets: ['thisMonth', 'lastMonth', 'thisYear'],
    visualizationCandidates: ['table', 'bar'],
    defaultVisualization: 'table',
    examples: [
      { en: 'Top suppliers by purchase amount', bn: 'শীর্ষ সাপ্লায়ারদের তালিকা দেখাও' },
      { en: 'Suppliers I owe the most money to', bn: 'কোন কোন সাপ্লায়ারের বকেয়া বেশি?' },
    ],
  },

  '/help': {
    name: '/help',
    aliases: ['/commands', '/shohayota'],
    label: 'Commands Guide',
    labelBn: 'সহায়িকা ও কমান্ড তালিকা',
    description: 'List all available analytics commands and examples.',
    descriptionBn: 'সকল কমান্ড এবং ব্যবহার নির্দেশিকা।',
    supportedBusinessTypes: ['business', 'company', 'personal', 'mass'],
    requiredRoles: ['owner', 'admin', 'member'],
    allowedMetrics: [],
    allowedGrouping: [],
    supportedDatePresets: [],
    visualizationCandidates: ['summary'],
    defaultVisualization: 'summary',
    examples: [
      { en: 'Show help and available commands', bn: 'কমান্ড তালিকা ও সাহায্য দেখাও' },
    ],
  },
};

/**
 * Resolve a command name or alias to its canonical definition.
 */
export const resolveCommand = (token: string): CommandDefinition | null => {
  const normalized = token.trim().toLowerCase();
  const direct = COMMAND_REGISTRY[normalized];
  if (direct) return direct;

  for (const cmd of Object.values(COMMAND_REGISTRY)) {
    if (cmd.aliases.includes(normalized)) return cmd;
  }
  return null;
};

/**
 * Filter available commands based on business type and user's role.
 */
export const getAvailableCommandsForBusiness = (
  businessType: BusinessType,
  role: AnalyticsRole,
): CommandDefinition[] => {
  return Object.values(COMMAND_REGISTRY).filter((cmd) => {
    const typeMatch = cmd.supportedBusinessTypes.includes(businessType);
    const roleMatch = cmd.requiredRoles.includes(role);
    return typeMatch && roleMatch;
  });
};
