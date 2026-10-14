import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreMigration = readFileSync(new URL('../supabase/migrations/20261008000100_financial_inventory_core.sql', import.meta.url), 'utf8');
const payloadMigration = readFileSync(new URL('../supabase/migrations/20261010000100_payload_bound_idempotency.sql', import.meta.url), 'utf8');
const returnGuard = readFileSync(new URL('../supabase/patches/20261009000100_return_sale_duplicate_guard.sql', import.meta.url), 'utf8');
const cashLedgerLockdown = readFileSync(new URL('../supabase/patches/20261010000200_cash_ledger_anon_lockdown.sql', import.meta.url), 'utf8');
const inventoryProfitViewLockdown = readFileSync(new URL('../supabase/patches/20261010000300_inventory_profit_view_anon_lockdown.sql', import.meta.url), 'utf8');
const helperExecuteLockdown = readFileSync(new URL('../supabase/patches/20261010000400_rpc_helper_execute_lockdown.sql', import.meta.url), 'utf8');
const expectedPriceValidation = readFileSync(new URL('../supabase/patches/20261010000500_expected_selling_price_validation.sql', import.meta.url), 'utf8');
const stagingAccessHardeningRecord = readFileSync(new URL('../supabase/patches/20261010000700_staging_access_hardening_record.sql', import.meta.url), 'utf8');
const stagingVerification = readFileSync(new URL('../supabase/STAGING_READ_ONLY_VERIFICATION.md', import.meta.url), 'utf8');
const integrationTest = readFileSync(new URL('../supabase/tests/financial_inventory_core.test.sql', import.meta.url), 'utf8');
const frontendWriteCallSites = [
  'AIAssistant.jsx',
  'App.jsx',
  'BuyPhone.jsx',
  'Cashbook.jsx',
  'Customers.jsx',
  'Dashboard.jsx',
  'DataIntegrity.jsx',
  'Expenses.jsx',
  'Invoices.jsx',
  'Login.jsx',
  'OctoberHistoricalImport.jsx',
  'PnL.jsx',
  'Repairs.jsx',
  'SellPhone.jsx',
  'Settings.jsx',
  'Stock.jsx',
  'StockMovements.jsx',
  'Suppliers.jsx',
  'api.js',
].map(file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).join('\n');

const payloadBoundRpcs = [
  'create_phone_purchase_atomic',
  'create_expense_atomic',
  'create_sale_atomic',
  'record_customer_collection',
  'record_supplier_payment',
  'record_internal_transfer',
];

test('core migration preflights required columns, invoice uniqueness, and restrictive policy collisions', () => {
  assert.match(coreMigration, /DO \$schema_preflight\$/);
  assert.match(coreMigration, /expected check constraint public\.%/);
  assert.match(coreMigration, /public\.sales requires a valid unique index on invoice_no/i);
  assert.match(coreMigration, /DO \$policy_preflight\$/);
  assert.match(coreMigration, /RESTRICTIVE/);
  assert.match(coreMigration, /public\.sales/);
  assert.match(coreMigration, /NEW\.expected_selling_price::text IN \('NaN', 'Infinity', '-Infinity'\)/);
  assert.match(coreMigration, /v_expected::text IN \('NaN', 'Infinity', '-Infinity'\)/);
  assert.match(integrationTest, /non-finite expected selling price was accepted/);
  assert.match(integrationTest, /'expected_selling_price', 'NaN'/);
});

