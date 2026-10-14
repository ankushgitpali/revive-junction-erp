# Supabase staging security verification

This package gathers catalog evidence from the existing Supabase project. It does not connect to a database, inspect business rows, modify objects, or apply migrations. No staging or production database has been queried by this repository review.

## Diagnostic files

- `staging_read_only_diagnostic.sql` — batch 1: public relation/view inventory, `security_invoker` and view definitions, schema/table/view columns, constraints/indexes, all public policies, direct and effective schema/table/column privileges, sequence ACLs, and `auth.users` catalog state.
- `staging_rpc_read_only_diagnostic.sql` — batch 2: direct/effective function EXECUTE ACLs, SECURITY DEFINER definitions and settings, event-trigger registration/enabled state, expected frontend RPC permissions, idempotency structure, and return-sale duplicate markers.

Run the batches separately, in order, in the SQL Editor for the same confirmed staging project. Each file contains multiple independent `SELECT` statements. To see **every** result grid, select and run one complete top-level `SELECT` at a time; the SQL Editor may display only the last result grid when the whole multi-statement script is run at once. Both scripts contain direct catalog `SELECT` statements only. They do not invoke `query_to_xml`, dynamic SQL, or query business rows. View definitions and function definitions are source code; inspect results inside the trusted project and do not share raw outputs if they contain sensitive literals.

The signup reminder at the end of batch 1 is an SQL comment only. It is informational and is not a diagnostic result or a substitute for the preceding database result sets. The diagnostic intentionally does not query `supabase_migrations.schema_migrations`: that relation may not exist or be readable, and migration history cannot prove that live objects match migration source. An unavailable or unrecorded migration version is not evidence that a migration was or was not applied.

## Applied staging hardening (reported and verified by the project owner)

The focused hardening below was already applied directly to the isolated `RJ-Staging-Test` project and verified by the project owner. `patches/20261010000700_staging_access_hardening_record.sql` records those exact statements as a replay-safe audit artifact. Do not execute it as part of this review or against any database; this repository task performs no database operations. Production remains untouched.

- Dropped IF EXISTS policies named `"Allow Public Delete"` from `public.cash_ledger`, `public.expenses`, `public.phones`, and `public.sales`.
- Revoked ALL privileges on `public.cash_ledger`, `public.inventory`, and `public.phone_profit_view` from `anon`.
- Revoked ALL privileges on `public.audit_log_id_seq` and `public.sales_invoice_seq` from `anon`.
- Revoked UPDATE on those two sequences from `authenticated`.
- Revoked ALL privileges on `public.rls_auto_enable()` from `PUBLIC`, `anon`, and `authenticated`.
- Owner verification confirmed anonymous SELECT is false on `phones`, `sales`, `customers`, `money_transactions`, `phone_profit_view`, `cash_ledger`, `inventory`, and `expenses`; the `ensure_rls` event trigger remains enabled.

## Candidate patches (not applied)

- `patches/20261009000100_return_sale_duplicate_guard.sql` — candidate return-workflow guard. It checks dependencies, serializes returns, and replaces the function body; it can extend existing check constraints for repair/return lifecycle values. Review the exact live constraint definitions and exercise the full return flow on staging before considering it.
- `patches/20261010000200_cash_ledger_anon_lockdown.sql` — candidate for the legacy `cash_ledger` broad `anon`/`PUBLIC` grants and exact `"Allow Public Delete"` policy. Removing that PUBLIC-scoped policy also removes it for authenticated users. Current UI has no `cash_ledger` call sites; stop if another approved integration depends on it.
- `patches/20261010000300_inventory_profit_view_anon_lockdown.sql` — candidate to remove `anon`/`PUBLIC` relation and column grants from legacy `inventory` and `phone_profit_view`. It preserves authenticated effective relation/column privileges and business rows. A `security_invoker` view additionally requires caller privileges on its underlying relations and is subject to their RLS policies; view SELECT grant alone does not prove anon can read rows.
- `patches/20261010000400_rpc_helper_execute_lockdown.sql` — candidate to remove direct client EXECUTE from the two immutable SECURITY INVOKER payment-allocation helpers, which have no frontend RPC call sites. It aborts if either routine has an explicit authenticated grant or differs from the expected contract.
- `patches/20261010000500_expected_selling_price_validation.sql` — candidate finite, non-negative, two-decimal constraint for numeric `phones.expected_selling_price`. It stops if the column has another type or existing data is invalid and does not rewrite rows.
- `patches/20261010000600_rls_event_trigger_execute_lockdown.sql` — candidate to remove client EXECUTE from `public.rls_auto_enable()` only after checking its signature, SECURITY DEFINER/search_path/body contract and an enabled event-trigger attachment. It does not alter event-trigger registration or enable state.

