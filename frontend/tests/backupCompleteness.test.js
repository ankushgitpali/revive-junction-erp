import test from 'node:test';
import assert from 'node:assert/strict';
import { areBackupResultsComplete } from '../src/backupCompleteness.js';

test('backup results are complete only when exact counts match every fetched dataset', () => {
  assert.equal(areBackupResultsComplete([
    { data: [{ id: 1 }], count: 1, error: null },
    { data: [], count: 0, error: null },
  ]), true);
});

test('backup rejects truncated rows, missing counts, and query errors', () => {
  assert.equal(areBackupResultsComplete([{ data: Array(1000), count: 1001, error: null }]), false);
  assert.equal(areBackupResultsComplete([{ data: [], count: null, error: null }]), false);
  assert.equal(areBackupResultsComplete([{ data: [], count: 0, error: new Error('failed') }]), false);
});
