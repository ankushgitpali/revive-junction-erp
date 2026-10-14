import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllRows } from '../src/fetchAllRows.js';

function queryPages(pages) {
  let call = 0;
  return () => ({
    range: async () => pages[call++],
  });
}

test('fetchAllRows combines all pages and preserves the exact count', async () => {
  const result = await fetchAllRows(queryPages([
    { data: [{ id: 1 }, { id: 2 }], count: 3, error: null },
    { data: [{ id: 3 }], count: 3, error: null },
  ]), 2);

  assert.deepEqual(result.data.map(row => row.id), [1, 2, 3]);
  assert.equal(result.count, 3);
});

test('fetchAllRows accepts a verified empty table without requesting another page', async () => {
  const result = await fetchAllRows(queryPages([
    { data: [], count: 0, error: null },
  ]));

  assert.deepEqual(result.data, []);
  assert.equal(result.count, 0);
});

test('fetchAllRows rejects missing counts, query errors, inconsistent counts, and short results', async () => {
  await assert.rejects(
    fetchAllRows(queryPages([{ data: [], count: null, error: null }])),
    /exact row count/,
  );
  await assert.rejects(
    fetchAllRows(queryPages([{ data: null, count: 0, error: new Error('denied') }])),
    /denied/,
  );
  await assert.rejects(
    fetchAllRows(queryPages([
      { data: [{ id: 1 }], count: 2, error: null },
      { data: [{ id: 2 }], count: 3, error: null },
    ]), 1),
    /count changed/,
  );
  await assert.rejects(
    fetchAllRows(queryPages([{ data: [], count: 1, error: null }])),
    /returned 0 of 1 rows/,
  );
  await assert.rejects(
    fetchAllRows(queryPages([{ data: [{ id: 1 }], count: 3, error: null }]), 2),
    /returned 1 of 3 rows/,
  );
});