The candidates are separate transactions. Do not run all files as a batch. No manual rollback script that re-grants PUBLIC/anon access is provided. If a transaction aborts, PostgreSQL rolls it back to the pre-patch state (which may still contain the reported broad grants); do not weaken checks or manually restore those grants. The `20261008000100_financial_inventory_core.sql` and `20261010000100_payload_bound_idempotency.sql` files are migrations, not patches to run as part of this diagnostic. `tests/financial_inventory_core.test.sql` mutates fixtures inside a transaction; `tests/run_financial_inventory_staging.ps1` targets a configured database. Do not use either for catalog inspection.

## Ordered staging-only procedure

1. Identify the staging project in the Supabase Dashboard and verify its project reference. Do not use `.env` files, credentials, saved profiles, or the SQL runner to identify it. Confirm the project is isolated from production and has a recoverable backup.
2. Open `supabase/staging_read_only_diagnostic.sql` in the repository, then run each complete top-level `SELECT` separately in the verified project's SQL Editor. Save all result grids privately. Review policies together with relation/column/sequence grants. For every view, especially `phone_profit_view`, compare view SELECT rights with its `security_invoker` option, definition/dependencies, underlying table grants, and underlying RLS policies. Do not treat the informational signup comment as a diagnostic result.
3. Open `supabase/staging_rpc_read_only_diagnostic.sql` and, in the same project, run each complete top-level `SELECT` separately. Compare all installed SECURITY DEFINER definitions/settings and effective EXECUTE ACLs with the frontend call sites. Confirm event-trigger attachment and enabled state independently of the function's client EXECUTE ACL. Verify the six payload-bound RPC signatures remain executable by `authenticated` and not `anon`.
4. Before any mutation, compare each candidate's stated preflight contract with the live output and get separate owner approval for that exact file. Stop if an object is missing, definitions/grants/policies differ, a preflight fails, or the operation could change an approved workflow. Apply no unrelated migrations.
5. If individually approved and each live preflight matches, run only the corresponding candidate file in a separate SQL Editor transaction, in this review order (skip every unapproved or non-matching file): `20261009000100_return_sale_duplicate_guard.sql`, `20261010000200_cash_ledger_anon_lockdown.sql`, `20261010000300_inventory_profit_view_anon_lockdown.sql`, `20261010000400_rpc_helper_execute_lockdown.sql`, `20261010000500_expected_selling_price_validation.sql`, then `20261010000600_rls_event_trigger_execute_lockdown.sql`. These files are independent; the sequence is an operational checklist, not a dependency chain. Stop after each patch and inspect its success/failure. Apply no automatic rollback that restores PUBLIC/anon rights.
6. Rerun batches 1 and 2 and compare the relevant postflight ACL/policy/definition outputs. Independently exercise the affected authenticated ERP workflow in staging before any production consideration. No production change is authorized by this package.

Candidates `002` through `006` are independent of one another; use their numeric order only for record-keeping, not as a dependency. The return-guard candidate `20261009000100` depends on the existing core tables/functions/constraints and is also independent of those candidates. A failed patch transaction should roll back; otherwise pause and ask the database owner for a narrowly scoped recovery plan rather than weakening checks.

## What the evidence can and cannot establish

- PostgreSQL ACLs distinguish direct entries (`PUBLIC`, `anon`, `authenticated`) from effective privileges, which include PUBLIC grants and role membership. An effective SQL privilege is not by itself proof that a client can read or mutate rows: RLS policies also apply. Conversely, policies do not grant SQL privileges.
- For RLS-protected data, combine the role's effective table/column privilege with every applicable permissive and restrictive policy. `PUBLIC` policies apply to both `anon` and `authenticated` unless role applicability or a restrictive policy changes the result.
- `security_invoker=true` means view access uses caller privileges on underlying relations and their RLS rules. Use the view definition and base relation evidence together; a view grant alone is not an end-to-end access test.
- Repository source defines a single-shop access model: several authenticated policies use `USING (true)` / `WITH CHECK (true)` with no owner filter, and authenticated users can read shared finance/inventory tables. This is a confirmed source-level fact. Whether that is acceptable depends on the intended user model and actual signup settings; do not add tenant filters or revoke authenticated workflow access based only on this diagnostic.
- The frontend no longer offers self-signup, but that does not disable project-level Supabase signup. Manually verify the confirmed project at **Supabase Dashboard → Authentication → Settings → User Signups → Allow new users to sign up**. The database catalog cannot authoritatively establish this setting.
- Function definitions/settings and EXECUTE rights must be assessed together. Event triggers fire from PostgreSQL DDL events; their registration/enabled state is separate from client RPC EXECUTE. PostgreSQL requires a superuser to create an event trigger, and the PostgreSQL event-trigger creation path validates the no-argument `event_trigger` return type without checking the function's client EXECUTE ACL. Revoking client EXECUTE therefore does not disable an existing attachment. Any later replacement/recreation remains a separately authorized superuser operation.
- Empty/missing catalog results may indicate an absent object, insufficient catalog visibility, or different naming. Migration history is not queried and must not be inferred from missing catalog rows.

## Safety boundary

No SQL in this package has been executed. Do not run any patch, migration, integration test, or PowerShell runner against production. Never paste or commit service-role keys, database URLs, tokens, `.env` values, or raw diagnostic output containing sensitive source literals.
