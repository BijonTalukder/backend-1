# HisabBoi AI Business Analytics — Full System Audit Report

**Date:** October 9, 2026  
**System:** HisabBoi Business Management Platform (Backend & Frontend)  
**Status:** Audit Completed — Pending User Approval for Phase B Implementation

---

## 1. Executive Summary

HisabBoi currently offers a dual-mode bookkeeping platform supporting **Personal**, **Company**, **Mass/Mess**, and **Business** types (with sub-types including Retail, Restaurant, Online Shop, Wholesale, Freelancer, and Service Business). A previous attempt was made to add command-based natural-language business analytics to the existing AI chat feature.

However, an in-depth audit of the full repository reveals that the previous implementation is **critically flawed, architecturally disconnected, and incomplete**:
1. **Disconnected Endpoints & Zero UI Integration:** The previous agent added a standalone `POST /api/ai/command` endpoint in the backend, but the frontend chat (`FloatingAI.tsx`) only ever calls `POST /api/ai/chat`. The frontend has no command autocomplete, no visualization picker, and no chart/table rendering components (despite `recharts` being installed).
2. **Incorrect Schema Assumptions & Missing Data:** In `queryExecutor.service.ts`, queries for sales, purchases, and expenses checked `Transaction` collection filtering on `'source.type'`. In reality, direct cashbook expenses and income recorded in HisabBoi have no `source` field, causing cashbook expenses to return **zero**. Furthermore, the rich metrics stored in dedicated collections (`Sale`, `Purchase`, `Expense`, `Customer`, `Supplier`, `Product`)—such as discounts, taxes, COGS, profit, receivables, payables, and stock levels—were either miscalculated or omitted.
3. **No Profit or Inventory Analytics:** Vital commands requested by business owners (`/profit`, `/due`, `/inventory`) had no execution logic in `queryExecutor.service.ts`.
4. **Timezone Blindness:** Date presets and ranges were computed using server UTC/local time rather than the business's timezone (`Asia/Dhaka` UTC+6), creating off-by-one errors for early-morning transactions.
5. **Lack of Automated Security & Integrity Tests:** No automated unit or integration tests existed in `backend-1` to verify tenant isolation, prompt injection resistance, or financial accuracy.

---

## 2. Existing Architecture Overview

### 2.1 Technology Stack
- **Backend (`d:\hisabboi\backend-1`):**
  - **Framework:** Express 5.2.1 on Node 22.20, TypeScript 5.9.3.
  - **Database & ODM:** MongoDB via Mongoose 9.2.1.
  - **Authentication:** JWT Bearer tokens and HTTP-only cookies (`auth.middleware.ts`), with administrative service key validation (`serviceKey.ts`).
  - **AI Engine:** Google Gemini (`gemini-2.5-pro` with automatic fallback to `gemini-2.5-flash` on HTTP 429/503), via direct HTTP fetch wrapper (`src/utils/gemini.ts`).
  - **Date Utilities:** `date-fns` 4.1.0.

- **Frontend (`d:\hisabboi\cashbook-frontend`):**
  - **Framework:** React 19, Vite 7, TypeScript 5.9.
  - **Styling:** TailwindCSS 4, CSS variables, dark/light themes.
  - **Visualizations:** `recharts` 3.7.0 installed.
  - **Icons & UI:** `lucide-react`, `sonner` (toasts).
  - **Testing:** `vitest` 3.2.7.
  - **Chat Interface:** `src/pages/Ai/FloatingAI.tsx` (Draggable floating action button, multi-step business selection modal, conversation view).

---

## 3. Confirmed Database Schemas and Relationships

