import test from 'node:test';
import assert from 'node:assert/strict';
import { withLoadingState } from '../src/authLoading.js';

test('auth loading state resets after a resolved authentication error', async () => {
  const states = [];
  const result = await withLoadingState(value => states.push(value), async () => ({
    data: null,
    error: { message: 'Invalid login credentials' },
  }));

  assert.deepEqual(states, [true, false]);
  assert.equal(result.error.message, 'Invalid login credentials');
});

test('auth loading state resets when the request rejects', async () => {
  const states = [];
  await assert.rejects(
    withLoadingState(value => states.push(value), async () => {
      throw new Error('network unavailable');
    }),
    /network unavailable/,
  );
  assert.deepEqual(states, [true, false]);
});
