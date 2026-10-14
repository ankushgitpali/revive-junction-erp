import test from 'node:test';
import assert from 'node:assert/strict';
import { dateWindow, localDateString } from '../src/cashbookDates.js';

test('cashbook custom ranges reject a reversed range', () => {
  assert.throws(
    () => dateWindow('custom', '2026-10-11', '2026-10-10'),
    /Start date must be on or before the end date/,
  );
});

test('cashbook custom range includes the complete selected end date', () => {
  const range = dateWindow('custom', '2026-10-10', '2026-10-10');
  assert.ok(new Date(range.start) < new Date(range.end));
  assert.equal(localDateString(new Date(range.start)), '2026-10-10');
  const end = new Date(range.end);
  end.setDate(end.getDate() - 1);
  assert.equal(localDateString(end), '2026-10-10');
});

test('cashbook custom range rejects missing or malformed dates', () => {
  assert.equal(dateWindow('custom', '', '2026-10-10'), null);
  assert.equal(dateWindow('custom', '2026/10/10', '2026-10-10'), null);
});

test('cashbook custom ranges reject impossible calendar dates and accept leap days', () => {
  assert.throws(
    () => dateWindow('custom', '2026-02-30', '2026-03-01'),
    /valid calendar dates/,
  );
  assert.throws(
    () => dateWindow('custom', '2025-02-29', '2025-03-01'),
    /valid calendar dates/,
  );
  assert.ok(dateWindow('custom', '2024-02-29', '2024-02-29'));
});

test('cashbook today filter and default-date formatting use the same local date', () => {
  const now = new Date(2026, 9, 10, 23, 45);
  const range = dateWindow('today', '', '', now);
  assert.equal(localDateString(now), '2026-10-10');
  assert.equal(localDateString(new Date(range.start)), '2026-10-10');
});

test('cashbook date ranges handle month and year boundaries', () => {
  const january = dateWindow('month', '', '', new Date(2026, 0, 1, 12));
  assert.equal(localDateString(new Date(january.start)), '2026-01-01');

  const newYearEve = dateWindow('yesterday', '', '', new Date(2027, 0, 1, 12));
  assert.equal(localDateString(new Date(newYearEve.start)), '2026-12-31');
  const end = new Date(newYearEve.end);
  end.setDate(end.getDate() - 1);
  assert.equal(localDateString(end), '2026-12-31');
});
