import {
  buildSaleAccountingEvents,
  summarizeSaleAccountingEvents,
} from './pnlCalculations.js';

export function summarizeAiSales(sales, returns, phonesById, matchesMonth) {
  const events = buildSaleAccountingEvents(sales, returns, phonesById);
  const monthEvents = events.filter(event => matchesMonth(event.date));
  const brandProfit = new Map();

  for (const event of events) {
    if (event.grossProfitCents === null) continue;
    const brand = event.sale.phones?.brand
      || phonesById.get(event.sale.phone_id)?.brand
      || 'Unknown brand';
    brandProfit.set(brand, (brandProfit.get(brand) || 0) + event.grossProfitCents / 100);
  }

  return {
    totals: summarizeSaleAccountingEvents(events),
    monthTotals: summarizeSaleAccountingEvents(monthEvents),
    activeSaleCount: sales.filter(sale => !sale.returned_at).length,
    brandProfit,
  };
}
