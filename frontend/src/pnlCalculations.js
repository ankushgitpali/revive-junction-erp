function finiteAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function amountInCents(value) {
  const amount = finiteAmount(value);
  return amount === null ? null : Math.round(amount * 100);
}

function sumKnownCosts(record, fields) {
  const values = fields.map(field => finiteAmount(record?.[field]));
  if (values.some(value => value === null)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function resolveSaleCost(sale, relatedItem = {}) {
  const snapshot = finiteAmount(sale.total_cost_snapshot);
  if (snapshot !== null) return { amount: snapshot, source: 'snapshot' };

  for (const field of ['buying_price', 'cost_price', 'purchase_price']) {
    const amount = finiteAmount(sale[field]);
    if (amount !== null) return { amount, source: 'legacy-sale' };
  }

  for (const field of ['buying_price', 'cost_price']) {
    const amount = finiteAmount(relatedItem[field]);
    if (amount !== null) return { amount, source: 'legacy-linked-record' };
  }

  const currentPhoneCost = sumKnownCosts(relatedItem, ['purchase_price', 'repair_cost', 'other_cost']);
  if (currentPhoneCost !== null) return { amount: currentPhoneCost, source: 'current-phone-estimate' };

  const linkedPurchaseCost = finiteAmount(relatedItem.purchase_price);
  if (linkedPurchaseCost !== null) return { amount: linkedPurchaseCost, source: 'legacy-linked-record' };

  return { amount: null, source: 'unavailable' };
}

export function buildSaleAccountingEvents(sales, returns, phonesById, matchesDate = () => true) {
  const salesById = new Map(sales.map(sale => [sale.id, sale]));
  const events = [];
  const costsBySaleId = new Map();

  for (const sale of sales) {
    const saleDate = sale.sale_date;
    if (!matchesDate(saleDate)) continue;

    const revenueCents = (amountInCents(sale.selling_price ?? sale.price) || 0)
      - (amountInCents(sale.discount) || 0);
    const phone = sale.phones || phonesById.get(sale.phone_id) || {};
    const cost = resolveSaleCost(sale, phone);
    const costCents = amountInCents(cost.amount);
    const grossProfitCents = costCents === null ? null : revenueCents - costCents;

    costsBySaleId.set(sale.id, cost);
    events.push({
      kind: 'sale',
      sale,
      date: saleDate,
      revenueCents,
      grossProfitCents,
      costSource: cost.source,
      priceCents: revenueCents,
    });
  }

  for (const saleReturn of returns) {
    const sale = salesById.get(saleReturn.sale_id);
    if (!sale || !matchesDate(saleReturn.return_date)) continue;

    const netSaleCents = (amountInCents(sale.selling_price ?? sale.price) || 0)
      - (amountInCents(sale.discount) || 0);
    const phone = sale.phones || phonesById.get(sale.phone_id) || {};
    const cost = costsBySaleId.get(sale.id) || resolveSaleCost(sale, phone);
    const costCents = amountInCents(cost.amount);
    const originalProfitCents = costCents === null ? null : netSaleCents - costCents;

    events.push({
      kind: 'return',
      sale,
      saleReturn,
      date: saleReturn.return_date,
      revenueCents: -netSaleCents,
      grossProfitCents: originalProfitCents === null ? null : -originalProfitCents,
      costSource: cost.source,
      priceCents: netSaleCents,
    });
  }

  return events;
}

export function summarizeSaleAccountingEvents(events) {
  const summary = {
    revenue: 0,
    grossProfit: 0,
    saleCount: 0,
    returnCount: 0,
    estimatedCostSales: 0,
    missingCostSales: 0,
  };
  const estimatedSales = new Set();
  const missingSales = new Set();

  for (const event of events) {
    summary.revenue += event.revenueCents;
    if (event.grossProfitCents !== null) summary.grossProfit += event.grossProfitCents;
    if (event.kind === 'sale') summary.saleCount += 1;
    if (event.kind === 'return') summary.returnCount += 1;
    if (event.costSource === 'current-phone-estimate') estimatedSales.add(event.sale.id);
    if (event.grossProfitCents === null) missingSales.add(event.sale.id);
  }

  summary.revenue /= 100;
  summary.grossProfit /= 100;
  summary.estimatedCostSales = estimatedSales.size;
  summary.missingCostSales = missingSales.size;
  return summary;
}
