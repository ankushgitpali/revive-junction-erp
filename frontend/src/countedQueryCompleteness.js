export function areCountedQueryResultsComplete(results) {
  return results.every(result => !result.error
    && Array.isArray(result.data)
    && Number.isInteger(result.count)
    && result.count === result.data.length);
}
