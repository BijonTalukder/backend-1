// scripts/setup-frontend-analytics.js
const fs = require('fs');
const path = require('path');

const frontendRoot = 'd:/hisabboi/cashbook-frontend/src/pages/Ai';

// 1. Write types.ts
const typesContent = `// src/pages/Ai/types.ts
export type AnalyticsVisualization =
  | 'summary'
  | 'bar'
  | 'line'
  | 'pie'
  | 'table'
  | 'number';

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
  metadata?: {
    generatedAt: string;
    executionTimeMs: number;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  error?: boolean;
  analytics?: AnalyticsResult;
  formatPreference?: AnalyticsVisualization;
}

export interface CommandSuggestion {
  name: string;
  label: string;
  labelBn: string;
  description: string;
  descriptionBn: string;
  defaultVisualization: AnalyticsVisualization;
  examples: { en: string; bn: string }[];
}
`;

fs.writeFileSync(path.join(frontendRoot, 'types.ts'), typesContent, 'utf8');
console.log('✓ types.ts written');

// Ensure components directory exists
const compDir = path.join(frontendRoot, 'components');
if (!fs.existsSync(compDir)) {
  fs.mkdirSync(compDir, { recursive: true });
}

// 2. Write AnalyticsView.tsx
const analyticsViewContent = `// src/pages/Ai/components/AnalyticsView.tsx
import React, { useState } from 'react';
import {
  LayoutGrid,
  BarChart2,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  Table as TableIcon,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type { AnalyticsResult, AnalyticsVisualization } from '../types';

interface AnalyticsViewProps {
  analytics: AnalyticsResult;
  onFormatChange?: (format: AnalyticsVisualization) => void;
}

const PIE_COLORS = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#6366f1',
];

const TAB_CONFIG: {
  key: AnalyticsVisualization;
  label: string;
  icon: React.ElementType;
}[] = [
  { key: 'summary', label: 'Summary', icon: LayoutGrid },
  { key: 'bar', label: 'Bar', icon: BarChart2 },
  { key: 'line', label: 'Trend', icon: LineChartIcon },
  { key: 'pie', label: 'Pie', icon: PieChartIcon },
  { key: 'table', label: 'Table', icon: TableIcon },
];

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  analytics,
  onFormatChange,
}) => {
  const [format, setFormat] = useState<AnalyticsVisualization>(() => {
    return analytics.selectedVisualization || 'summary';
  });

  const handleSelectFormat = (f: AnalyticsVisualization) => {
    setFormat(f);
    if (onFormatChange) onFormatChange(f);
  };

  const candidates = analytics.visualizationCandidates || ['summary'];
  const hasSeries = !!(analytics.series && analytics.series.length > 0);
  const hasCategories = !!(analytics.categories && analytics.categories.length > 0);
  const hasRows = !!(analytics.rows && analytics.rows.length > 0);

  // Custom Recharts Dark Tooltip
  const renderCustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div
          className="px-2.5 py-1.5 rounded-lg text-xs shadow-lg"
          style={{
            background: 'var(--bg-elevated, #1e293b)',
            border: '1px solid var(--border-strong, #334155)',
            color: 'var(--text-primary, #f8fafc)',
          }}
        >
          <p className="font-semibold">{label || data.name}</p>
          <p style={{ color: '#10b981' }}>
            {typeof data.value === 'number' ? data.value.toLocaleString('en-IN') : data.value}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full mt-2 space-y-3">
      {/* Title & Metadata Strip */}
      <div className="flex items-center justify-between text-xs pb-1" style={{ borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
        <span className="font-medium" style={{ color: '#10b981' }}>
          {analytics.command || '/analytics'}
        </span>
        {analytics.dateRange?.preset && (
          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
            {analytics.dateRange.preset}
          </span>
        )}
      </div>

      {/* KPI Summary Cards Grid */}
      {analytics.summary && analytics.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {analytics.summary.map((item, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-xl flex flex-col justify-between"
              style={{
                background: 'var(--surface-3, rgba(255,255,255,0.04))',
                border: '1px solid var(--border, rgba(255,255,255,0.08))',
              }}
            >
              <span className="text-[11px]" style={{ color: 'var(--text-faint, #94a3b8)' }}>
                {item.label}
              </span>
              <div className="font-bold text-sm mt-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                {item.currency ? item.currency + ' ' : ''}
                {typeof item.value === 'number' ? item.value.toLocaleString('en-IN') : item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Interactive Format Switcher Tabs */}
      {candidates.length > 1 && (
        <div
          className="flex items-center gap-1 p-1 rounded-xl"
          style={{ background: 'var(--surface-2, rgba(255,255,255,0.03))' }}
        >
          {TAB_CONFIG.filter((t) => candidates.includes(t.key)).map((tab) => {
            const Icon = tab.icon;
            const isSelected = format === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => handleSelectFormat(tab.key)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: isSelected ? 'var(--surface-4, #10b981)' : 'transparent',
                  color: isSelected ? '#ffffff' : 'var(--text-muted, #94a3b8)',
                }}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* View Content based on Selected Format */}
      <div className="w-full">
        {format === 'bar' && hasSeries && (
          <div className="h-52 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.series} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  stroke="var(--text-faint, #64748b)"
                  fontSize={10}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="var(--text-faint, #64748b)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)}
                />
                <Tooltip content={renderCustomTooltip} />
                <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {format === 'line' && hasSeries && (
          <div className="h-52 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.series} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  stroke="var(--text-faint, #64748b)"
                  fontSize={10}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="var(--text-faint, #64748b)"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)}
                />
                <Tooltip content={renderCustomTooltip} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#10b981' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {format === 'pie' && hasCategories && (
          <div className="h-52 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.categories}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={68}
                  innerRadius={36}
                  paddingAngle={2}
                >
                  {analytics.categories?.map((_, index) => (
                    <Cell key={'cell-' + index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={renderCustomTooltip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 justify-center mt-1">
              {analytics.categories?.slice(0, 5).map((cat, i) => (
                <div key={i} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted, #94a3b8)' }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span>{cat.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {format === 'table' && hasRows && analytics.columns && (
          <div className="w-full max-h-56 overflow-y-auto rounded-xl border mt-2" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
            <table className="w-full text-[11px] text-left">
              <thead style={{ background: 'var(--surface-3, rgba(255,255,255,0.06))', color: 'var(--text-faint, #94a3b8)' }}>
                <tr>
                  {analytics.columns.map((col, idx) => (
                    <th key={idx} className="py-2 px-2.5 font-medium whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border, rgba(255,255,255,0.04))' }}>
                {(analytics.rows || []).map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-white/5 transition-colors">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="py-1.5 px-2.5 whitespace-nowrap" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
`;

