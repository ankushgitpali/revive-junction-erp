-- Staging-only candidate patch.
-- These immutable SECURITY INVOKER helpers are called internally by the
-- authenticated financial workflows; the frontend does not call them as RPCs.
BEGIN;

DO $preflight$
DECLARE
  v_function regprocedure;
  v_routine record;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.normalize_payment_allocations(jsonb,numeric)'::regprocedure,
    'public.payment_mode_for_allocations(jsonb)'::regprocedure
  ] LOOP
    SELECT p.prosecdef, p.provolatile
    INTO v_routine
    FROM pg_proc AS p
    WHERE p.oid = v_function;

    IF v_routine.prosecdef IS DISTINCT FROM false
       OR v_routine.provolatile <> 'i' THEN
      RAISE EXCEPTION 'RPC helper lockdown stopped: % is not the expected immutable SECURITY INVOKER function.',
        v_function;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_proc AS p
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))
      ) AS acl
      JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
      WHERE p.oid = v_function
        AND grantee.rolname = 'authenticated'
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'RPC helper lockdown stopped: % has an explicit authenticated grant; inspect its callers before revoking.',
        v_function;
    END IF;
  END LOOP;
END;
$preflight$;

REVOKE ALL ON FUNCTION public.normalize_payment_allocations(jsonb, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payment_mode_for_allocations(jsonb) FROM PUBLIC, anon;

DO $verify$
DECLARE
  v_function regprocedure;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.normalize_payment_allocations(jsonb,numeric)'::regprocedure,
    'public.payment_mode_for_allocations(jsonb)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC helper lockdown validation failed: a client role retains EXECUTE on %.',
        v_function;
    END IF;
  END LOOP;
END;
$verify$;

COMMIT;
