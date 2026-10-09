# HisabBoi AI Business Analytics — Implementation Plan

**Version:** 1.0.0  
**Status:** Ready for Review & Approval (Phase A Completed)

---

## 1. Implementation Goals & Principles

1. **True Chat Integration:** Integrate analytics directly into the existing HisabBoi AI chat (`FloatingAI.tsx`) so that command input (e.g., `/sales`, `/profit`), natural language questions in English or Bengali, and follow-up adjustments (e.g., *"Show as bar chart"*) work within the existing conversational flow.
2. **Accounting Accuracy:** Never estimate or hallucinate financial numbers. Formulas must match HisabBoi's established accounting rules (`Sale`, `Purchase`, `Expense`, `Transaction`, `Customer`, `Supplier`, `Product`).
3. **Rigorous Tenant Isolation:** Business ID and tenant constraints are injected server-side from verified JWT session and `BusinessMembers` authorization. Client or AI-provided tenant IDs are never trusted.
4. **Timezone Fidelity:** Relative dates (`today`, `yesterday`, `thisMonth`, `last7`, etc.) are computed in the business timezone (`Asia/Dhaka` UTC+6 by default).
5. **Interactive Visualization Selection:** Return verified query results with `visualizationCandidates` (e.g., `['summary', 'bar', 'line', 'table']`) and allow users to switch visualization formats instantly without re-querying the database.

---

## 2. Standardized Analytics API Contract

### Request: `POST /api/ai/chat`
```json
{
  "businessId": "65f8a...",
  "messages": [
    { "role": "user", "content": "/sales Show total sales for this month" }
  ],
  "formatPreference": "bar"
}
```

### Response (when intent is analytics):
```json
{
  "statusCode": 200,
  "success": true,
  "message": "OK",
  "data": {
    "reply": "Here is your sales report for this month (total ৳45,000 across 12 sales).",
    "analytics": {
      "type": "analytics_result",
      "command": "/sales",
      "title": "Monthly Sales Performance",
      "businessId": "65f8a...",
      "dateRange": {
        "start": "2026-10-01T00:00:00+06:00",
        "endExclusive": "2026-11-01T00:00:00+06:00",
        "timezone": "Asia/Dhaka",
        "preset": "thisMonth"
      },
      "summary": [
        { "label": "Total Sales", "value": 45000, "currency": "৳" },
        { "label": "Cash Received", "value": 38000, "currency": "৳" },
        { "label": "Due Amount", "value": 7000, "currency": "৳" }
      ],
      "columns": ["Date", "Invoice", "Customer", "Amount", "Status"],
      "rows": [
        ["01 Oct 2026", "INV-101", "Rahim Enterprise", 15000, "paid"],
        ["05 Oct 2026", "INV-102", "Karim Traders", 30000, "partial"]
      ],
      "series": [
        { "date": "2026-10-01", "value": 15000 },
        { "date": "2026-10-05", "value": 30000 }
      ],
      "categories": [],
      "selectedVisualization": "bar",
      "visualizationCandidates": ["summary", "bar", "line", "table"],
      "metadata": {
        "generatedAt": "2026-10-09T21:30:00.000Z",
        "executionTimeMs": 24
      }
    }
  }
}
```

---

## 3. Stage-by-Stage Implementation Plan

### Stage 1: Centralized Analytics & Command Registry
- **File:** `src/services/analyticsRegistry.service.ts`
- **Scope:**
  - Define all supported commands:
    - `/report`: Comprehensive business overview.
    - `/sales`: Total sales, trend, cash vs due, item breakdown.
    - `/expense`: Categorized expenses (business expense + cashbook).
    - `/profit`: Gross profit, COGS, net profit breakdown.
    - `/income`: Direct cashbook and business income.
    - `/due`: Customer receivables and supplier payables.
    - `/balance`: Cash in hand, bank balance, net liquid funds.
    - `/inventory`: Product stock valuation, low stock warnings (`stock <= minStock`).
    - `/purchase`: Procurement totals and vendor breakdown.
    - `/customer`: Top customers by volume and outstanding receivables.
    - `/supplier`: Vendor payments and pending payables.
    - `/help`: Detailed usage guide and examples in English and Bengali.
  - Map each command to allowed roles (`owner`, `admin`, `member`), supported business types, allowed metrics, date presets, and visualization candidates.
  - Expose API `GET /api/ai/commands` for the frontend to dynamically populate suggestions and descriptions based on active business type.

### Stage 2: Timezone and Date Boundary Engine
- **File:** `src/utils/timezone.ts`
- **Scope:**
  - Robust calculation of date boundaries using `Asia/Dhaka` (UTC+6) by default or business custom timezone if specified.
  - Accurate definitions for presets: `today`, `yesterday`, `thisWeek`, `lastWeek`, `thisMonth`, `lastMonth`, `last7`, `last30`, `thisYear`.
  - Always generate `start` (inclusive) and `endExclusive` timestamps in UTC for reliable indexed MongoDB queries.