fs.writeFileSync(path.join(compDir, 'AnalyticsView.tsx'), analyticsViewContent, 'utf8');
console.log('✓ AnalyticsView.tsx written');

// 3. Write CommandAutocomplete.tsx
const commandAutocompleteContent = `// src/pages/Ai/components/CommandAutocomplete.tsx
import React from 'react';
import {
  TrendingUp,
  Receipt,
  PiggyBank,
  DollarSign,
  AlertCircle,
  Wallet,
  Package,
  ShoppingCart,
  Users,
  Building,
  HelpCircle,
  FileText,
} from 'lucide-react';

export interface CommandItem {
  name: string;
  label: string;
  labelBn: string;
  description: string;
  icon: React.ElementType;
}

const COMMAND_LIST: CommandItem[] = [
  { name: '/report', label: 'Business Overview', labelBn: 'সার্বিক বিবরণ', description: 'Complete financial overview & profit', icon: FileText },
  { name: '/sales', label: 'Sales Analytics', labelBn: 'বিক্রয় বিশ্লেষণ', description: 'Total sales revenue, dues & trend', icon: TrendingUp },
  { name: '/expense', label: 'Expenses', labelBn: 'খরচের হিসাব', description: 'Categorized business & cashbook expenses', icon: Receipt },
  { name: '/profit', label: 'Profit & Loss', labelBn: 'লাভ ও লোকসান', description: 'Gross profit, COGS & net margins', icon: PiggyBank },
  { name: '/income', label: 'Income & Cash In', labelBn: 'আয় ও ক্যাশ ইন', description: 'Direct revenue & receipts', icon: DollarSign },
  { name: '/due', label: 'Outstanding Dues', labelBn: 'বকেয়া হিসাব', description: 'Customer receivables & supplier payables', icon: AlertCircle },
  { name: '/balance', label: 'Cash & Bank', labelBn: 'ক্যাশ ও ব্যাংক', description: 'Liquid cash in hand & bank balance', icon: Wallet },
  { name: '/inventory', label: 'Stock Valuation', labelBn: 'মজুদ পণ্য ও স্টক', description: 'Stock levels & low stock alerts', icon: Package },
  { name: '/purchase', label: 'Purchases', labelBn: 'ক্রয় হিসাব', description: 'Supplier orders & procurement', icon: ShoppingCart },
  { name: '/customer', label: 'Top Customers', labelBn: 'শীর্ষ ক্রেতা', description: 'Customer sales volume & receivables', icon: Users },
  { name: '/supplier', label: 'Top Suppliers', labelBn: 'শীর্ষ সাপ্লায়ার', description: 'Procurement volume & payables', icon: Building },
  { name: '/help', label: 'Commands Guide', labelBn: 'সহায়িকা', description: 'List of all commands & tips', icon: HelpCircle },
];

interface CommandAutocompleteProps {
  query: string;
  onSelect: (commandName: string) => void;
  visible: boolean;
}

export const CommandAutocomplete: React.FC<CommandAutocompleteProps> = ({
  query,
  onSelect,
  visible,
}) => {
  if (!visible) return null;

  const normalized = query.toLowerCase().trim();
  const filtered = COMMAND_LIST.filter(
    (c) =>
      c.name.toLowerCase().startsWith(normalized) ||
      c.label.toLowerCase().includes(normalized.replace('/', '')) ||
      c.labelBn.includes(normalized.replace('/', '')),
  );

  if (filtered.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl overflow-hidden shadow-2xl z-50 border"
      style={{
        background: 'var(--bg-elevated, #0f172a)',
        borderColor: 'var(--border-strong, #334155)',
        maxHeight: '220px',
      }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-faint, #64748b)', background: 'var(--surface-2, rgba(255,255,255,0.03))' }}>
        Business Analytics Commands
      </div>
      <div className="overflow-y-auto max-h-48 divide-y" style={{ borderColor: 'var(--border, rgba(255,255,255,0.05))' }}>
        {filtered.map((cmd) => {
          const Icon = cmd.icon;
          return (
            <button
              key={cmd.name}
              type="button"
              onClick={() => onSelect(cmd.name)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-emerald-500/10"
            >
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>
                <Icon size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs" style={{ color: '#10b981' }}>
                    {cmd.name}
                  </span>
                  <span className="text-xs truncate font-medium" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                    {cmd.label}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-faint, #64748b)' }}>
                    ({cmd.labelBn})
                  </span>
                </div>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-faint, #94a3b8)' }}>
                  {cmd.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
`;

fs.writeFileSync(path.join(compDir, 'CommandAutocomplete.tsx'), commandAutocompleteContent, 'utf8');
console.log('✓ CommandAutocomplete.tsx written');

console.log('Frontend setup helper executed successfully.');
