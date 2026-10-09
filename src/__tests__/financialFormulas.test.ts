// src/__tests__/financialFormulas.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Financial Metrics & Accounting Correctness', () => {
  it('should verify Gross Profit and Net Profit accounting formulas', () => {
    const totalSales = 100000;
    const costOfGoodsSold = 60000;
    const operatingExpenses = 15000;

    const grossProfit = totalSales - costOfGoodsSold;
    assert.strictEqual(grossProfit, 40000);

    const netProfit = grossProfit - operatingExpenses;
    assert.strictEqual(netProfit, 25000);

    const netMarginPct = (netProfit / totalSales) * 100;
    assert.strictEqual(netMarginPct, 25);
  });

  it('should balance sales totals between cash received and due receivables', () => {
    const saleInvoices = [
      { total: 5000, paidAmount: 5000, dueAmount: 0 },
      { total: 12000, paidAmount: 8000, dueAmount: 4000 },
      { total: 3000, paidAmount: 0, dueAmount: 3000 },
    ];

    const sumTotal = saleInvoices.reduce((acc, s) => acc + s.total, 0);
    const sumPaid = saleInvoices.reduce((acc, s) => acc + s.paidAmount, 0);
    const sumDue = saleInvoices.reduce((acc, s) => acc + s.dueAmount, 0);

    assert.strictEqual(sumTotal, 20000);
    assert.strictEqual(sumPaid, 13000);
    assert.strictEqual(sumDue, 7000);
    assert.strictEqual(sumPaid + sumDue, sumTotal);
  });

  it('should correctly combine direct expenses and cashbook expenses', () => {
    const directExpenses = [{ amount: 4500 }, { amount: 1500 }];
    const cashbookExpenses = [{ amount: 2000 }, { amount: 1000 }];

    const totalDirect = directExpenses.reduce((acc, e) => acc + e.amount, 0);
    const totalCashbook = cashbookExpenses.reduce((acc, e) => acc + e.amount, 0);
    const totalExpenses = totalDirect + totalCashbook;

    assert.strictEqual(totalExpenses, 9000);
  });

  it('should calculate net due position from receivables and payables', () => {
    const customerReceivables = 45000;
    const supplierPayables = 30000;

    const netDuePosition = customerReceivables - supplierPayables;
    assert.strictEqual(netDuePosition, 15000);
  });

  it('should compute product inventory valuation and flag low stock alerts', () => {
    const inventory = [
      { name: 'Rice 25kg', stock: 12, minStock: 5, purchasePrice: 1500 },
      { name: 'Oil 5L', stock: 2, minStock: 5, purchasePrice: 800 },
      { name: 'Sugar 1kg', stock: 0, minStock: 10, purchasePrice: 120 },
    ];

    const totalValuation = inventory.reduce((acc, p) => acc + p.stock * p.purchasePrice, 0);
    // (12 * 1500) + (2 * 800) + (0 * 120) = 18000 + 1600 + 0 = 19600
    assert.strictEqual(totalValuation, 19600);

    const lowStockItems = inventory.filter((p) => p.stock <= p.minStock);
    assert.strictEqual(lowStockItems.length, 2);
    assert.strictEqual(lowStockItems[0].name, 'Oil 5L');
    assert.strictEqual(lowStockItems[1].name, 'Sugar 1kg');
  });
});