test('payload-bound migration checks base RPC contracts and request-ID uniqueness before renaming', () => {
  const preflightEnd = payloadMigration.indexOf('$preflight$;');
  const renameStart = payloadMigration.indexOf('DO $rename_unbound_functions$');
  assert.ok(preflightEnd > 0 && renameStart > preflightEnd, 'all preflight checks must run before legacy RPC renames');
  assert.match(payloadMigration.slice(0, renameStart), /proargnames/);
  assert.match(payloadMigration.slice(0, renameStart), /client_request_id.*uuid/is);
  assert.match(payloadMigration.slice(0, renameStart), /indisunique/);
  assert.match(payloadMigration.slice(0, renameStart), /indisvalid/);
  assert.match(payloadMigration.slice(0, renameStart), /rj_idempotency_requests columns or types are incompatible/);
  assert.match(payloadMigration.slice(0, renameStart), /PRIMARY KEY \(requester_id, operation, request_id\)/);

  for (const rpc of payloadBoundRpcs) {
    assert.match(payloadMigration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}_v2\\b`));
    assert.match(payloadMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}_unbound_legacy\\b`));
    assert.match(payloadMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}_v2\\b`));
  }
  assert.match(payloadMigration, /REVOKE ALL ON FUNCTION public\.rj_claim_idempotency_request/);
  assert.match(payloadMigration, /REVOKE ALL ON FUNCTION public\.rj_store_idempotency_result/);
});

test('return guard validates dependencies and serializes duplicate return attempts', () => {
  assert.match(returnGuard, /^BEGIN;/m);
  assert.match(returnGuard, /DO \$return_guard_preflight\$/);
  assert.match(returnGuard, /requires a single-column unique constraint or index on sale_id/);
  assert.match(returnGuard, /trg_guard_phone_lifecycle_update/);
  assert.match(returnGuard, /expected check constraint public\.%/);
  assert.match(returnGuard, /CREATE OR REPLACE FUNCTION public\.return_sale_atomic/);
  assert.match(returnGuard, /FROM public\.sales WHERE id = p_sale_id FOR UPDATE/);
  assert.match(returnGuard, /v_sale\.returned_at IS NOT NULL/);
  assert.match(returnGuard, /EXISTS \(SELECT 1 FROM public\.sale_returns WHERE sale_id = v_sale\.id\)/);
  assert.match(returnGuard, /REVOKE ALL ON FUNCTION public\.return_sale_atomic\(uuid, text\) FROM PUBLIC, anon/);
  assert.match(returnGuard, /GRANT EXECUTE ON FUNCTION public\.return_sale_atomic\(uuid, text\) TO authenticated/);
  assert.match(returnGuard, /^COMMIT;$/m);
});

test('cash ledger lockdown revokes anonymous access and rejects unexpected public policies', () => {
  assert.match(cashLedgerLockdown, /^BEGIN;$/m);
  assert.match(cashLedgerLockdown, /cash_ledger lockdown stopped: another permissive PUBLIC\/anon policy exists/);
  assert.match(cashLedgerLockdown, /REVOKE ALL PRIVILEGES ON TABLE public\.cash_ledger FROM PUBLIC, anon/);
  assert.match(cashLedgerLockdown, /DROP POLICY IF EXISTS "Allow Public Delete"/);
  assert.match(cashLedgerLockdown, /AS RESTRICTIVE\s+FOR ALL\s+TO anon\s+USING \(false\)\s+WITH CHECK \(false\)/);
  assert.match(cashLedgerLockdown, /has_any_column_privilege\('anon'/);
  assert.match(cashLedgerLockdown, /^COMMIT;$/m);
  assert.match(cashLedgerLockdown, /DO \$preserve_authenticated\$/);
  assert.match(cashLedgerLockdown, /CREATE TEMP TABLE rj_cash_ledger_auth_table_acl_snapshot/);
  assert.match(cashLedgerLockdown, /authenticated relation or column privileges changed/);
  assert.match(cashLedgerLockdown, /GRANT %s ON TABLE public\.cash_ledger TO authenticated/);
});

test('inventory and profit-view lockdown is staging-only, preflighted, and preserves authenticated grants', () => {
  assert.match(inventoryProfitViewLockdown, /^BEGIN;$/m);
  assert.match(inventoryProfitViewLockdown, /public\.inventory is not an RLS-enabled table/);
  assert.match(inventoryProfitViewLockdown, /security-invoker view/);
  assert.match(inventoryProfitViewLockdown, /REVOKE ALL PRIVILEGES ON TABLE public\.inventory, public\.phone_profit_view FROM PUBLIC, anon/);
  assert.match(inventoryProfitViewLockdown, /AS RESTRICTIVE\s+FOR ALL\s+TO anon\s+USING \(false\)\s+WITH CHECK \(false\)/);
  assert.match(inventoryProfitViewLockdown, /has_any_column_privilege\('anon'/);
  assert.match(inventoryProfitViewLockdown, /PUBLIC retains relation or column privileges/);
  assert.match(inventoryProfitViewLockdown, /DO \$preserve_authenticated\$/);
  assert.match(inventoryProfitViewLockdown, /CREATE TEMP TABLE rj_inventory_profit_auth_table_acl_snapshot/);
  assert.match(inventoryProfitViewLockdown, /authenticated relation or column privileges changed/);
  assert.match(inventoryProfitViewLockdown, /GRANT %s ON TABLE public\.%I TO authenticated/);
  assert.match(inventoryProfitViewLockdown, /^COMMIT;$/m);
  assert.doesNotMatch(inventoryProfitViewLockdown, /\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\./i);
  assert.match(inventoryProfitViewLockdown, /GRANT %s ON TABLE public\.%I TO authenticated/);
  assert.match(stagingVerification, /Candidate patches \(not applied\)/);
  assert.match(stagingVerification, /No manual rollback script that re-grants PUBLIC\/anon access is provided/i);
  assert.match(stagingVerification, /Authentication → Settings → User Signups → Allow new users to sign up/);
});

test('payment helper lockdown removes only direct RPC execution and preserves owner-side workflow calls', () => {
  for (const sql of [coreMigration, helperExecuteLockdown]) {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.normalize_payment_allocations\(jsonb, numeric\) FROM PUBLIC, anon/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.payment_mode_for_allocations\(jsonb\) FROM PUBLIC, anon/);
  }
  assert.match(helperExecuteLockdown, /^BEGIN;$/m);
  assert.match(helperExecuteLockdown, /immutable SECURITY INVOKER function/);
  assert.match(helperExecuteLockdown, /has an explicit authenticated grant/);
  assert.match(helperExecuteLockdown, /has_function_privilege\('authenticated'/);
  assert.match(helperExecuteLockdown, /^COMMIT;$/m);
  assert.doesNotMatch(frontendWriteCallSites, /supabase\.rpc\(['"](?:normalize_payment_allocations|payment_mode_for_allocations)['"]/);
  assert.match(stagingVerification, /20261010000400_rpc_helper_execute_lockdown\.sql/);
});

test('RLS event-trigger lockdown revokes only client EXECUTE without changing event registration', () => {
  assert.match(helperExecuteLockdown, /SECURITY INVOKER/);
  const rlsEventTrigger = readFileSync(new URL('../supabase/patches/20261010000600_rls_event_trigger_execute_lockdown.sql', import.meta.url), 'utf8');
  assert.match(rlsEventTrigger, /^BEGIN;$/m);
  assert.match(rlsEventTrigger, /to_regprocedure\('public\.rls_auto_enable\(\)'\)/);
  assert.match(rlsEventTrigger, /pg_event_trigger AS evt/);
  assert.match(rlsEventTrigger, /evt\.evtenabled <> 'D'/);
  assert.match(rlsEventTrigger, /search_path=pg_catalog/);
  assert.match(rlsEventTrigger, /REVOKE ALL ON FUNCTION public\.rls_auto_enable\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(rlsEventTrigger, /has_function_privilege\('authenticated'/);
  assert.doesNotMatch(rlsEventTrigger, /\b(?:ALTER EVENT TRIGGER|DROP EVENT TRIGGER|CREATE EVENT TRIGGER)\b/i);
  assert.match(rlsEventTrigger, /^COMMIT;$/m);
  assert.match(stagingVerification, /registration\/enabled state is separate from client RPC EXECUTE/i);
  assert.match(stagingVerification, /superuser to create an event trigger/i);
});

test('staging hardening record captures exact idempotent policy and privilege revocations', () => {
  assert.match(stagingAccessHardeningRecord, /^BEGIN;$/m);
  for (const table of ['cash_ledger', 'expenses', 'phones', 'sales']) {
    assert.match(
      stagingAccessHardeningRecord,
      new RegExp(`DROP POLICY IF EXISTS "Allow Public Delete" ON public\\.${table};`),
    );
  }
  assert.match(
    stagingAccessHardeningRecord,
    /REVOKE ALL PRIVILEGES ON TABLE\s+public\.cash_ledger,\s+public\.inventory,\s+public\.phone_profit_view\s+FROM anon;/,
  );
  assert.match(
    stagingAccessHardeningRecord,
    /REVOKE ALL PRIVILEGES ON SEQUENCE\s+public\.audit_log_id_seq,\s+public\.sales_invoice_seq\s+FROM anon;/,
  );
  assert.match(
    stagingAccessHardeningRecord,
    /REVOKE UPDATE ON SEQUENCE\s+public\.audit_log_id_seq,\s+public\.sales_invoice_seq\s+FROM authenticated;/,
  );
  assert.match(
    stagingAccessHardeningRecord,
    /REVOKE ALL ON FUNCTION public\.rls_auto_enable\(\)\s+FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(stagingAccessHardeningRecord, /^COMMIT;$/m);
  assert.match(stagingAccessHardeningRecord, /already applied and verified directly\s+-- on RJ-Staging-Test/);
  assert.doesNotMatch(stagingAccessHardeningRecord, /\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\./i);
});

test('expected-price validation is abort-safe and never repairs legacy rows automatically', () => {
  assert.match(expectedPriceValidation, /^BEGIN;$/m);
  assert.match(expectedPriceValidation, /existing rows contain invalid prices/);
  assert.match(expectedPriceValidation, /expected_selling_price must have numeric type/);
  assert.match(expectedPriceValidation, /atttypid = 'numeric'::regtype/);
  assert.match(expectedPriceValidation, /ADD CONSTRAINT phones_expected_selling_price_finite_check/);
  assert.match(expectedPriceValidation, /expected_selling_price::text NOT IN \('NaN', 'Infinity', '-Infinity'\)/);
  assert.match(expectedPriceValidation, /VALIDATE CONSTRAINT phones_expected_selling_price_finite_check/);
  assert.match(expectedPriceValidation, /convalidated/);
  assert.doesNotMatch(expectedPriceValidation, /\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\./i);
  assert.match(expectedPriceValidation, /^COMMIT;$/m);
  assert.match(stagingVerification, /20261010000500_expected_selling_price_validation\.sql/);
});

test('disposable SQL integration test covers idempotent workflows and rolls back its fixtures', () => {
  for (const rpc of payloadBoundRpcs) {
    assert.match(integrationTest, new RegExp(`public\\.${rpc}_v2\\s*\\(`));
  }
  assert.match(integrationTest, /changed payload was accepted/);
  assert.match(integrationTest, /second return was not rejected/);
  assert.match(integrationTest, /duplicate invoice number was accepted/);
  assert.match(integrationTest, /^BEGIN;$/m);
  assert.match(integrationTest, /^ROLLBACK;$/m);
  assert.match(integrationTest, /Run only in a disposable Supabase project/);
});

test('frontend business mutations use only payload-bound RPC endpoints', () => {
  for (const rpc of payloadBoundRpcs) {
    assert.match(frontendWriteCallSites, new RegExp(`supabase\\.rpc\\(['"]${rpc}_v2['"]`));
  }
  assert.doesNotMatch(
    frontendWriteCallSites,
    /supabase\.rpc\(['"](?:create_phone_purchase_atomic|create_expense_atomic|create_sale_atomic|record_customer_collection|record_supplier_payment|record_internal_transfer)['"]/,
  );
  assert.doesNotMatch(
    frontendWriteCallSites,
    /\.from\(['"](?:cash_ledger|inventory|phone_profit_view)['"]\)/,
    'the legacy locked-down relations must not be required by current ERP UI call sites',
  );
  assert.doesNotMatch(
    frontendWriteCallSites,
    /supabase\.rpc\(['"](?:rls_auto_enable|mark_phone_sold|record_sale_money|update_phone_updated_at|normalize_payment_allocations|payment_mode_for_allocations)['"]/,
    'event-trigger and trigger/helper functions must not be exposed as UI RPC endpoints',
  );
  assert.match(frontendWriteCallSites, /supabase\.rpc\(['"]cashbook_account_summary['"]/);
});
