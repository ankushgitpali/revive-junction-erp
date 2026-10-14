-- Staging-only candidate patch.
-- Removes anonymous/PUBLIC access from the legacy inventory relation and the
-- unused security-invoker profit view. Authenticated grants and business rows
-- are deliberately left unchanged.
BEGIN;

DO $preflight$
DECLARE
  v_inventory regclass := to_regclass('public.inventory');
  v_profit_view regclass := to_regclass('public.phone_profit_view');
  v_kind "char";
  v_rls_enabled boolean;
  v_security_invoker boolean;
  v_policy record;
BEGIN
  IF v_inventory IS NULL THEN
    RAISE EXCEPTION 'Anonymous-access lockdown stopped: public.inventory does not exist.';
  END IF;

  SELECT relkind, relrowsecurity
  INTO v_kind, v_rls_enabled
  FROM pg_class
  WHERE oid = v_inventory;

  IF v_kind NOT IN ('r', 'p') OR v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Anonymous-access lockdown stopped: public.inventory is not an RLS-enabled table.';
  END IF;

  IF v_profit_view IS NULL THEN
    RAISE EXCEPTION 'Anonymous-access lockdown stopped: public.phone_profit_view does not exist.';
  END IF;

  SELECT c.relkind, EXISTS (
    SELECT 1
    FROM pg_options_to_table(c.reloptions) AS option
    WHERE option.option_name = 'security_invoker'
      AND lower(option.option_value) = 'true'
  )
  INTO v_kind, v_security_invoker
  FROM pg_class AS c
  WHERE c.oid = v_profit_view;

  IF v_kind <> 'v' OR v_security_invoker IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Anonymous-access lockdown stopped: public.phone_profit_view is not the expected security-invoker view.';
  END IF;

  SELECT cmd, permissive, roles, qual, with_check
  INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'inventory'
    AND policyname = 'inventory_deny_anon';

  IF FOUND
     AND (
       v_policy.cmd <> 'ALL'
       OR v_policy.permissive <> 'RESTRICTIVE'
       OR v_policy.roles <> ARRAY['anon']::name[]
       OR lower(btrim(COALESCE(v_policy.qual, ''))) <> 'false'
       OR lower(btrim(COALESCE(v_policy.with_check, ''))) <> 'false'
     ) THEN
    RAISE EXCEPTION 'Anonymous-access lockdown stopped: existing inventory_deny_anon policy differs from the expected deny policy.';
  END IF;
END;
$preflight$;

CREATE TEMP TABLE rj_inventory_profit_auth_table_acl_snapshot ON COMMIT DROP AS
SELECT relation.relation_name, relation.relation_oid, privilege.privilege_name,
  has_table_privilege('authenticated', relation.relation_oid, privilege.privilege_name) AS had_privilege
FROM (VALUES
  ('inventory', 'public.inventory'::regclass::oid),
  ('phone_profit_view', 'public.phone_profit_view'::regclass::oid)
) AS relation(relation_name, relation_oid)
CROSS JOIN (VALUES
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
) AS privilege(privilege_name);

CREATE TEMP TABLE rj_inventory_profit_auth_column_acl_snapshot ON COMMIT DROP AS
SELECT relation.relation_name, relation.relation_oid,
  attribute.attname AS column_name, privilege.privilege_name,
  has_column_privilege(
    'authenticated', relation.relation_oid, attribute.attname, privilege.privilege_name
  ) AS had_privilege
FROM (VALUES
  ('inventory', 'public.inventory'::regclass::oid),
  ('phone_profit_view', 'public.phone_profit_view'::regclass::oid)
) AS relation(relation_name, relation_oid)
JOIN pg_attribute AS attribute ON attribute.attrelid = relation.relation_oid
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES'))
  AS privilege(privilege_name)
WHERE attribute.attnum > 0
  AND NOT attribute.attisdropped;

-- Preserve authenticated's current effective relation/column privileges when
-- those rights are inherited from PUBLIC before PUBLIC is revoked.
DO $preserve_authenticated$
DECLARE
  v_privilege text;
  v_relation record;
  v_column record;