### Stage 3: Schema-Aware Gemini Query Planner
- **File:** `src/services/aiQueryPlanner.service.ts`
- **Scope:**
  - Parse user message for commands or detect natural language intent.
  - Feed minimal schema metadata and business context to Gemini.
  - Support bilingual input (English & Bengali).
  - Strongly type and validate the generated query plan.
  - Handle follow-up messages (e.g. *"Show as bar chart"*, *"Compare with last month"*).

### Stage 4: Secure Multi-Tenant Query Builder & Executor
- **File:** `src/services/queryExecutor.service.ts`
- **Scope:**
  - Enforce server-side tenant isolation (`business: objectBusinessId`) across every query and aggregation stage.
  - Query actual database models:
    - Sales: `Sale` collection (using `total`, `paidAmount`, `dueAmount`, `items`).
    - Expenses: `Expense` collection + cashbook `Transaction` (where `type === 'expense' && !source`).
    - Profit: Call proven `computeProfitLoss` logic (`Sale`, `Expense`, `Product`).
    - Dues: `Customer.find` / `Customer.aggregate` (`totalDue`) and `Supplier.find` / `Supplier.aggregate` (`totalPayable`).
    - Inventory: `Product.find` for low stock (`stock <= minStock`) and valuation (`stock * purchasePrice`).
    - Balance: `Business` cashBalance and bankBalance.
  - Construct standardized `AnalyticsResult` with KPI cards, series, categories, table rows, and `visualizationCandidates`.

### Stage 5: Unify AI Controller & Routes
- **File:** `src/controllers/ai.controller.ts` & `src/routes/route.ts`
- **Scope:**
  - Upgrade `POST /api/ai/chat` to detect when a command or business analytics question is asked.
  - When analytics is triggered:
    1. Authenticate and verify membership.
    2. Generate structured plan.
    3. Execute query with tenant isolation.
    4. Return conversational narrative reply + structured `analytics` payload.
  - When quick transaction creation is triggered (e.g. *"বাজার ৫০০ টাকা"*): maintain existing transaction recording behavior.
  - When general conversational advice is asked: retain helpful AI advice.
  - Maintain `POST /api/ai/command` as an alias for direct programmatic consumers.

### Stage 6: Frontend Command Autocomplete & Input Experience
- **File:** `cashbook-frontend/src/pages/Ai/FloatingAI.tsx`
- **Scope:**
  - Autocomplete popup triggered when typing `/` in the input field.
  - Filter command suggestions dynamically based on active business type.
  - Show command syntax, short descriptions, and quick-fill clickable suggestions.
  - Support clicking suggestion chips to execute immediately.

### Stage 7: Frontend Rich Analytics Visualization & Format Switcher
- **Files:**
  - `cashbook-frontend/src/pages/Ai/components/AnalyticsCard.tsx`
  - `cashbook-frontend/src/pages/Ai/components/AnalyticsCharts.tsx`
  - `cashbook-frontend/src/pages/Ai/FloatingAI.tsx`
- **Scope:**
  - Render KPI summary cards for key metrics (Total Sales, Cash Received, Dues, Net Profit).
  - Interactive Format Picker tabs (`[Summary] [Bar Chart] [Line Chart] [Table]`).
  - Render responsive Recharts components (`BarChart`, `LineChart`, `PieChart`) styled with HisabBoi's theme palette.
  - Render searchable, paginated data table for list/transaction views.
  - Allow client-side switching of visualization formats without triggering unnecessary backend re-queries.

### Stage 8: Automated Test Suite & Security Verification
- **Test Files:**
  - `src/__tests__/analyticsRegistry.test.ts`: Command validation, permissions, and business-type compatibility.
  - `src/__tests__/aiQueryPlanner.test.ts`: Plan validation, Bengali parsing, injection rejection.
  - `src/__tests__/queryExecutor.test.ts`: Metric accuracy, COGS/profit, cashbook expenses, dues, stock.
  - `src/__tests__/multiTenantSecurity.test.ts`: IDOR attacks, cross-tenant leaks, unauthorized role rejection.
  - Frontend Vitest tests for command autocomplete and visualization switching.

---

## 4. Acceptance Criteria & Definition of Done

- [x] All 12 business commands (`/report`, `/sales`, `/expense`, `/profit`, `/income`, `/due`, `/balance`, `/inventory`, `/purchase`, `/customer`, `/supplier`, `/help`) function accurately.
- [x] Natural language questions in English and Bengali are correctly translated to analytics plans.
- [x] Financial calculations match HisabBoi's official accounting standards.
- [x] Zero cross-tenant data leaks under automated negative security tests (`multiTenantSecurity.test.ts`).
- [x] Timezone boundaries in Bangladesh (`Asia/Dhaka`) correctly isolate "today", "yesterday", and "this month" (`timezone.test.ts`).
- [x] Chat UI renders KPI cards, interactive Recharts graphs, and tables with a format switcher (`AnalyticsView.tsx`).
- [x] Command autocomplete dropdown and quick chips implemented in chat input (`CommandAutocomplete.tsx`).
- [x] Existing features (quick transaction recording, conversation, dashboard, reports) suffer no regressions.
- [x] Both backend and frontend build and test suites pass with zero errors (`pnpm test`, `vitest run`).
