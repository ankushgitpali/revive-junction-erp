import test from 'node:test';
import assert from 'node:assert/strict';
import { areCountedQueryResultsComplete } from '../src/countedQueryCompleteness.js';

test('counted query results are complete only when exact counts match loaded rows', () => {
  assert.equal(areCountedQueryResultsComplete([
    { data: [{ id: 1 }], count: 1, error: null },
    { data: [], count: 0, error: null },
  ]), true);
});

test('counted query results reject truncated rows, missing counts, and errors', () => {
  assert.equal(areCountedQueryResultsComplete([
    { data: Array(1000), count: 1001, error: null },
  ]), false);
  assert.equal(areCountedQueryResultsComplete([
    { data: [], count: null, error: null },
  ]), false);
  assert.equal(areCountedQueryResultsComplete([
    { data: [], count: 0, error: new Error('failed') },
  ]), false);
});
