import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectFile = path => new URL(`../src/${path}`, import.meta.url);

test('missing Supabase configuration is handled before authenticated modules render', async () => {
  const [client, app] = await Promise.all([
    readFile(projectFile('supabase.js'), 'utf8'),
    readFile(projectFile('App.jsx'), 'utf8'),
  ]);

  assert.match(client, /export const isSupabaseConfigured/);
  assert.match(client, /isSupabaseConfigured\s*\?\s*createClient/);
  assert.match(app, /if \(!isSupabaseConfigured \|\| !supabase\)/);
  assert.match(app, /No credentials are displayed here/);
});

test('login does not expose public self-signup for unrestricted authenticated shop policies', async () => {
  const login = await readFile(projectFile('Login.jsx'), 'utf8');

  assert.match(login, /signInWithPassword/);
  assert.doesNotMatch(login, /auth\.signUp/);
  assert.match(login, /Access is provisioned by the shop administrator/);
});

test('business totals and backup/export surfaces use exact-count pagination', async () => {
  const files = ['Dashboard.jsx', 'PnL.jsx', 'AIAssistant.jsx', 'Invoices.jsx', 'Settings.jsx'];
  const sources = await Promise.all(files.map(file => readFile(projectFile(file), 'utf8')));

  for (let index = 0; index < files.length; index += 1) {
    assert.match(sources[index], /fetchAllRows/);
  }
  assert.doesNotMatch(sources[0], /\.limit\(1000\)/);
  assert.doesNotMatch(sources[1], /\.limit\(1000\)/);
  assert.doesNotMatch(sources[2], /\.limit\(rowLimit\)/);
  assert.doesNotMatch(sources[4], /data:text\/json/);
});

test('unused API helpers cannot return fabricated demo totals or hide failed reads as empty results', async () => {
  const api = await readFile(projectFile('api.js'), 'utf8');

  assert.doesNotMatch(api, /250000|cashInHand:\s*50000/);
  assert.match(api, /throw new Error\("Supabase is not configured/);
  assert.match(api, /const result = await fetchAllRows/);
  assert.match(api, /return result\.data/);
});