| Collection / Model | Key Fields | Relationships & Tenant Isolation | Role in Analytics |
|---|---|---|---|
| **`Business`** | `_id`, `name`, `type` (`personal`, `company`, `mass`, `business`), `businessType` (`retail_shop`, `restaurant`, etc.), `currency` (default `'BDT'`), `openingBalance`, `cashBalance`, `bankBalance`, `paymentMethods`, `invoiceSettings` | Root tenant entity. Owner is `User`. | Defines tenant currency, supported business mode, and cash balances. |
| **`BusinessMembers`** | `_id`, `business`, `user`, `role` (`owner`, `admin`, `member`), `status` | Maps `User` to `Business`. Compound unique index `(business, user)`. | **The boundary of multi-tenant authorization**. Verified via `requireMembership`. |
| **`Transaction`** | `_id`, `business`, `type` (`income`, `expense`, `transfer`), `amount`, `date`, `category`, `member`, `createdBy`, `paymentMethod`, `customer`, `supplier`, `source` (`{ type, id }`) | Tenant-scoped by `business`. References `TransactionCategory`, `User`, `Customer`, `Supplier`. | Unified cashbook ledger. Contains direct cash flow entries and payments. |
| **`Sale`** | `_id`, `business`, `invoiceNumber`, `customer`, `items` (`product`, `productName`, `quantity`, `unitPrice`, `lineTotal`), `subtotal`, `discount`, `tax`, `total`, `paidAmount`, `dueAmount`, `paymentMethod`, `status` (`paid`, `partial`, `due`), `date`, `linkedTransaction` | Tenant-scoped by `business`. References `Customer`, `Product`, `Transaction`. | Source of truth for sales volume, customer dues, items sold, and revenue. |
| **`Purchase`** | `_id`, `business`, `referenceNumber`, `supplier`, `items` (`product`, `productName`, `quantity`, `unitPrice`, `lineTotal`), `subtotal`, `discount`, `total`, `paidAmount`, `dueAmount`, `paymentMethod`, `status`, `date`, `linkedTransaction` | Tenant-scoped by `business`. References `Supplier`, `Product`, `Transaction`. | Source of truth for procurement cost, supplier payables, and purchase trends. |
| **`Expense`** | `_id`, `business`, `category`, `amount`, `paymentMethod`, `date`, `note`, `linkedTransaction` | Tenant-scoped by `business`. References `TransactionCategory`, `Transaction`. | Source of truth for business operational expenses. |
| **`Customer`** | `_id`, `business`, `name`, `phone`, `email`, `openingBalance`, `totalSales`, `totalPaid`, `totalDue`, `status` | Tenant-scoped by `business`. | Source of truth for customer ledger balances and outstanding receivables. |
| **`Supplier`** | `_id`, `business`, `name`, `phone`, `email`, `openingBalance`, `totalPurchases`, `totalPaid`, `totalPayable`, `status` | Tenant-scoped by `business`. | Source of truth for vendor dues and payables. |
| **`Product`** | `_id`, `business`, `name`, `sku`, `category`, `purchasePrice`, `sellingPrice`, `stock`, `minStock`, `unit`, `status` | Tenant-scoped by `business`. | Source of truth for inventory valuation and stock alerts (`stock <= minStock`). |
| **`TransactionCategory`** | `_id`, `business`, `name`, `type` (`income`, `expense`), `icon`, `group` | Tenant-scoped by `business`. | Categories for income and expense classification. |

---

## 4. Analysis of Previous Implementation (File by File)

### 4.1 `src/controllers/ai.controller.ts`
- **What it does:** Contains `aiChat` (legacy endpoint) and `aiCommand` (recently added).
- **Flaws Identified:**
  1. `aiChat` pulls a static text snippet with this month/last month summary and 5 transactions, giving Gemini incomplete data for any non-trivial question.
  2. `aiCommand` was added as a parallel route that receives `{ businessId, text, chartHint }` and returns `{ spec, result }`. The chat UI has no awareness of this endpoint.
  3. No session or follow-up awareness: an analytics query cannot be refined (e.g., *"Now show it as a bar chart"* or *"Filter by Food"*).

### 4.2 `src/services/aiQueryPlanner.service.ts`
- **What it does:** Prompts Gemini to output a JSON `QuerySpec` and validates fields with ad-hoc type guards.
- **Flaws Identified:**
  1. Hardcoded allowed ops: `'sum'`, `'groupBy'`, `'timeSeries'`, `'compare'`, `'list'`, `'topN'`, `'answer'`.
  2. Lacks core business ops: no `profit` op, no `due` op, no `inventory` op.
  3. No understanding of command prefixes (e.g. `/sales`, `/profit`, `/report`).
  4. Prompt provides minimal metadata (only category names) and lacks awareness of customer/supplier dues or stock.

### 4.3 `src/services/queryExecutor.service.ts`
- **What it does:** Executes the `QuerySpec` using Mongoose queries and aggregations.
- **Flaws Identified:**
  1. **Accounting Failure on Expenses:** Lines 123-128 filtered `Transaction` by `{ 'source.type': 'expense' }`. Direct cashbook expenses do not populate `source.type`, so they were completely omitted.
  2. **Accounting Failure on Sales:** Used `Transaction` with `{ 'source.type': 'sale' }` rather than the canonical `Sale` collection, dropping invoice discounts, line item breakdowns, and dues.
  3. **Missing Profit Calculation:** HisabBoi's official formula in `report.controller.ts` calculates COGS from `Sale.items` and `Product.purchasePrice`, then `grossProfit = totalSales - COGS`, `netProfit = grossProfit - expenses`. This was completely missing.
  4. **No Timezone Awareness:** Used `new Date()` and `date-fns` UTC/local methods without converting to the Bangladesh/business timezone.
  5. **Non-standardized Result Shape:** Returned `{ intent, summary, chart: { type, data }, table }` rather than a standardized contract with `visualizationCandidates` (`['bar', 'line', 'table', 'summary']`) to enable user-selected visualization switches.

### 4.4 `cashbook-frontend/src/pages/Ai/FloatingAI.tsx`
- **What it does:** The frontend UI for the AI Assistant.
- **Flaws Identified:**
  1. No autocomplete or dropdown when typing `/`.
  2. Calls `POST /ai/chat` exclusively; ignores `POST /ai/command`.
  3. Only renders text messages using simple regex-based bullets and bold text. Cannot render charts, KPI metric cards, or tables.
  4. Does not provide visual format switching options (e.g., switching from summary to bar chart to table).

