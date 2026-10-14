import test from 'node:test';
import assert from 'node:assert/strict';
import { isInvoiceChartDataComplete } from '../src/invoiceChartCompleteness.js';

test('invoice chart is complete when exact sales and return counts match fetched rows', () => {
  assert.equal(isInvoiceChartDataComplete({
    salesCount: 1000,
    salesLoaded: 1000,
    returnsCount: 12,
    returnsLoaded: 12,
  }), true);
});

test('invoice chart is suppressed when either source exceeds the fetched page', () => {
  assert.equal(isInvoiceChartDataComplete({
    salesCount: 1001,
    salesLoaded: 1000,
    returnsCount: 12,
    returnsLoaded: 12,
  }), false);
  assert.equal(isInvoiceChartDataComplete({
    salesCount: 10,
    salesLoaded: 10,
    returnsCount: 1001,
    returnsLoaded: 1000,
  }), false);
});

test('invoice chart is not called complete when an exact count is unavailable', () => {
  assert.equal(isInvoiceChartDataComplete({
    salesCount: null,
    salesLoaded: 0,
    returnsCount: 0,
    returnsLoaded: 0,
  }), false);
});
