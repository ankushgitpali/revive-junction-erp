-- Remove anonymous and PUBLIC access to the legacy cash_ledger relation.
-- Review the live grants and policies before applying to any shared project.
-- Application workflows in the current frontend use public.money_transactions.
BEGIN;

DO $preflight$
DECLARE
  v_relation regclass := to_regclass('public.cash_ledger');
  v_kind "char";
  v_rls_enabled boolean;
  v_policy record;
BEGIN
  IF v_relation IS NULL THEN
    RAISE EXCEPTION 'cash_ledger lockdown stopped: public.cash_ledger does not exist.';
  END IF;

  SELECT relkind, relrowsecurity
  INTO v_kind, v_rls_enabled
  FROM pg_class
  WHERE oid = v_relation;

  IF v_kind NOT IN ('r', 'p') OR v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'cash_ledger lockdown stopped: expected an RLS-enabled table.';
  END IF;

  SELECT cmd, permissive, roles, qual
  INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'cash_ledger'
    AND policyname = 'Allow Public Delete';

  IF FOUND
     AND (
       v_policy.cmd <> 'DELETE'
       OR v_policy.permissive <> 'PERMISSIVE'
       OR NOT ('public'::name = ANY (v_policy.roles))
       OR lower(btrim(COALESCE(v_policy.qual, ''))) <> 'true'
     ) THEN
    RAISE EXCEPTION 'cash_ledger lockdown stopped: "Allow Public Delete" differs from the audited policy; inspect the live policy first.';
  END IF;

  SELECT cmd, permissive, roles, qual, with_check
  INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'cash_ledger'
    AND policyname = 'cash_ledger_deny_anon';

  IF FOUND
     AND (
       v_policy.cmd <> 'ALL'
       OR v_policy.permissive <> 'RESTRICTIVE'
       OR v_policy.roles <> ARRAY['anon']::name[]
       OR lower(btrim(COALESCE(v_policy.qual, ''))) <> 'false'
       OR lower(btrim(COALESCE(v_policy.with_check, ''))) <> 'false'
     ) THEN
    RAISE EXCEPTION 'cash_ledger lockdown stopped: existing cash_ledger_deny_anon policy does not match the expected restrictive deny policy.';
  END IF;

     IF EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'cash_ledger'
         AND permissive = 'PERMISSIVE'
         AND ('public'::name = ANY (roles) OR 'anon'::name = ANY (roles))
         AND policyname <> 'Allow Public Delete'
     ) THEN
       RAISE EXCEPTION 'cash_ledger lockdown stopped: another permissive PUBLIC/anon policy exists; inspect every cash_ledger policy before applying.';
     END IF;
END;
$preflight$;

CREATE TEMP TABLE rj_cash_ledger_auth_table_acl_snapshot ON COMMIT DROP AS
SELECT privilege_name,
  has_table_privilege('authenticated', 'public.cash_ledger', privilege_name) AS had_privilege
FROM (VALUES
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
) AS privileges(privilege_name);

CREATE TEMP TABLE rj_cash_ledger_auth_column_acl_snapshot ON COMMIT DROP AS
SELECT attribute.attname AS column_name, privileges.privilege_name,
  has_column_privilege(
    'authenticated', 'public.cash_ledger', attribute.attname, privileges.privilege_name
  ) AS had_privilege
FROM pg_attribute AS attribute
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES'))
  AS privileges(privilege_name)
WHERE attribute.attrelid = 'public.cash_ledger'::regclass
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped;

-- Preserve authenticated's current effective relation/column privileges when
-- those rights are inherited from PUBLIC before PUBLIC is revoked.
DO $preserve_authenticated$
DECLARE
  v_privilege text;
  v_column record;
