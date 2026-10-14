-- Staging-only candidate patch.
-- Event-trigger invocation is controlled by the event-trigger catalog entry,
-- not by client EXECUTE grants. Keep the trigger registration and enabled
-- state unchanged while removing unnecessary client RPC privileges.
BEGIN;

DO $preflight$
DECLARE
  v_function regprocedure := to_regprocedure('public.rls_auto_enable()');
  v_function_oid oid;
  v_definition record;
  v_trigger_count integer;
  v_enabled_trigger_count integer;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'RLS event-trigger lockdown stopped: public.rls_auto_enable() is missing.';
  END IF;
  v_function_oid := v_function::oid;

  SELECT p.prosecdef, p.pronargs, p.prorettype::regtype::text AS return_type,
    p.proconfig, p.prosrc
  INTO v_definition
  FROM pg_proc AS p
  WHERE p.oid = v_function_oid;

  IF v_definition.prosecdef IS DISTINCT FROM true
     OR v_definition.pronargs <> 0
     OR v_definition.return_type <> 'event_trigger'
     OR NOT ('search_path=pg_catalog' = ANY(COALESCE(v_definition.proconfig, ARRAY[]::text[])))
     OR lower(v_definition.prosrc) NOT LIKE '%enable row level security%'
     OR lower(v_definition.prosrc) NOT LIKE '%public%' THEN
    RAISE EXCEPTION 'RLS event-trigger lockdown stopped: rls_auto_enable() differs from the reviewed SECURITY DEFINER event-trigger contract.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE evt.evtname IS NOT NULL AND evt.evtenabled <> 'D')
  INTO v_trigger_count, v_enabled_trigger_count
  FROM pg_event_trigger AS evt
  WHERE evt.evtfoid = v_function_oid;

  IF v_trigger_count = 0 OR v_enabled_trigger_count <> v_trigger_count THEN
    RAISE EXCEPTION 'RLS event-trigger lockdown stopped: expected at least one enabled event-trigger attachment; inspect registration and state.';
  END IF;
END;
$preflight$;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

DO $verify$
DECLARE
  v_function regprocedure := to_regprocedure('public.rls_auto_enable()');
  v_function_oid oid;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'RLS event-trigger lockdown validation failed: function is missing.';
  END IF;
  v_function_oid := v_function::oid;

  IF has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc AS p
       CROSS JOIN LATERAL aclexplode(
         COALESCE(p.proacl, acldefault('f', p.proowner))
       ) AS acl
       WHERE p.oid = v_function_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'RLS event-trigger lockdown validation failed: PUBLIC or a client role retains EXECUTE.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_event_trigger AS evt
    WHERE evt.evtfoid = v_function_oid
      AND evt.evtenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'RLS event-trigger lockdown validation failed: enabled event-trigger registration was lost.';
  END IF;
END;
$verify$;

COMMIT;
