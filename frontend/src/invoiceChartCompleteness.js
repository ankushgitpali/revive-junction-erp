export function isInvoiceChartDataComplete({
  salesCount,
  salesLoaded,
  returnsCount,
  returnsLoaded,
}) {
  return Number.isInteger(salesCount)
    && Number.isInteger(returnsCount)
    && salesCount === salesLoaded
    && returnsCount === returnsLoaded;
}
