import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesPnlPeriod, pnlPeriodLabel } from '../src/pnlDateFilters.js';
import {
  buildSaleAccountingEvents,
  summarizeSaleAccountingEvents,
} from '../src/pnlCalculations.js';

test('Last 3 Months includes the full current month, including a later time today', () => {
  const now = new Date(2026, 9, 10, 6, 48);
  const saleDate = new Date(2026, 9, 10, 18, 30).toISOString();

  assert.equal(matchesPnlPeriod(saleDate, 'current_month', now), true);
  assert.equal(matchesPnlPeriod(saleDate, 'last_3', now), true);
  assert.equal(matchesPnlPeriod(saleDate, 'last_6', now), true);
  assert.equal(matchesPnlPeriod(saleDate, 'full_year', now), true);
});

test('expanding a selected period to Last 3 or Last 6 Months preserves current-month sale events', () => {
  const now = new Date(2026, 9, 10, 6, 48);
  const sales = [
    { id: 'oct-sale', phone_id: 'phone-1', selling_price: 33700, discount: 0, sale_date: new Date(2026, 9, 10, 18, 30).toISOString(), total_cost_snapshot: 8500 },
    { id: 'sep-sale', phone_id: 'phone-2', selling_price: 20000, discount: 0, sale_date: new Date(2026, 8, 30, 23, 59).toISOString(), total_cost_snapshot: 10000 },
  ];
  const matches = period => date => matchesPnlPeriod(date, period, now);
  const currentMonth = buildSaleAccountingEvents(sales, [], new Map(), matches('current_month'));
  const lastThree = buildSaleAccountingEvents(sales, [], new Map(), matches('last_3'));
  const lastSix = buildSaleAccountingEvents(sales, [], new Map(), matches('last_6'));
  const includedLastThree = new Set(lastThree.map(event => event.sale.id));
  const includedLastSix = new Set(lastSix.map(event => event.sale.id));

  for (const event of currentMonth) {
    assert.equal(includedLastThree.has(event.sale.id), true);
    assert.equal(includedLastSix.has(event.sale.id), true);
  }
  assert.equal(summarizeSaleAccountingEvents(currentMonth).revenue, 33700);
  assert.equal(summarizeSaleAccountingEvents(lastThree).revenue, 53700);
});

test('period ranges use calendar-month boundaries across month and year transitions', () => {
  const januaryNow = new Date(2027, 0, 1, 8);
  assert.equal(matchesPnlPeriod('2026-12-31', 'last_month', januaryNow), true);
  assert.equal(matchesPnlPeriod('2026-11-30', 'last_3', januaryNow), true);
  assert.equal(matchesPnlPeriod('2026-10-31', 'last_3', januaryNow), false);
  assert.equal(matchesPnlPeriod('2026-08-31', 'last_6', januaryNow), true);
  assert.equal(matchesPnlPeriod('2026-07-31', 'last_6', januaryNow), false);
  assert.equal(matchesPnlPeriod('2027-12-31', 'full_year', januaryNow), true);
  assert.equal(matchesPnlPeriod('2026-12-31', 'full_year', januaryNow), false);

  const decemberThirtyFirst = new Date(2026, 11, 31, 12);
  assert.equal(matchesPnlPeriod('2026-10-31', 'last_3', decemberThirtyFirst), true);
});

test('date-only sales are interpreted as local calendar dates rather than UTC timestamps', () => {
  const now = new Date(2026, 9, 10, 23, 45);
  assert.equal(matchesPnlPeriod('2026-10-10', 'current_month', now), true);
  assert.equal(matchesPnlPeriod('2026-10-10', 'last_3', now), true);
  assert.equal(matchesPnlPeriod('2026-02-30', 'last_3', now), false);
});

test('Recent Sales period label names the complete selected period', () => {
  assert.equal(pnlPeriodLabel('last_3'), 'Last 3 Months');
  assert.equal(pnlPeriodLabel('last_6'), 'Last 6 Months');
});
