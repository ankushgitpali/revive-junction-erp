-- READ-ONLY Supabase RPC/event-trigger diagnostic for Revive Junction ERP.
-- Batch 2: run after staging_read_only_diagnostic.sql on the same verified project.
-- All statements are direct catalog SELECTs; no dynamic SQL or business rows.
-- In SQL Editor, run each top-level SELECT separately to view every result grid.

-- Public functions/procedures that are SECURITY DEFINER or executable by an API role.
-- effective_execute includes PUBLIC grants and role membership; direct_acl shows
-- only explicit PUBLIC/anon/authenticated ACL entries.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
  pg_catalog.pg_get_function_result(p.oid) AS result_type,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    ) ORDER BY acl.grantee, acl.privilege_type)
    FROM pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
    WHERE acl.grantee = 0 OR grantee_role.rolname IN ('anon', 'authenticated')
  ), '[]'::jsonb) AS direct_acl,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_effective_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_effective_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND (
    p.prosecdef
    OR pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
ORDER BY p.proname, identity_arguments;

-- Definitions for all public SECURITY DEFINER routines and the known trigger/helper
-- functions. Keep result sets private; inspect for any unexpected hard-coded values.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS function_settings,
  pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND (
    p.prosecdef
    OR p.proname IN (
      'rls_auto_enable', 'mark_phone_sold', 'normalize_payment_allocations',
      'payment_mode_for_allocations', 'record_sale_money', 'update_phone_updated_at',
      'validate_expense_record', 'validate_phone_imeis', 'prepare_phone_purchase',
      'process_phone_purchase_automations', 'prepare_sale', 'process_sale_automations',
      'sync_repair_cost', 'prepare_repair_lifecycle', 'finish_repair_lifecycle',
      'prevent_phone_status_during_repair', 'guard_phone_lifecycle_update',
      'audit_business_row', 'prevent_phone_delete', 'prevent_sale_delete',
      'stamp_opening_balance_user', 'process_phone_purchase',
      'process_expense_automation'
    )
  )
ORDER BY p.proname, identity_arguments;

-- Event-trigger registration, command scope, enable state and called function.
-- No result row for rls_auto_enable means no matching attachment is visible.
SELECT
  evt.evtname AS event_trigger_name,
  evt.evtevent AS event_name,
  evt.evtenabled AS enabled_state,
  evt.evttags AS command_tags,
  pg_catalog.pg_get_userbyid(evt.evtowner) AS owner_name,
  n.nspname AS function_schema,
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_effective_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_effective_execute
FROM pg_catalog.pg_event_trigger AS evt
JOIN pg_catalog.pg_proc AS p ON p.oid = evt.evtfoid
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'rls_auto_enable'
ORDER BY evt.evtname;

-- Exact expected frontend payload-bound RPC identities and effective role rights.
SELECT
  expected.function_name,
  expected.identity_arguments AS expected_identity_arguments,
  p.oid IS NOT NULL AS installed,
  CASE WHEN p.oid IS NULL THEN NULL
    ELSE pg_catalog.pg_get_function_identity_arguments(p.oid)
  END AS installed_identity_arguments,
  CASE WHEN p.oid IS NULL THEN false
    ELSE pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  END AS anon_can_execute,
  CASE WHEN p.oid IS NULL THEN false
    ELSE pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  END AS authenticated_can_execute
FROM (VALUES
  ('create_phone_purchase_atomic_v2', 'jsonb'),
  ('create_expense_atomic_v2', 'uuid, text, numeric, text, timestamp with time zone, text'),
  ('create_sale_atomic_v2', 'uuid, uuid, text, text, numeric, numeric, jsonb, timestamp with time zone, integer, text, uuid'),
  ('record_customer_collection_v2', 'uuid, numeric, text, timestamp with time zone, text, uuid'),
  ('record_supplier_payment_v2', 'uuid, numeric, text, timestamp with time zone, text, uuid'),
  ('record_internal_transfer_v2', 'text, text, numeric, timestamp with time zone, text, uuid')
) AS expected(function_name, identity_arguments)
LEFT JOIN pg_catalog.pg_proc AS p
  ON p.pronamespace = 'public'::regnamespace
 AND p.proname = expected.function_name
 AND pg_catalog.pg_get_function_identity_arguments(p.oid) = expected.identity_arguments
ORDER BY expected.function_name;

-- Idempotency ledger shape, RLS state, and primary-key guard; no business rows.
SELECT
  to_regclass('public.rj_idempotency_requests') IS NOT NULL AS table_installed,
  COALESCE(c.relkind IN ('r', 'p'), false) AS is_table,
  COALESCE(c.relrowsecurity, false) AS rls_enabled,
  (
    SELECT count(*) = 6
    FROM (VALUES
      ('requester_id'), ('operation'), ('request_id'),
      ('payload_sha256'), ('result'), ('created_at')
    ) AS expected(column_name)
    WHERE EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = c.oid
        AND a.attname = expected.column_name
        AND a.attnum > 0
        AND NOT a.attisdropped
    )
  ) AS expected_columns_present,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = c.oid
      AND con.contype = 'p'
      AND pg_catalog.pg_get_constraintdef(con.oid) =
        'PRIMARY KEY (requester_id, operation, request_id)'
  ) AS expected_primary_key_present
FROM (SELECT to_regclass('public.rj_idempotency_requests') AS oid) AS relation
LEFT JOIN pg_catalog.pg_class AS c ON c.oid = relation.oid;

-- Return-sale duplicate protection markers and API-role EXECUTE rights.
SELECT
  to_regprocedure('public.return_sale_atomic(uuid,text)') IS NOT NULL AS return_rpc_installed,
  CASE WHEN p.oid IS NULL THEN false
    ELSE position('for update' IN lower(p.prosrc)) > 0
  END AS function_body_contains_row_lock,
  CASE WHEN p.oid IS NULL THEN false
    ELSE position('returned_at' IN lower(p.prosrc)) > 0
      AND position('sale_returns' IN lower(p.prosrc)) > 0
  END AS function_body_checks_return_markers,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS i
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = i.indrelid
     AND a.attnum = i.indkey[0]
    WHERE i.indrelid = to_regclass('public.sale_returns')
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indnkeyatts = 1
      AND a.attname = 'sale_id'
  ) AS unique_sale_return_protection_present,
  CASE WHEN p.oid IS NULL THEN false
    ELSE pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  END AS anon_can_execute_return_rpc,
  CASE WHEN p.oid IS NULL THEN false
    ELSE pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  END AS authenticated_can_execute_return_rpc
FROM (SELECT to_regprocedure('public.return_sale_atomic(uuid,text)') AS oid) AS routine
LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = routine.oid;
