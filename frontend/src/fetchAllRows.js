const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllRows(createQuery, pageSize = DEFAULT_PAGE_SIZE) {
  if (typeof createQuery !== 'function') {
    throw new TypeError('A query factory is required to fetch paginated rows.');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError('Page size must be a positive safe integer.');
  }

  const rows = [];
  let expectedCount;
  let offset = 0;
  let lastResult;

  while (expectedCount === undefined || rows.length < expectedCount) {
    const result = await createQuery().range(offset, offset + pageSize - 1);
    if (result.error) throw result.error;
    if (!Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error('The query did not return a verifiable exact row count.');
    }
    if (expectedCount !== undefined && result.count !== expectedCount) {
      throw new Error('The exact row count changed while the result was being paginated.');
    }
    expectedCount = result.count;
    lastResult = result;

    const page = result.data;
    if (!Array.isArray(page)) {
      throw new Error('The paginated query did not return a row array.');
    }
    if (rows.length + page.length > expectedCount) {
      throw new Error('The paginated result contains more rows than its exact count.');
    }
    const expectedPageLength = Math.min(pageSize, expectedCount - offset);
    if (page.length !== expectedPageLength) {
      throw new Error(`The query returned ${rows.length + page.length} of ${expectedCount} rows.`);
    }
    rows.push(...page);
    if (rows.length === expectedCount) break;
    offset += pageSize;
  }

  return { ...lastResult, data: rows, count: expectedCount };
}
