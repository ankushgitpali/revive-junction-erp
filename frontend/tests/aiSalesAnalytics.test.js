import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAiSales } from '../src/aiSalesAnalytics.js';
import {
  buildSaleAccountingEvents,
  summarizeSaleAccountingEvents,
} from '../src/pnlCalculations.js';

const sale = overrides => ({
  id: 'sale-1',
  phone_id: 'phone-1',
  selling_price: 10000,
  discount: 500,
  sale_date: '2026-09-29T10:00:00.000Z',
  total_cost_snapshot: 6000,
  ...overrides,
});

const saleReturn = overrides => ({
  sale_id: 'sale-1',
  return_date: '2026-10-02T10:00:00.000Z',
  refund_amount: 9500,
  refund_allocations: [{ account: 'Cash', amount: 9500 }],
  ...overrides,
});

const isOctober = value => {
  const date = new Date(value);
  return date.getFullYear() === 2026 && date.getMonth() === 9;
};

test('AI totals net a same-period full return using shared accounting events', () => {
  const sales = [sale({ sale_date: '2026-10-01T10:00:00.000Z' })];
  const returns = [saleReturn({ return_date: '2026-10-02T10:00:00.000Z' })];
  const ai = summarizeAiSales(sales, returns, new Map(), isOctober);
  const shared = summarizeSaleAccountingEvents(
    buildSaleAccountingEvents(sales, returns, new Map(), isOctober),
  );

  assert.equal(ai.monthTotals.revenue, 0);
  assert.equal(ai.monthTotals.grossProfit, 0);
  assert.deepEqual(ai.monthTotals, shared);
});

test('AI totals reverse a full return in the actual cross-period return month', () => {
  const sales = [sale()];
  const returns = [saleReturn()];
  const ai = summarizeAiSales(sales, returns, new Map(), isOctober);
  const returnPeriod = summarizeSaleAccountingEvents(
    buildSaleAccountingEvents(sales, returns, new Map(), isOctober),
  );

  assert.equal(ai.totals.revenue, 0);
  assert.equal(ai.totals.grossProfit, 0);
  assert.equal(ai.monthTotals.revenue, -9500);
  assert.equal(ai.monthTotals.grossProfit, -3500);
  assert.deepEqual(ai.monthTotals, returnPeriod);
});

test('AI leaves gross profit unavailable when historical cost is missing', () => {
  const ai = summarizeAiSales(
    [sale({ total_cost_snapshot: null })],
    [saleReturn()],
    new Map(),
    isOctober,
  );

  assert.equal(ai.monthTotals.revenue, -9500);
  assert.equal(ai.monthTotals.grossProfit, 0);
  assert.equal(ai.monthTotals.missingCostSales, 1);
});
