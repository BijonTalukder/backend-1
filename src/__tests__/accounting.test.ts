/// <reference path="../types/index.d.ts" />
// The money rules: payments settle invoices, returns, cost, casting, Dhaka days,
// what counts as income, and that ledger rows owned by a record can't be edited alone.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import ApiError from '../Error/handleApiError';
import { planAllocation } from '../utils/allocate';
import { planSaleReturn } from '../utils/saleReturn';
import { weightedAverageCost } from '../utils/cost';
import { toAmount, round2 } from '../utils/money';
import { localYearRange, toLocalDayString, localCalendarDay, resolveDateRange } from '../utils/timezone';
import { isReportable } from '../utils/ledger';
import Transaction from '../models/transaction.model';
import { BusinessMembersModel } from '../models/business-members.model';
import { transactionController } from '../controllers/transaction.controller';

const id = () => new Types.ObjectId();

describe('payments settle the oldest open invoices first', () => {
  it('pays off the oldest sale, then part of the next', () => {
    const a = { _id: id(), total: 1000, paidAmount: 0, dueAmount: 1000 };
    const b = { _id: id(), total: 500, paidAmount: 100, dueAmount: 400 };
    const plan = planAllocation([a, b], 1200);
    assert.deepEqual(
      plan.lines.map((l) => [l.applied, l.paidAmount, l.dueAmount, l.status]),
      [
        [1000, 1000, 0, 'paid'],
        [200, 300, 200, 'partial'],
      ],
    );
    assert.equal(plan.unapplied, 0);
  });

  it('leaves the rest for the opening balance when every invoice is paid', () => {
    const plan = planAllocation([{ _id: id(), total: 300, paidAmount: 0, dueAmount: 300 }], 500);
    assert.equal(plan.lines[0].status, 'paid');
    assert.equal(plan.unapplied, 200);
  });
});

describe('sale returns', () => {
  const p1 = id();
  const p2 = id();
  // subtotal 1000, discount 100, tax 0 → total 900; paid 400, due 500
  const sale = {
    items: [
      { product: p1, productName: 'Rice', quantity: 4, unitPrice: 200, returnedQuantity: 0 },
      { product: p2, productName: 'Oil', quantity: 2, unitPrice: 100, returnedQuantity: 0 },
    ],
    subtotal: 1000,
    total: 900,
    paidAmount: 400,
    dueAmount: 500,
    returnedTotal: 0,
  };

  it('values a partial return with the discount share and takes it off the due first', () => {
    const plan = planSaleReturn(sale, [{ product: String(p1), quantity: 1 }]);
    assert.equal(plan.amount, 180); // 200 × 0.9
    assert.equal(plan.dueReduced, 180);
    assert.equal(plan.refunded, 0);
    assert.equal(plan.fullyReturned, false);
  });

  it('cancel returns everything: clears the due and refunds what was paid', () => {
    const plan = planSaleReturn(sale, null);
    assert.equal(plan.amount, 900);
    assert.equal(plan.dueReduced, 500);
    assert.equal(plan.refunded, 400);
    assert.equal(plan.fullyReturned, true);
  });

  it('refuses more than is left to return', () => {
    assert.throws(
      () => planSaleReturn({ ...sale, items: [{ ...sale.items[0], returnedQuantity: 3 }, sale.items[1]] }, [{ product: String(p1), quantity: 2 }]),
      (e: unknown) => e instanceof ApiError && e.statusCode === 400,
    );
  });
});

describe('cost and amounts', () => {
  it('averages cost with the stock on hand', () => {
    assert.equal(weightedAverageCost(10, 80, 10, 100), 90);
    assert.equal(weightedAverageCost(0, 0, 5, 120), 120);
  });

  it('casts numeric strings instead of concatenating them ("5" tax)', () => {
    const subtotal = 100;
    const total = round2(subtotal - toAmount('10', 'Discount') + toAmount('5', 'Tax'));
    assert.equal(total, 95); // was "905"
    assert.throws(() => toAmount('abc', 'Tax'), (e: unknown) => e instanceof ApiError && e.statusCode === 400);
    assert.throws(() => toAmount(-1, 'Tax'), (e: unknown) => e instanceof ApiError);
    assert.equal(toAmount(0.1 + 0.2, 'X'), 0.3);
  });
});

describe('Dhaka days', () => {
  it('a year includes all of 31 December', () => {
    const { start, endExclusive } = localYearRange(2026);
    assert.equal(start.toISOString(), '2025-12-31T18:00:00.000Z');
    assert.equal(endExclusive.toISOString(), '2026-12-31T18:00:00.000Z');
    const lateOn31st = new Date('2026-12-31T17:30:00.000Z'); // 23:30 in Dhaka
    assert.ok(lateOn31st >= start && lateOn31st < endExclusive);
  });

  it('a 01:00 Dhaka entry belongs to that Dhaka day', () => {
    const oneAm = new Date('2026-11-21T19:00:00.000Z'); // 22 Nov 01:00 Dhaka
    assert.equal(toLocalDayString(oneAm.toISOString()), '2026-11-22');
    assert.equal(localCalendarDay(oneAm).toISOString(), '2026-11-22T00:00:00.000Z');
    const day = resolveDateRange({ from: '2026-11-22', to: '2026-11-22' });
    assert.ok(oneAm >= day.start && oneAm < day.endExclusive);
  });

  it('accepts a full ISO timestamp as a range end', () => {
    const r = resolveDateRange({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-30' });
    assert.equal(r.start.toISOString(), '2026-10-31T18:00:00.000Z');
  });
});

describe('what counts as income / expense', () => {
  it('excludes payments and the opening balance', () => {
    assert.equal(isReportable({ source: { type: 'sale' } }), true);
    assert.equal(isReportable({ source: null }), true);
    assert.equal(isReportable({ source: { type: 'payment' } }), false);
    assert.equal(isReportable({ isAdjustment: true }), false);
  });
});

describe('ledger rows that belong to a record', () => {
  const restores: (() => void)[] = [];
  const stub = (t: object, k: string, fn: unknown) => {
    const o = t as Record<string, unknown>;
    const orig = o[k];
    o[k] = fn;
    restores.push(() => (o[k] = orig));
  };
  afterEach(() => restores.splice(0).reverse().forEach((r) => r()));

  const me = id();
  const biz = id();
  const run = (handler: any, body: unknown = {}) =>
    new Promise<unknown>((resolve) => {
      const res: any = { status: () => res, json: (b: unknown) => resolve({ ok: b }) };
      handler({ user: { _id: me }, params: { id: String(id()) }, body, query: {} }, res, resolve);
    });

  for (const [label, doc] of [
    ['a sale', { source: { type: 'sale', id: id() } }],
    ['a customer payment', { source: { type: 'payment', id: id() } }],
    ['the opening balance', { isAdjustment: true }],
  ] as const) {
    it(`refuses to edit or delete the entry of ${label}`, async () => {
      stub(BusinessMembersModel, 'findOne', () => Promise.resolve({ role: 'owner', status: true }));
      stub(Transaction, 'findById', () => Promise.resolve({ business: biz, createdBy: me, ...doc }));
      for (const handler of [transactionController.updateTransaction, transactionController.deleteTransaction]) {
        const err = await run(handler, { amount: 1 });
        assert.ok(err instanceof ApiError && err.statusCode === 400, String(err));
      }
    });
  }
});
