import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSessionSync } from '../src/authSessionSync.js';

function createState() {
  return {
    session: null,
    loading: true,
    sync: null,
  };
}

test('late initial session does not overwrite a newer auth event', () => {
  const state = createState();
  state.sync = createAuthSessionSync(
    value => { state.session = value; },
    value => { state.loading = value; },
  );
  const newerSession = { user: { id: 'new-session' } };

  state.sync.applyAuthEvent(newerSession);
  const applied = state.sync.applyInitialSession({ user: { id: 'stale-session' } });

  assert.equal(applied, false);
  assert.equal(state.session, newerSession);
  assert.equal(state.loading, false);
});

test('initial session is applied when no auth event has arrived', () => {
  const state = createState();
  state.sync = createAuthSessionSync(
    value => { state.session = value; },
    value => { state.loading = value; },
  );
  const initialSession = { user: { id: 'initial-session' } };

  assert.equal(state.sync.applyInitialSession(initialSession), true);
  assert.equal(state.session, initialSession);
  assert.equal(state.loading, false);
});

test('disposed session synchronizer ignores late async results', () => {
  const state = createState();
  state.sync = createAuthSessionSync(
    value => { state.session = value; },
    value => { state.loading = value; },
  );
  state.sync.dispose();

  assert.equal(state.sync.applyInitialSession({ user: { id: 'late' } }), false);
  assert.equal(state.session, null);
  assert.equal(state.loading, true);
});