BEGIN
  FOREACH v_privilege IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.cash_ledger', v_privilege) THEN
      EXECUTE format(
        'GRANT %s ON TABLE public.cash_ledger TO authenticated',
        v_privilege
      );
    END IF;
  END LOOP;

  FOR v_column IN
    SELECT attname
    FROM pg_attribute
    WHERE attrelid = 'public.cash_ledger'::regclass
      AND attnum > 0
      AND NOT attisdropped
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_column_privilege(
        'authenticated', 'public.cash_ledger', v_column.attname, v_privilege
      ) AND NOT has_table_privilege(
        'authenticated', 'public.cash_ledger', v_privilege
      ) THEN
        EXECUTE format(
          'GRANT %s (%I) ON TABLE public.cash_ledger TO authenticated',
          v_privilege,
          v_column.attname
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$preserve_authenticated$;

REVOKE ALL PRIVILEGES ON TABLE public.cash_ledger FROM PUBLIC, anon;

DO $column_privileges$
DECLARE
  v_column record;
BEGIN
  FOR v_column IN
    SELECT attname
    FROM pg_attribute
    WHERE attrelid = 'public.cash_ledger'::regclass
      AND attnum > 0
      AND NOT attisdropped
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE public.cash_ledger FROM PUBLIC, anon',
      v_column.attname
    );
  END LOOP;
END;
$column_privileges$;

DROP POLICY IF EXISTS "Allow Public Delete" ON public.cash_ledger;

DO $deny_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_ledger'
      AND policyname = 'cash_ledger_deny_anon'
  ) THEN
    CREATE POLICY cash_ledger_deny_anon
      ON public.cash_ledger
      AS RESTRICTIVE
      FOR ALL
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;
END;
$deny_policy$;

DO $verify$
DECLARE
  v_privilege text;
BEGIN
  FOREACH v_privilege IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ] LOOP
    IF has_table_privilege('anon', 'public.cash_ledger', v_privilege) THEN
      RAISE EXCEPTION 'cash_ledger lockdown validation failed: anon retains % table privilege.', v_privilege;
    END IF;
  END LOOP;

  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
    IF has_any_column_privilege('anon', 'public.cash_ledger', v_privilege) THEN
      RAISE EXCEPTION 'cash_ledger lockdown validation failed: anon retains a column-level % privilege.', v_privilege;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl, acldefault('r', c.relowner))
    ) AS acl
    WHERE c.oid = 'public.cash_ledger'::regclass
      AND acl.grantee = 0
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
    WHERE a.attrelid = 'public.cash_ledger'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'cash_ledger lockdown validation failed: PUBLIC retains table or column privileges.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_ledger'
      AND policyname = 'Allow Public Delete'
  ) THEN
    RAISE EXCEPTION 'cash_ledger lockdown validation failed: "Allow Public Delete" remains installed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_ledger'
      AND policyname = 'cash_ledger_deny_anon'
      AND cmd = 'ALL'
      AND permissive = 'RESTRICTIVE'
      AND roles = ARRAY['anon']::name[]
      AND lower(btrim(COALESCE(qual, ''))) = 'false'
      AND lower(btrim(COALESCE(with_check, ''))) = 'false'
  ) THEN
    RAISE EXCEPTION 'cash_ledger lockdown validation failed: restrictive anonymous denial policy is missing.';
  END IF;
END;
$verify$;

DO $verify_authenticated$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM rj_cash_ledger_auth_table_acl_snapshot AS expected
    WHERE has_table_privilege(
      'authenticated', 'public.cash_ledger', expected.privilege_name
    ) IS DISTINCT FROM expected.had_privilege
  ) OR EXISTS (
    SELECT 1
    FROM rj_cash_ledger_auth_column_acl_snapshot AS expected
    WHERE has_column_privilege(
      'authenticated', 'public.cash_ledger', expected.column_name, expected.privilege_name
    ) IS DISTINCT FROM expected.had_privilege
  ) THEN
    RAISE EXCEPTION 'cash_ledger lockdown validation failed: authenticated relation or column privileges changed.';
  END IF;
END;
$verify_authenticated$;

COMMIT;