BEGIN
  FOR v_relation IN
    SELECT relation_name, relation_oid
    FROM (VALUES
      ('inventory', 'public.inventory'::regclass),
      ('phone_profit_view', 'public.phone_profit_view'::regclass)
    ) AS relations(relation_name, relation_oid)
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF has_table_privilege('authenticated', v_relation.relation_oid, v_privilege) THEN
        EXECUTE format(
          'GRANT %s ON TABLE public.%I TO authenticated',
          v_privilege,
          v_relation.relation_name
        );
      END IF;
    END LOOP;

    FOR v_column IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = v_relation.relation_oid
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
        IF has_column_privilege(
          'authenticated', v_relation.relation_oid, v_column.attname, v_privilege
        ) AND NOT has_table_privilege(
          'authenticated', v_relation.relation_oid, v_privilege
        ) THEN
          EXECUTE format(
            'GRANT %s (%I) ON TABLE public.%I TO authenticated',
            v_privilege,
            v_column.attname,
            v_relation.relation_name
          );
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$preserve_authenticated$;

REVOKE ALL PRIVILEGES ON TABLE public.inventory, public.phone_profit_view FROM PUBLIC, anon;

DO $column_privileges$
DECLARE
  v_column record;
BEGIN
  FOR v_column IN
    SELECT c.relname AS relation_name, a.attname AS column_name
    FROM pg_class AS c
    JOIN pg_attribute AS a ON a.attrelid = c.oid
    WHERE c.oid IN ('public.inventory'::regclass, 'public.phone_profit_view'::regclass)
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE public.%I FROM PUBLIC, anon',
      v_column.column_name,
      v_column.relation_name
    );
  END LOOP;
END;
$column_privileges$;

DO $deny_policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory'
      AND policyname = 'inventory_deny_anon'
  ) THEN
    CREATE POLICY inventory_deny_anon
      ON public.inventory
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
  v_relation regclass;
  v_privilege text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.inventory'::regclass,
    'public.phone_profit_view'::regclass
  ] LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ] LOOP
      IF has_table_privilege('anon', v_relation, v_privilege) THEN
        RAISE EXCEPTION 'Anonymous-access lockdown validation failed: anon retains % on %.',
          v_privilege, v_relation;
      END IF;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege('anon', v_relation, v_privilege) THEN
        RAISE EXCEPTION 'Anonymous-access lockdown validation failed: anon retains a column-level % on %.',
          v_privilege, v_relation;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl, acldefault('r', c.relowner))
    ) AS acl
    WHERE c.oid IN ('public.inventory'::regclass, 'public.phone_profit_view'::regclass)
      AND acl.grantee = 0
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
    WHERE a.attrelid IN ('public.inventory'::regclass, 'public.phone_profit_view'::regclass)
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'Anonymous-access lockdown validation failed: PUBLIC retains relation or column privileges.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory'
      AND policyname = 'inventory_deny_anon'
      AND cmd = 'ALL'
      AND permissive = 'RESTRICTIVE'
      AND roles = ARRAY['anon']::name[]
      AND lower(btrim(COALESCE(qual, ''))) = 'false'
      AND lower(btrim(COALESCE(with_check, ''))) = 'false'
  ) THEN
    RAISE EXCEPTION 'Anonymous-access lockdown validation failed: restrictive inventory anon denial is missing.';
  END IF;
END;
$verify$;

DO $verify_authenticated$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM rj_inventory_profit_auth_table_acl_snapshot AS expected
    WHERE has_table_privilege(
      'authenticated', expected.relation_oid, expected.privilege_name
    ) IS DISTINCT FROM expected.had_privilege
  ) OR EXISTS (
    SELECT 1
    FROM rj_inventory_profit_auth_column_acl_snapshot AS expected
    WHERE has_column_privilege(
      'authenticated', expected.relation_oid, expected.column_name, expected.privilege_name
    ) IS DISTINCT FROM expected.had_privilege
  ) THEN
    RAISE EXCEPTION 'Anonymous-access lockdown validation failed: authenticated relation or column privileges changed.';
  END IF;
END;
$verify_authenticated$;

COMMIT;
