import test from 'node:test';
import assert from 'node:assert/strict';
import { clearRequestToken, getRequestToken } from '../src/requestTokens.js';

test('an unchanged transaction retry reuses its request ID and timestamp', async () => {
  const reference = { current: null };
  const first = await getRequestToken(reference, { amount: 1200, account: 'Cash' });
  const retry = await getRequestToken(reference, { amount: 1200, account: 'Cash' });

  assert.equal(retry.id, first.id);
  assert.equal(retry.createdAt, first.createdAt);
});

test('editing transaction details creates a different request ID', async () => {
  const reference = { current: null };
  const first = await getRequestToken(reference, { amount: 1200, account: 'Cash' });
  const edited = await getRequestToken(reference, { amount: 1200, account: 'UPI' });

  assert.notEqual(edited.id, first.id);
  assert.match(edited.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('successful completion clears the pending request token', async () => {
  const reference = { current: null };
  const first = await getRequestToken(reference, { amount: 1200 });
  clearRequestToken(reference);
  const next = await getRequestToken(reference, { amount: 1200 });

  assert.notEqual(next.id, first.id);
});

test('a request retry after page state is lost reuses its stored ID without storing the payload', async () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  try {
    const payload = { amount: 1200, account: 'Cash', customer: 'Private customer name' };
    const first = await getRequestToken({ current: null }, payload, 'sale');
    const retry = await getRequestToken({ current: null }, payload, 'sale');

    assert.equal(retry.id, first.id);
    assert.equal(retry.createdAt, first.createdAt);
    assert.equal([...values.values()].some(value => value.includes('Private customer name')), false);
    const reference = { current: retry };
    clearRequestToken(reference);
    assert.equal(values.size, 0);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});
