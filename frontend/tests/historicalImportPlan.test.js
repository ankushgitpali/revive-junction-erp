import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getHistoricalImportOperations,
  getProjectRef,
  HISTORICAL_IMPORT_PROJECT_REF,
  historicalPhoneImports,
  isMatchingImportPhone,
  isMatchingImportSale,
  verifyImportSaleState,
} from '../src/historicalImportPlan.js';

test('the October import previews five purchase-first pairs with unique stable request IDs', () => {
  const operations = getHistoricalImportOperations();
  assert.equal(operations.length, 10);
  for (let index = 0; index < historicalPhoneImports.length; index += 1) {
    assert.equal(operations[index * 2].kind, 'Purchase');
    assert.equal(operations[index * 2 + 1].kind, 'Sale');
    assert.equal(operations[index * 2].record.key, operations[index * 2 + 1].record.key);
  }
  const requestIds = historicalPhoneImports.flatMap(record => [record.purchaseRequestId, record.saleRequestId]);
  assert.equal(new Set(requestIds).size, 10);
  assert.ok(requestIds.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)));
});

test('the import data preserves estimates, cash terms, blank IMEIs and special repair costs', () => {
  assert.deepEqual(historicalPhoneImports.map(record => [record.stockCode, record.purchasePrice, record.repairCost, record.otherCost, record.sellingPrice]), [
    ['RJ-OCT26-001', 1700, 0, 0, 4700],
    ['RJ-OCT26-002', 13500, 0, 0, 16400],
    ['RJ-OCT26-003', 3000, 0, 0, 6400],
    ['RJ-OCT26-004', 6300, 0, 0, 11000],
    ['RJ-OCT26-005', 20000, 2500, 0, 33700],
  ]);
  assert.ok(historicalPhoneImports.every(record => (
    record.notes.includes('Estimated historical entry')
    && record.notes.includes('placeholder requiring verification')
    && record.imei1 === null
    && record.imei2 === null
    && record.purchaseDate.endsWith('Z')
    && record.saleDate.endsWith('Z')
  )));
});

test('the project reference guard accepts only standard Supabase project URLs', () => {
  assert.equal(getProjectRef(`https://${HISTORICAL_IMPORT_PROJECT_REF}.supabase.co`), HISTORICAL_IMPORT_PROJECT_REF);
  assert.equal(getProjectRef('https://example.com'), null);
  assert.equal(getProjectRef('not a URL'), null);
});

function savedPhone(record, status) {
  return {
    id: 'phone-id',
    client_request_id: record.purchaseRequestId,
    stock_code: record.stockCode,
    brand: record.brand,
    model: record.model,
    variant: record.variant,
    storage: record.storage,
    ram: record.ram,
    imei_1: null,
    imei_2: null,
    purchase_price: record.purchasePrice,
    repair_cost: record.repairCost,
    other_cost: record.otherCost,
    expected_selling_price: record.expectedSellingPrice,
    purchase_date: record.purchaseDate,
    notes: record.notes,
    status,
    purchase_payment_allocations: [{
      account: 'Cash',
      amount: record.purchasePrice + record.repairCost + record.otherCost,
    }],
  };
}

function savedSale(record, phoneId = 'phone-id') {
  return {
    id: 'sale-id',
    client_request_id: record.saleRequestId,
    phone_id: phoneId,
    selling_price: record.sellingPrice,
    discount: record.discount,
    payment_mode: 'Cash',
    sale_date: record.saleDate,
    notes: record.notes,
    returned_at: null,
    payment_allocations: [{ account: 'Cash', amount: record.sellingPrice - record.discount }],
  };
}

test('historical import verification requires the phone to be Sold after a matching sale', () => {
  const record = historicalPhoneImports[0];
  const sale = savedSale(record);

  assert.equal(isMatchingImportPhone(savedPhone(record, 'Sold'), record, 'Sold'), true);
  assert.equal(isMatchingImportSale(sale, record, 'phone-id'), true);
  assert.deepEqual(verifyImportSaleState(sale, savedPhone(record, 'Sold'), record), {
    verified: true,
    reason: '',
  });
  assert.equal(verifyImportSaleState(sale, savedPhone(record, 'Available'), record).verified, false);
});

test('historical import verification rejects a returned sale or a sale for another phone', () => {
  const record = historicalPhoneImports[0];
  const phone = savedPhone(record, 'Sold');

  assert.equal(verifyImportSaleState({ ...savedSale(record), returned_at: '2026-10-11T00:00:00Z' }, phone, record).verified, false);
  assert.equal(verifyImportSaleState(savedSale(record, 'another-phone'), phone, record).verified, false);
});
