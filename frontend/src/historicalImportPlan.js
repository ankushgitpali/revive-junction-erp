const estimatedEntryNote = 'Estimated historical entry; purchase/sale dates are estimates, not verified actual dates. IMEI is a placeholder requiring verification; IMEI fields intentionally left blank.';

export const HISTORICAL_IMPORT_PROJECT_REF = 'vekpfvcbvzgxjhyhdzbd';

export const historicalPhoneImports = [
  {
    key: 'tecno-4g',
    stockCode: 'RJ-OCT26-001',
    brand: 'Tecno',
    model: '4G',
    variant: null,
    storage: null,
    ram: null,
    imei1: null,
    imei2: null,
    purchaseDate: '2026-10-01T12:00:00.000Z',
    purchasePrice: 1700,
    repairCost: 0,
    otherCost: 0,
    expectedSellingPrice: 4700,
    saleDate: '2026-10-04T12:00:00.000Z',
    sellingPrice: 4700,
    discount: 0,
    notes: estimatedEntryNote,
    purchaseRequestId: 'c943c2a5-d981-4f63-9011-000000000001',
    saleRequestId: 'c943c2a5-d981-4f63-9011-000000000101',
  },
  {
    key: 'iqoo-z6s',
    stockCode: 'RJ-OCT26-002',
    brand: 'iQOO',
    model: 'Z6s',
    variant: null,
    storage: null,
    ram: null,
    imei1: null,
    imei2: null,
    purchaseDate: '2026-10-02T12:00:00.000Z',
    purchasePrice: 13500,
    repairCost: 0,
    otherCost: 0,
    expectedSellingPrice: 16400,
    saleDate: '2026-10-06T12:00:00.000Z',
    sellingPrice: 16400,
    discount: 0,
    notes: estimatedEntryNote,
    purchaseRequestId: 'c943c2a5-d981-4f63-9011-000000000002',
    saleRequestId: 'c943c2a5-d981-4f63-9011-000000000102',
  },
  {
    key: 'oppo-4g',
    stockCode: 'RJ-OCT26-003',
    brand: 'OPPO',
    model: '4G',
    variant: null,
    storage: null,
    ram: null,
    imei1: null,
    imei2: null,
    purchaseDate: '2026-10-03T12:00:00.000Z',
    purchasePrice: 3000,
    repairCost: 0,
    otherCost: 0,
    expectedSellingPrice: 6400,
    saleDate: '2026-10-07T12:00:00.000Z',
    sellingPrice: 6400,
    discount: 0,
    notes: estimatedEntryNote,
    purchaseRequestId: 'c943c2a5-d981-4f63-9011-000000000003',
    saleRequestId: 'c943c2a5-d981-4f63-9011-000000000103',
  },
  {
    key: 'oneplus-nord-ce-2-lite',
    stockCode: 'RJ-OCT26-004',
    brand: 'OnePlus',
    model: 'Nord CE 2 Lite 5G',
    variant: '6/128GB',
    storage: '128GB',
    ram: '6GB',
    imei1: null,
    imei2: null,
    purchaseDate: '2026-10-04T12:00:00.000Z',
    purchasePrice: 6300,
    repairCost: 0,
    otherCost: 0,
    expectedSellingPrice: 11000,
    saleDate: '2026-10-08T12:00:00.000Z',
    sellingPrice: 11000,
    discount: 0,
    notes: estimatedEntryNote,
    purchaseRequestId: 'c943c2a5-d981-4f63-9011-000000000004',
    saleRequestId: 'c943c2a5-d981-4f63-9011-000000000104',
  },
  {
    key: 'samsung-s22-ultra',
    stockCode: 'RJ-OCT26-005',
    brand: 'Samsung',
    model: 'S22 Ultra',
    variant: '12/256GB',
    storage: '256GB',
    ram: '12GB',
    imei1: null,
    imei2: null,
    purchaseDate: '2026-10-06T12:00:00.000Z',
    purchasePrice: 20000,
    repairCost: 2500,
    otherCost: 0,
    expectedSellingPrice: 33700,
    saleDate: '2026-10-10T12:00:00.000Z',
    sellingPrice: 33700,
    discount: 0,
    notes: estimatedEntryNote,
    purchaseRequestId: 'c943c2a5-d981-4f63-9011-000000000005',
    saleRequestId: 'c943c2a5-d981-4f63-9011-000000000105',
  },
];

export function getHistoricalImportOperations(records = historicalPhoneImports) {
  return records.flatMap(record => [
    { key: `${record.key}:purchase`, kind: 'Purchase', record },
    { key: `${record.key}:sale`, kind: 'Sale', record },
  ]);
}

export function getProjectRef(supabaseUrl) {
  try {
    const url = new URL(supabaseUrl);
    const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function sameIsoDate(actual, expected) {
  return typeof actual === 'string' && actual.slice(0, 10) === expected.slice(0, 10);
}

export function isMatchingImportPhone(phone, record, expectedStatus = null) {
  return phone?.client_request_id === record.purchaseRequestId
    && phone?.stock_code === record.stockCode
    && phone?.brand === record.brand
    && phone?.model === record.model
    && phone?.variant === record.variant
    && phone?.storage === record.storage
    && phone?.ram === record.ram
    && phone?.imei_1 == null
    && phone?.imei_2 == null
    && Number(phone?.purchase_price) === record.purchasePrice
    && Number(phone?.repair_cost) === record.repairCost
    && Number(phone?.other_cost) === record.otherCost
    && Number(phone?.expected_selling_price) === record.expectedSellingPrice
    && sameIsoDate(phone?.purchase_date, record.purchaseDate)
    && phone?.notes === record.notes
    && (!expectedStatus || phone?.status === expectedStatus)
    && Array.isArray(phone?.purchase_payment_allocations)
    && phone.purchase_payment_allocations.length === 1
    && phone.purchase_payment_allocations[0]?.account === 'Cash'
    && Number(phone.purchase_payment_allocations[0]?.amount)
      === record.purchasePrice + record.repairCost + record.otherCost;
}

export function isMatchingImportSale(sale, record, phoneId) {
  return sale?.client_request_id === record.saleRequestId
    && sale?.phone_id === phoneId
    && Number(sale?.selling_price) === record.sellingPrice
    && Number(sale?.discount) === record.discount
    && sale?.payment_mode === 'Cash'
    && sameIsoDate(sale?.sale_date, record.saleDate)
    && sale?.notes === record.notes
    && sale?.returned_at == null
    && Array.isArray(sale?.payment_allocations)
    && sale.payment_allocations.length === 1
    && sale.payment_allocations[0]?.account === 'Cash'
    && Number(sale.payment_allocations[0]?.amount) === record.sellingPrice - record.discount;
}

export function verifyImportSaleState(sale, phone, record) {
  if (!isMatchingImportSale(sale, record, phone?.id)) {
    return { verified: false, reason: 'The saved sale does not match the planned purchase, request ID, and amounts.' };
  }
  if (phone.status !== 'Sold') {
    return { verified: false, reason: `The matching sale exists, but its phone status is "${phone.status || 'unknown'}" instead of "Sold".` };
  }
  return { verified: true, reason: '' };
}