---

## 5. Security Audit & Multi-Tenant Isolation Risks

| Threat Scenario | Vulnerability in Previous Code | Required Remediation |
|---|---|---|
| **Tenant Injection via Prompt** | User asks: *"Show sales for business 65f... instead"*. | Business ID is never accepted from Gemini output. Hard-injected from trusted server session. |
| **Insecure Direct Object Reference (IDOR)** | Request supplies `businessId` in body without verifying user membership. | Server executes `requireMembership(objectBusinessId, objectUserId)` before any query. |
| **Cross-Tenant Join / Lookup Leak** | Aggregation `$lookup` on `products` or `customers` without filtering by `business`. | Every `$lookup` stage must include `pipeline: [{ $match: { business: objectBusinessId } }]` or join on collections scoped by business ID. |
| **Unauthorized Role Access** | A standard member requesting sensitive business-owner metrics (e.g., gross margins or staff splits). | Verify role in `BusinessMembers` against command requirements. |
| **Unbounded Query Execution** | Prompt produces unlimited `$match` or deep aggregations that freeze MongoDB. | Strict execution timeout, bounded pagination (`limit: 50` max), and restricted pipeline operators. |
| **API Key Exposure** | Gemini API key sent to client or logged. | Key remains strictly backend-only. |

---

## 6. Business Metrics and Accounting Correctness Formulas

To ensure financial accuracy, the analytics engine must use HisabBoi's established accounting rules:

1. **Total Sales:**
   $$\text{Total Sales} = \sum \text{Sale.total} \quad (\text{date} \in [\text{start}, \text{end}))$$
   $$\text{Cash Collected} = \sum \text{Sale.paidAmount}$$
   $$\text{Sales Due} = \sum \text{Sale.dueAmount}$$

2. **Cost of Goods Sold (COGS):**
   $$\text{COGS} = \sum (\text{Sale.items.quantity} \times \text{Product.purchasePrice})$$

3. **Gross Profit:**
   $$\text{Gross Profit} = \text{Total Sales} - \text{COGS}$$

4. **Total Expenses:**
   $$\text{Total Expenses} = \sum \text{Expense.amount} + \sum \text{Transaction}(\text{type} = \text{'expense'}, \text{source} = \text{null})$$

5. **Net Profit:**
   $$\text{Net Profit} = \text{Gross Profit} - \text{Total Expenses}$$

6. **Customer Receivables (Outstanding Dues):**
   $$\text{Total Receivables} = \sum \text{Customer.totalDue} \quad (\text{status} = \text{true})$$

7. **Supplier Payables (Outstanding Dues):**
   $$\text{Total Payables} = \sum \text{Supplier.totalPayable} \quad (\text{status} = \text{true})$$

8. **Inventory & Stock Health:**
   - **Valuation:** $\sum (\text{Product.stock} \times \text{Product.purchasePrice})$
   - **Low Stock Alert:** $\text{Product.stock} \le \text{Product.minStock}$

---

## 7. Categorized Action Plan

### 7.1 REUSE
- `src/utils/gemini.ts`: `callGeminiWithFallback`, model retry logic on 429/503.
- `src/utils/extractJson.ts`: Robust JSON extraction from markdown wrappers.
- `src/utils/businessAuth.ts`: `getValidIds`, `requireMembership`.
- `src/models/*`: All existing Mongoose models and schema indexes.
- Frontend Recharts library, Tailwind styles, and Floating AI modal layout.

### 7.2 FIX
- `src/services/queryExecutor.service.ts`: Fix expense summation to include cashbook expenses; fix sales to use `Sale` model; implement proper profit calculation and stock queries.
- Timezone handling: Standardize on `Asia/Dhaka` (UTC+6) with date boundaries (start-inclusive, end-exclusive).
- `src/controllers/ai.controller.ts`: Unify chat and command flows into a single cohesive experience.

### 7.3 REFACTOR
- `src/services/aiQueryPlanner.service.ts`: Replace ad-hoc schema generation with a typed, schema-validated command & intent planner.
- Output contract: Standardize the analytics response to match Section 11 of the specification.

### 7.4 REMOVE
- Broken queries searching `{ 'source.type': 'expense' }` on transactions without verifying source existence.
- Redundant disconnected standalone query routes that bypass the chat UX.

### 7.5 CREATE
- `src/services/analyticsRegistry.service.ts`: Central registry for commands, business types, permissions, metrics, and allowed visualizations.
- `src/utils/timezone.ts`: Boundary calculations for relative dates in business timezones.
- Backend automated unit and integration tests (security, financial correctness, planner, executor).
- Frontend command autocomplete menu and rich visualization components (KPI summary cards, Recharts line/bar/pie charts, data tables, format switcher).
