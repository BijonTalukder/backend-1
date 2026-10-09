// services/queryExecutor.service.ts
//
// Secure, multi-tenant Query Builder & Executor for HisabBoi.
// Enforces tenant isolation on every single query and aggregation stage.
// Uses canonical models: Sale, Purchase, Expense, Transaction, Customer, Supplier, Product, Business.

import { Types } from 'mongoose';
import Business from '../models/business.model';
import Sale from '../models/sale.model';
import Purchase from '../models/purchase.model';
import Expense from '../models/expense.model';
import Transaction from '../models/transaction.model';
import TransactionCategory from '../models/transaction-category.model';
import Customer from '../models/customer.model';
import Supplier from '../models/supplier.model';
import Product from '../models/product.model';
import ApiError from '../Error/handleApiError';
import { requireMembership } from '../utils/businessAuth';
import { resolveDateRange, toLocalIsoDay, DEFAULT_TIMEZONE } from '../utils/timezone';
import { QuerySpec } from './aiQueryPlanner.service';
import { AnalyticsVisualization, COMMAND_REGISTRY } from './analyticsRegistry.service';

/* ───────── Types ───────── */

export interface AnalyticsSummaryItem {
  label: string;
  value: number | string;
  currency?: string;
}

export interface AnalyticsSeriesItem {
  label: string;
  value: number;
  [key: string]: unknown;
}

export interface AnalyticsCategoryItem {
  name: string;
  value: number;
}

export interface AnalyticsResult {
  type: 'analytics_result';
  command: string;
  title: string;
  businessId: string;
  dateRange?: {
    start: string;
    endExclusive: string;
    timezone: string;
    preset?: string;
  };
  summary: AnalyticsSummaryItem[];
  columns?: string[];
  rows?: (string | number)[][];
  series?: AnalyticsSeriesItem[];
  categories?: AnalyticsCategoryItem[];
  selectedVisualization: AnalyticsVisualization;
  visualizationCandidates: AnalyticsVisualization[];
  metadata: {
    generatedAt: string;
    executionTimeMs: number;
  };
}

export interface ExecutorContext {
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
}

/* ───────── Formatters ───────── */

const formatMoney = (n: number, currency: string) =>
  `${currency}${n.toLocaleString('en-IN')}`;

