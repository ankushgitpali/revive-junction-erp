import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSaleAccountingEvents,
  resolveSaleCost,
  summarizeSaleAccountingEvents,
} from '../src/pnlCalculations.js';

test('sale-time cost snapshot takes precedence over current phone costs', () => {
  assert.deepEqual(
    resolveSaleCost(
      { total_cost_snapshot: '1500', purchase_price: 900 },
      { purchase_price: 900, repair_cost: 300, other_cost: 100 },
    ),
    { amount: 1500, source: 'snapshot' },
  );
});

test('legacy recorded sale cost is retained when no snapshot exists', () => {
  assert.deepEqual(
    resolveSaleCost({ total_cost_snapshot: null, cost_price: '1200' }, { purchase_price: 1500 }),
    { amount: 1200, source: 'legacy-sale' },
  );
});

test('current linked phone cost is explicitly identified as an estimate', () => {
  assert.deepEqual(
    resolveSaleCost(
      { total_cost_snapshot: null },
      { purchase_price: 1000, repair_cost: 300, other_cost: 50 },
    ),
    { amount: 1350, source: 'current-phone-estimate' },
  );
});

test('missing historical cost remains unavailable instead of becoming zero', () => {
  assert.deepEqual(
    resolveSaleCost({ total_cost_snapshot: null }, {}),
    { amount: null, source: 'unavailable' },
  );
});

function fixtureSale(overrides = {}) {
  return {
    id: 'sale-1',
    phone_id: 'phone-1',
    selling_price: 10000,
    discount: 500,
    sale_date: '2026-01-15T10:00:00.000Z',
    total_cost_snapshot: 6000,
    ...overrides,
  };
}

function fixtureReturn(overrides = {}) {
  return {
    sale_id: 'sale-1',
    phone_id: 'phone-1',
    refund_amount: 9500,
    refund_allocations: [{ account: 'Cash', amount: 9500 }],
    return_date: '2026-01-20T10:00:00.000Z',
    ...overrides,
  };
}

const allDates = () => true;

test('a sale and full return in the same month net revenue and gross profit to zero', () => {
  const events = buildSaleAccountingEvents(
    [fixtureSale()],
    [fixtureReturn()],
    new Map(),
    date => date.startsWith('2026-01'),
  );

  assert.deepEqual(summarizeSaleAccountingEvents(events), {
    revenue: 0,
    grossProfit: 0,
    saleCount: 1,
    returnCount: 1,
    estimatedCostSales: 0,
    missingCostSales: 0,
  });
});

test('a later return reverses revenue and gross profit in the return period only', () => {
  const sale = fixtureSale({ sale_date: '2025-12-29T10:00:00.000Z' });
  const saleReturn = fixtureReturn({ return_date: '2026-01-03T10:00:00.000Z' });
  const sales = [sale];
  const returns = [saleReturn];

  const salePeriod = summarizeSaleAccountingEvents(buildSaleAccountingEvents(
    sales, returns, new Map(), date => date.startsWith('2025-12'),
  ));
  const returnPeriod = summarizeSaleAccountingEvents(buildSaleAccountingEvents(
    sales, returns, new Map(), date => date.startsWith('2026-01'),
  ));

  assert.equal(salePeriod.revenue, 9500);
  assert.equal(salePeriod.grossProfit, 3500);
  assert.equal(returnPeriod.revenue, -9500);
  assert.equal(returnPeriod.grossProfit, -3500);
});

test('cash, UPI, and bank refund allocations do not change P&L reversal amounts', () => {
  const sales = [fixtureSale()];
  const returns = ['Cash', 'UPI', 'Bank'].map((account, index) => fixtureReturn({
    return_date: `2026-01-${20 + index}T10:00:00.000Z`,
    refund_allocations: [{ account, amount: 9500 }],
  }));

  for (const saleReturn of returns) {
    const result = summarizeSaleAccountingEvents(buildSaleAccountingEvents(
      sales, [saleReturn], new Map(), allDates,
    ));
    assert.equal(result.revenue, 0);
    assert.equal(result.grossProfit, 0);
  }
});

test('a Due sale with collections reverses full sale revenue, not only its cash refund', () => {
  const sale = fixtureSale({
    selling_price: 10000,
    discount: 0,
    payment_allocations: [
      { account: 'Cash', amount: 4000 },
      { account: 'Due', amount: 6000 },
    ],
  });
  const saleReturn = fixtureReturn({
    refund_amount: 6000,
    refund_allocations: [{ account: 'Cash', amount: 4000 }, { account: 'UPI', amount: 2000 }],
  });
  const events = buildSaleAccountingEvents([sale], [saleReturn], new Map(), allDates);
  const returnEvent = events.find(event => event.kind === 'return');

  assert.equal(returnEvent.revenueCents, -1000000);
  assert.equal(returnEvent.grossProfitCents, -400000);
  assert.equal(saleReturn.refund_amount, 6000);
});

test('return-period gross profit reverses the saved sale-time cost effect', () => {
  const events = buildSaleAccountingEvents(
    [fixtureSale({ total_cost_snapshot: 6250 })],
    [fixtureReturn()],
    new Map(),
    date => date.startsWith('2026-01-20'),
  );

  assert.equal(summarizeSaleAccountingEvents(events).grossProfit, -3250);
});

test('missing snapshots use and label linked current costs as estimates', () => {
  const phoneById = new Map([['phone-1', {
    purchase_price: 5000,
    repair_cost: 500,
    other_cost: 250,
  }]]);
  const events = buildSaleAccountingEvents(
    [fixtureSale({ total_cost_snapshot: null })],
    [fixtureReturn()],
    phoneById,
    allDates,
  );

  assert.deepEqual(summarizeSaleAccountingEvents(events), {
    revenue: 0,
    grossProfit: 0,
    saleCount: 1,
    returnCount: 1,
    estimatedCostSales: 1,
    missingCostSales: 0,
  });
});

test('missing historical costs remain unavailable for both sale and return events', () => {
  const summary = summarizeSaleAccountingEvents(buildSaleAccountingEvents(
    [fixtureSale({ total_cost_snapshot: null })],
    [fixtureReturn()],
    new Map(),
    allDates,
  ));

  assert.equal(summary.revenue, 0);
  assert.equal(summary.grossProfit, 0);
  assert.equal(summary.missingCostSales, 1);
});

test('shared dashboard and P&L sale events produce identical period metrics', () => {
  const sales = [fixtureSale({ sale_date: '2026-01-20T10:00:00.000Z' })];
  const returns = [fixtureReturn()];
  const period = date => date.startsWith('2026-01');
  const dashboardMetrics = summarizeSaleAccountingEvents(buildSaleAccountingEvents(sales, returns, new Map(), period));
  const pnlMetrics = summarizeSaleAccountingEvents(buildSaleAccountingEvents(sales, returns, new Map(), period));

  assert.equal(dashboardMetrics.revenue, pnlMetrics.revenue);
  assert.equal(dashboardMetrics.grossProfit, pnlMetrics.grossProfit);
});

test('financial aggregation rounds inputs to cents to avoid floating-point drift', () => {
  const events = buildSaleAccountingEvents(
    [fixtureSale({ selling_price: 0.3, discount: 0.1, total_cost_snapshot: 0.1 })],
    [],
    new Map(),
    allDates,
  );

  assert.equal(summarizeSaleAccountingEvents(events).revenue, 0.2);
  assert.equal(summarizeSaleAccountingEvents(events).grossProfit, 0.1);
});