const formatDateCell = (d: Date | string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/* ───────── Operations ───────── */

/**
 * 1. Overview (/report)
 */
const executeOverview = async (
  spec: Extract<QuerySpec, { op: 'overview' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const range = resolveDateRange(spec.range);

  const [salesAgg, cogsAgg, expenseAgg, cashbookExpenseAgg, customerDueAgg] = await Promise.all([
    Sale.aggregate([
      { $match: { business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } } },
      { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Sale.aggregate([
      { $match: { business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          let: { prodId: '$items.product' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$_id', '$$prodId'] }, { $eq: ['$business', ctx.businessId] }] } } },
          ],
          as: 'productDoc',
        },
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          cogs: { $sum: { $multiply: ['$items.quantity', { $ifNull: ['$productDoc.purchasePrice', 0] }] } },
        },
      },
    ]),
    Expense.aggregate([
      { $match: { business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      {
        $match: {
          business: ctx.businessId,
          type: 'expense',
          $or: [{ source: { $exists: false } }, { source: null }],
          date: { $gte: range.start, $lt: range.endExclusive },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Customer.aggregate([
      { $match: { business: ctx.businessId, status: true } },
      { $group: { _id: null, total: { $sum: '$totalDue' } } },
    ]),
  ]);

  const totalSales = salesAgg[0]?.total ?? 0;
  const salesCount = salesAgg[0]?.count ?? 0;
  const cogs = cogsAgg[0]?.cogs ?? 0;
  const directExpense = expenseAgg[0]?.total ?? 0;
  const cashbookExpense = cashbookExpenseAgg[0]?.total ?? 0;
  const totalExpenses = directExpense + cashbookExpense;
  const grossProfit = totalSales - cogs;
  const netProfit = grossProfit - totalExpenses;
  const totalReceivables = customerDueAgg[0]?.total ?? 0;

  const series: AnalyticsSeriesItem[] = [
    { label: 'Sales', value: totalSales },
    { label: 'COGS', value: cogs },
    { label: 'Expenses', value: totalExpenses },
    { label: 'Net Profit', value: Math.max(0, netProfit) },
  ];

  return {
    type: 'analytics_result',
    command: '/report',
    title: `Business Overview (${range.label})`,
    businessId: String(ctx.businessId),
    dateRange: {
      start: range.start.toISOString(),
      endExclusive: range.endExclusive.toISOString(),
      timezone: range.timezone,
      preset: range.preset,
    },
    summary: [
      { label: 'Total Sales', value: totalSales, currency },
      { label: 'Total Expenses', value: totalExpenses, currency },
      { label: 'Net Profit', value: netProfit, currency },
      { label: 'Receivables Due', value: totalReceivables, currency },
    ],
    columns: ['Metric', 'Amount'],
    rows: [
      ['Total Sales', formatMoney(totalSales, currency)],
      ['Sales Count', salesCount],
      ['Cost of Goods Sold (COGS)', formatMoney(cogs, currency)],
      ['Gross Profit', formatMoney(grossProfit, currency)],
      ['Operational Expenses', formatMoney(totalExpenses, currency)],
      ['Net Profit', formatMoney(netProfit, currency)],
      ['Outstanding Customer Due', formatMoney(totalReceivables, currency)],
    ],
    series,
    selectedVisualization: spec.visualization || 'summary',
    visualizationCandidates: ['summary', 'bar', 'table'],
  };
};

/**
 * 2. Sales (/sales)
 */
const executeSales = async (
  spec: Extract<QuerySpec, { op: 'sales' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const range = resolveDateRange(spec.range);

  const [totalsAgg, dailyAgg, listRows] = await Promise.all([
    Sale.aggregate([
      { $match: { business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          paid: { $sum: '$paidAmount' },
          due: { $sum: '$dueAmount' },
          count: { $sum: 1 },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          value: { $sum: '$total' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.find({ business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } })
      .sort({ date: -1 })
      .limit(spec.limit ?? 20)
      .populate('customer', 'name phone')
      .lean(),
  ]);

  const total = totalsAgg[0]?.total ?? 0;
  const paid = totalsAgg[0]?.paid ?? 0;
  const due = totalsAgg[0]?.due ?? 0;
  const count = totalsAgg[0]?.count ?? 0;

  const series: AnalyticsSeriesItem[] = dailyAgg.map((d: any) => ({
    label: d._id,
    value: d.value,
    count: d.count,
  }));

  const rows = listRows.map((s: any) => [
    formatDateCell(s.date),
    s.invoiceNumber || '-',
    s.customer?.name || 'Walk-in Customer',
    formatMoney(s.total, currency),
    formatMoney(s.paidAmount, currency),
    formatMoney(s.dueAmount, currency),
    s.status,
  ]);

  return {
    type: 'analytics_result',
    command: '/sales',
    title: `Sales Analytics (${range.label})`,
    businessId: String(ctx.businessId),
    dateRange: {
      start: range.start.toISOString(),
      endExclusive: range.endExclusive.toISOString(),
      timezone: range.timezone,
      preset: range.preset,
    },
    summary: [
      { label: 'Total Sales', value: total, currency },
      { label: 'Cash Collected', value: paid, currency },
      { label: 'Due Amount', value: due, currency },
      { label: 'Invoices', value: count },
    ],
    columns: ['Date', 'Invoice', 'Customer', 'Total', 'Paid', 'Due', 'Status'],
    rows,
    series,
    selectedVisualization: spec.visualization || 'bar',
    visualizationCandidates: ['bar', 'line', 'table', 'summary'],
  };
};

/**
 * 3. Expense (/expense)
 */
const executeExpense = async (
  spec: Extract<QuerySpec, { op: 'expense' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const range = resolveDateRange(spec.range);

  const [expenseDocs, txDocs] = await Promise.all([
    Expense.find({ business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } })
      .populate('category', 'name')
      .sort({ date: -1 })
      .lean(),
    Transaction.find({
      business: ctx.businessId,
      type: 'expense',
      $or: [{ source: { $exists: false } }, { source: null }],
      date: { $gte: range.start, $lt: range.endExclusive },
    })
      .populate('category', 'name')
      .sort({ date: -1 })
      .lean(),
  ]);

  const categoryMap = new Map<string, number>();
  let totalExpense = 0;

  const combinedRows: (string | number)[][] = [];

  for (const exp of expenseDocs) {
    totalExpense += exp.amount;
    const catName = (exp.category as any)?.name || 'General';
    categoryMap.set(catName, (categoryMap.get(catName) ?? 0) + exp.amount);
    combinedRows.push([
      formatDateCell(exp.date),
      catName,
      formatMoney(exp.amount, currency),
      exp.paymentMethod || 'cash',
      exp.note || '',
    ]);
  }

  for (const tx of txDocs) {
    totalExpense += tx.amount;
    const catName = (tx.category as any)?.name || 'Cashbook Expense';
    categoryMap.set(catName, (categoryMap.get(catName) ?? 0) + tx.amount);
    combinedRows.push([
      formatDateCell(tx.date),
      catName,
      formatMoney(tx.amount, currency),
      tx.paymentMethod || 'cash',
      tx.note || '',
    ]);
  }

  const categories: AnalyticsCategoryItem[] = Array.from(categoryMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const series: AnalyticsSeriesItem[] = categories.map((c) => ({
    label: c.name,
    value: c.value,
  }));

  return {
    type: 'analytics_result',
    command: '/expense',
    title: `Expense Breakdown (${range.label})`,
    businessId: String(ctx.businessId),
    dateRange: {
      start: range.start.toISOString(),
      endExclusive: range.endExclusive.toISOString(),
      timezone: range.timezone,
      preset: range.preset,
    },
    summary: [
      { label: 'Total Expenses', value: totalExpense, currency },
      { label: 'Expense Entries', value: combinedRows.length },
      { label: 'Top Category', value: categories[0]?.name || 'N/A' },
    ],
    columns: ['Date', 'Category', 'Amount', 'Method', 'Note'],
    rows: combinedRows.slice(0, spec.limit ?? 25),
    series,
    categories,
    selectedVisualization: spec.visualization || 'pie',
    visualizationCandidates: ['pie', 'bar', 'table', 'summary'],
  };
};

/**
 * 4. Profit & Loss (/profit)
 */
const executeProfit = async (
  spec: Extract<QuerySpec, { op: 'profit' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const currentRange = resolveDateRange(spec.range);
  const rangeDurationMs = currentRange.endExclusive.getTime() - currentRange.start.getTime();
  const prevStart = new Date(currentRange.start.getTime() - rangeDurationMs);
  const prevEnd = new Date(currentRange.start.getTime());

  const computePeriod = async (from: Date, to: Date) => {
    const [salesAgg, cogsAgg, expAgg, txExpAgg] = await Promise.all([
      Sale.aggregate([
        { $match: { business: ctx.businessId, date: { $gte: from, $lt: to } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Sale.aggregate([
        { $match: { business: ctx.businessId, date: { $gte: from, $lt: to } } },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            let: { prodId: '$items.product' },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ['$_id', '$$prodId'] }, { $eq: ['$business', ctx.businessId] }] } } },
            ],
            as: 'productDoc',
          },
        },
        { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: null,
            cogs: { $sum: { $multiply: ['$items.quantity', { $ifNull: ['$productDoc.purchasePrice', 0] }] } },
          },
        },
      ]),
      Expense.aggregate([
        { $match: { business: ctx.businessId, date: { $gte: from, $lt: to } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.aggregate([
        {
          $match: {
            business: ctx.businessId,
            type: 'expense',
            $or: [{ source: { $exists: false } }, { source: null }],
            date: { $gte: from, $lt: to },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const sales = salesAgg[0]?.total ?? 0;
    const cogs = cogsAgg[0]?.cogs ?? 0;
    const expenses = (expAgg[0]?.total ?? 0) + (txExpAgg[0]?.total ?? 0);
    const gross = sales - cogs;
    const net = gross - expenses;
    return { sales, cogs, expenses, gross, net };
  };

  const [current, previous] = await Promise.all([
    computePeriod(currentRange.start, currentRange.endExclusive),
    computePeriod(prevStart, prevEnd),
  ]);

  const marginPct = current.sales > 0 ? ((current.net / current.sales) * 100).toFixed(1) : '0';

  const series: AnalyticsSeriesItem[] = [
    { label: 'Current Sales', value: current.sales },
    { label: 'Current Net Profit', value: Math.max(0, current.net) },
    { label: 'Previous Sales', value: previous.sales },
    { label: 'Previous Net Profit', value: Math.max(0, previous.net) },
  ];

  return {
    type: 'analytics_result',
    command: '/profit',
    title: `Profit & Loss Statement (${currentRange.label})`,
    businessId: String(ctx.businessId),
    dateRange: {
      start: currentRange.start.toISOString(),
      endExclusive: currentRange.endExclusive.toISOString(),
      timezone: currentRange.timezone,
      preset: currentRange.preset,
    },
    summary: [
      { label: 'Gross Profit', value: current.gross, currency },
      { label: 'Net Profit', value: current.net, currency },
      { label: 'Net Margin', value: `${marginPct}%` },
      { label: 'COGS', value: current.cogs, currency },
    ],
    columns: ['Metric', 'Current Period', 'Previous Period'],
    rows: [
      ['Total Sales', formatMoney(current.sales, currency), formatMoney(previous.sales, currency)],
      ['Cost of Goods Sold (COGS)', formatMoney(current.cogs, currency), formatMoney(previous.cogs, currency)],
      ['Gross Profit', formatMoney(current.gross, currency), formatMoney(previous.gross, currency)],
      ['Operating Expenses', formatMoney(current.expenses, currency), formatMoney(previous.expenses, currency)],
      ['Net Profit', formatMoney(current.net, currency), formatMoney(previous.net, currency)],
    ],
    series,
    selectedVisualization: spec.visualization || 'summary',
    visualizationCandidates: ['summary', 'bar', 'table'],
  };
};

/**
 * 5. Income (/income)
 */
const executeIncome = async (
  spec: Extract<QuerySpec, { op: 'income' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const range = resolveDateRange(spec.range);

  const txDocs = await Transaction.find({
    business: ctx.businessId,
    type: 'income',
    date: { $gte: range.start, $lt: range.endExclusive },
  })
    .populate('category', 'name')
    .sort({ date: -1 })
    .lean();

  let totalIncome = 0;
  const categoryMap = new Map<string, number>();
  const rows: (string | number)[][] = [];

  for (const tx of txDocs) {
    totalIncome += tx.amount;
    const cat = (tx.category as any)?.name || 'Income';
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + tx.amount);
    rows.push([
      formatDateCell(tx.date),
      cat,
      formatMoney(tx.amount, currency),
      tx.paymentMethod || 'cash',
      tx.note || '',
    ]);
  }

  const series: AnalyticsSeriesItem[] = Array.from(categoryMap.entries()).map(([label, value]) => ({
    label,
    value,
  }));

  return {
    type: 'analytics_result',
    command: '/income',
    title: `Income Overview (${range.label})`,
    businessId: String(ctx.businessId),
    dateRange: {
      start: range.start.toISOString(),
      endExclusive: range.endExclusive.toISOString(),
      timezone: range.timezone,
      preset: range.preset,
    },
    summary: [
      { label: 'Total Income', value: totalIncome, currency },
      { label: 'Income Transactions', value: txDocs.length },
    ],
    columns: ['Date', 'Category', 'Amount', 'Method', 'Note'],
    rows: rows.slice(0, spec.limit ?? 25),
    series,
    selectedVisualization: spec.visualization || 'bar',
    visualizationCandidates: ['bar', 'summary', 'table', 'pie'],
  };
};

/**
 * 6. Outstanding Dues (/due)
 */
const executeDue = async (
  spec: Extract<QuerySpec, { op: 'due' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const [customers, suppliers] = await Promise.all([
    Customer.find({ business: ctx.businessId, status: true, totalDue: { $gt: 0 } })
      .sort({ totalDue: -1 })
      .limit(20)
      .lean(),
    Supplier.find({ business: ctx.businessId, status: true, totalPayable: { $gt: 0 } })
      .sort({ totalPayable: -1 })
      .limit(20)
      .lean(),
  ]);

  const totalReceivables = customers.reduce((acc, c) => acc + (c.totalDue || 0), 0);
  const totalPayables = suppliers.reduce((acc, s) => acc + (s.totalPayable || 0), 0);
  const netDueBalance = totalReceivables - totalPayables;

  const rows: (string | number)[][] = [
    ...customers.map((c) => [c.name, 'Customer (Receivable)', c.phone || '-', formatMoney(c.totalDue, currency)]),
    ...suppliers.map((s) => [s.name, 'Supplier (Payable)', s.phone || '-', formatMoney(s.totalPayable, currency)]),
  ];

  const series: AnalyticsSeriesItem[] = [
    { label: 'Receivables (পাওনা)', value: totalReceivables },
    { label: 'Payables (দেনা)', value: totalPayables },
  ];

  return {
    type: 'analytics_result',
    command: '/due',
    title: 'Outstanding Dues (বকেয়া হিসাব)',
    businessId: String(ctx.businessId),
    summary: [
      { label: 'Customer Receivables', value: totalReceivables, currency },
      { label: 'Supplier Payables', value: totalPayables, currency },
      { label: 'Net Due Position', value: netDueBalance, currency },
    ],
    columns: ['Party Name', 'Type', 'Phone', 'Due Amount'],
    rows,
    series,
    selectedVisualization: spec.visualization || 'summary',
    visualizationCandidates: ['summary', 'table', 'bar'],
  };
};

/**
 * 7. Cash & Bank Balance (/balance)
 */
const executeBalance = async (
  spec: Extract<QuerySpec, { op: 'balance' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const business = await Business.findById(ctx.businessId)
    .select('cashBalance bankBalance openingBalance name')
    .lean<{ cashBalance?: number; bankBalance?: number; openingBalance?: number }>();

  const cash = business?.cashBalance ?? 0;
  const bank = business?.bankBalance ?? 0;
  const total = cash + bank;

  const categories: AnalyticsCategoryItem[] = [
    { name: 'Cash in Hand', value: Math.max(0, cash) },
    { name: 'Bank Balance', value: Math.max(0, bank) },
  ];

  return {
    type: 'analytics_result',
    command: '/balance',
    title: 'Cash & Bank Reserves',
    businessId: String(ctx.businessId),
    summary: [
      { label: 'Total Liquid Balance', value: total, currency },
      { label: 'Cash in Hand', value: cash, currency },
      { label: 'Bank Balance', value: bank, currency },
    ],
    columns: ['Account', 'Balance'],
    rows: [
      ['Cash in Hand', formatMoney(cash, currency)],
      ['Bank Account', formatMoney(bank, currency)],
      ['Total Reserves', formatMoney(total, currency)],
    ],
    categories,
    selectedVisualization: spec.visualization || 'summary',
    visualizationCandidates: ['summary', 'pie'],
  };
};

/**
 * 8. Inventory (/inventory)
 */
const executeInventory = async (
  spec: Extract<QuerySpec, { op: 'inventory' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const products = await Product.find({ business: ctx.businessId, status: true }).lean();

  let totalValuation = 0;
  let totalStockUnits = 0;
  let lowStockCount = 0;

  const rows: (string | number)[][] = [];

  for (const p of products) {
    const valuation = (p.stock || 0) * (p.purchasePrice || 0);
    totalValuation += valuation;
    totalStockUnits += p.stock || 0;
    const isLow = p.stock <= (p.minStock ?? 5);
    if (isLow) lowStockCount += 1;

    rows.push([
      p.name,
      p.sku || '-',
      `${p.stock} ${p.unit || 'pcs'}`,
      `${p.minStock ?? 5}`,
      formatMoney(p.purchasePrice || 0, currency),
      formatMoney(p.sellingPrice || 0, currency),
      isLow ? '⚠️ Low Stock' : 'OK',
    ]);
  }

  // Sort rows: low stock items first
  rows.sort((a, b) => (a[6] === '⚠️ Low Stock' ? -1 : 1));

  return {
    type: 'analytics_result',
    command: '/inventory',
    title: 'Inventory & Stock Valuation',
    businessId: String(ctx.businessId),
    summary: [
      { label: 'Total Stock Valuation', value: totalValuation, currency },
      { label: 'Total Products', value: products.length },
      { label: 'Low Stock Alerts', value: lowStockCount },
      { label: 'Total Units', value: totalStockUnits },
    ],
    columns: ['Product Name', 'SKU', 'Stock', 'Min Stock', 'Buy Price', 'Sell Price', 'Status'],
    rows: rows.slice(0, spec.limit ?? 25),
    selectedVisualization: spec.visualization || 'table',
    visualizationCandidates: ['table', 'summary', 'bar'],
  };
};

/**
 * 9. Purchase (/purchase)
 */
const executePurchase = async (
  spec: Extract<QuerySpec, { op: 'purchase' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const range = resolveDateRange(spec.range);

  const [purchasesAgg, dailyAgg, listRows] = await Promise.all([
    Purchase.aggregate([
      { $match: { business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          paid: { $sum: '$paidAmount' },
          due: { $sum: '$dueAmount' },
          count: { $sum: 1 },
        },
      },
    ]),
    Purchase.aggregate([
      { $match: { business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          value: { $sum: '$total' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Purchase.find({ business: ctx.businessId, date: { $gte: range.start, $lt: range.endExclusive } })
      .sort({ date: -1 })
      .limit(spec.limit ?? 20)
      .populate('supplier', 'name phone')
      .lean(),
  ]);

  const total = purchasesAgg[0]?.total ?? 0;
  const paid = purchasesAgg[0]?.paid ?? 0;
  const due = purchasesAgg[0]?.due ?? 0;
  const count = purchasesAgg[0]?.count ?? 0;

  const series: AnalyticsSeriesItem[] = dailyAgg.map((d: any) => ({
    label: d._id,
    value: d.value,
  }));

  const rows = listRows.map((p: any) => [
    formatDateCell(p.date),
    p.referenceNumber || '-',
    p.supplier?.name || 'Walk-in Vendor',
    formatMoney(p.total, currency),
    formatMoney(p.paidAmount, currency),
    formatMoney(p.dueAmount, currency),
    p.status,
  ]);

  return {
    type: 'analytics_result',
    command: '/purchase',
    title: `Purchases & Procurement (${range.label})`,
    businessId: String(ctx.businessId),
    dateRange: {
      start: range.start.toISOString(),
      endExclusive: range.endExclusive.toISOString(),
      timezone: range.timezone,
      preset: range.preset,
    },
    summary: [
      { label: 'Total Purchases', value: total, currency },
      { label: 'Amount Paid', value: paid, currency },
      { label: 'Due Payable', value: due, currency },
      { label: 'Orders', value: count },
    ],
    columns: ['Date', 'Reference', 'Supplier', 'Total', 'Paid', 'Due', 'Status'],
    rows,
    series,
    selectedVisualization: spec.visualization || 'bar',
    visualizationCandidates: ['bar', 'table', 'summary'],
  };
};

/**
 * 10. Customer (/customer)
 */
const executeCustomer = async (
  spec: Extract<QuerySpec, { op: 'customer' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const customers = await Customer.find({ business: ctx.businessId, status: true })
    .sort({ totalSales: -1 })
    .limit(spec.limit ?? 15)
    .lean();

  const rows = customers.map((c) => [
    c.name,
    c.phone || '-',
    formatMoney(c.totalSales || 0, currency),
    formatMoney(c.totalPaid || 0, currency),
    formatMoney(c.totalDue || 0, currency),
  ]);

  const series: AnalyticsSeriesItem[] = customers.map((c) => ({
    label: c.name,
    value: c.totalSales || 0,
  }));

  return {
    type: 'analytics_result',
    command: '/customer',
    title: 'Top Customers by Sales Volume',
    businessId: String(ctx.businessId),
    summary: [
      { label: 'Total Customers', value: customers.length },
      { label: 'Top Customer', value: customers[0]?.name || 'N/A' },
    ],
    columns: ['Customer Name', 'Phone', 'Total Sales', 'Total Paid', 'Total Due'],
    rows,
    series,
    selectedVisualization: spec.visualization || 'table',
    visualizationCandidates: ['table', 'bar'],
  };
};

/**
 * 11. Supplier (/supplier)
 */
const executeSupplier = async (
  spec: Extract<QuerySpec, { op: 'supplier' }>,
  ctx: ExecutorContext,
  currency: string,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const suppliers = await Supplier.find({ business: ctx.businessId, status: true })
    .sort({ totalPurchases: -1 })
    .limit(spec.limit ?? 15)
    .lean();

  const rows = suppliers.map((s) => [
    s.name,
    s.phone || '-',
    formatMoney(s.totalPurchases || 0, currency),
    formatMoney(s.totalPaid || 0, currency),
    formatMoney(s.totalPayable || 0, currency),
  ]);

  const series: AnalyticsSeriesItem[] = suppliers.map((s) => ({
    label: s.name,
    value: s.totalPurchases || 0,
  }));

  return {
    type: 'analytics_result',
    command: '/supplier',
    title: 'Top Suppliers by Procurement Volume',
    businessId: String(ctx.businessId),
    summary: [
      { label: 'Total Suppliers', value: suppliers.length },
      { label: 'Top Supplier', value: suppliers[0]?.name || 'N/A' },
    ],
    columns: ['Supplier Name', 'Phone', 'Total Purchases', 'Total Paid', 'Total Payable'],
    rows,
    series,
    selectedVisualization: spec.visualization || 'table',
    visualizationCandidates: ['table', 'bar'],
  };
};

/**
 * 12. Help (/help)
 */
const executeHelp = async (
  _spec: Extract<QuerySpec, { op: 'help' }>,
  ctx: ExecutorContext,
): Promise<Omit<AnalyticsResult, 'metadata'>> => {
  const commands = Object.values(COMMAND_REGISTRY);

  const rows = commands.map((c) => [
    c.name,
    c.label,
    c.description,
    c.examples[0]?.en || '',
  ]);

  return {
    type: 'analytics_result',
    command: '/help',
    title: 'HisabBoi Analytics Commands Guide',
    businessId: String(ctx.businessId),
    summary: [
      { label: 'Supported Commands', value: commands.length },
    ],
    columns: ['Command', 'Name', 'Description', 'Example'],
    rows,
    selectedVisualization: 'summary',
    visualizationCandidates: ['summary', 'table'],
  };
};

/* ───────── Main Dispatcher ───────── */

export const executeQuery = async (
  spec: QuerySpec,
  ctx: ExecutorContext,
): Promise<AnalyticsResult> => {
  const startTime = Date.now();

  // 1️⃣ Enforce tenant authorization independently of AI input
  await requireMembership(ctx.businessId, ctx.userId);

  // 2️⃣ Load business settings
  const business = await Business.findById(ctx.businessId)
    .select('currency')
    .lean<{ currency?: string }>();
  if (!business) throw new ApiError(404, 'Business not found');
  const currency = business.currency === 'BDT' ? '৳' : (business.currency ?? '৳');

  let resultData: Omit<AnalyticsResult, 'metadata'>;

  switch (spec.op) {
    case 'overview':
      resultData = await executeOverview(spec, ctx, currency);
      break;
    case 'sales':
      resultData = await executeSales(spec, ctx, currency);
      break;
    case 'expense':
      resultData = await executeExpense(spec, ctx, currency);
      break;
    case 'profit':
      resultData = await executeProfit(spec, ctx, currency);
      break;
    case 'income':
      resultData = await executeIncome(spec, ctx, currency);
      break;
    case 'due':
      resultData = await executeDue(spec, ctx, currency);
      break;
    case 'balance':
      resultData = await executeBalance(spec, ctx, currency);
      break;
    case 'inventory':
      resultData = await executeInventory(spec, ctx, currency);
      break;
    case 'purchase':
      resultData = await executePurchase(spec, ctx, currency);
      break;
    case 'customer':
      resultData = await executeCustomer(spec, ctx, currency);
      break;
    case 'supplier':
      resultData = await executeSupplier(spec, ctx, currency);
      break;
    case 'help':
      resultData = await executeHelp(spec, ctx);
      break;
    case 'answer':
      resultData = {
        type: 'analytics_result',
        command: '/help',
        title: 'Information',
        businessId: String(ctx.businessId),
        summary: [{ label: 'Message', value: spec.text }],
        selectedVisualization: 'summary',
        visualizationCandidates: ['summary'],
      };
      break;
    default: {
      const _exhaustive: never = spec;
      throw new ApiError(400, `Unsupported operation: ${(_exhaustive as any)?.op}`);
    }
  }

  const executionTimeMs = Date.now() - startTime;

  return {
    ...resultData,
    metadata: {
      generatedAt: new Date().toISOString(),
      executionTimeMs,
    },
  };
};
