-- READ-ONLY Supabase catalog diagnostic for Revive Junction ERP.
-- Batch 1: relations, RLS/policies, views, and effective client-role privileges.
-- Every statement is a direct SELECT against catalogs; no dynamic SQL or row data.
-- Run only after confirming the target project in the Supabase Dashboard.
-- In SQL Editor, run each top-level SELECT separately to view every result grid.

-- Public relation inventory and RLS state; auth.users is included for comparison.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized view'
    WHEN 'f' THEN 'foreign table'
    ELSE c.relkind::text
  END AS relation_type,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
UNION ALL
SELECT
  n.nspname,
  c.relname,
  'auth user table',
  pg_catalog.pg_get_userbyid(c.relowner),
  c.relrowsecurity,
  c.relforcerowsecurity
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth'
  AND c.relname = 'users'
  AND c.relkind IN ('r', 'p')
ORDER BY schema_name, relation_name;

-- Direct schema ACL entries and effective USAGE/CREATE rights for API roles.
SELECT
  n.nspname AS schema_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_namespace AS n
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE n.nspname IN ('public', 'auth')
  AND (acl.grantee = 0 OR grantee_role.rolname IN ('anon', 'authenticated'))
ORDER BY n.nspname, grantee, acl.privilege_type;

SELECT
  n.nspname AS schema_name,
  r.rolname AS role_name,
  array_remove(ARRAY[
    CASE WHEN pg_catalog.has_schema_privilege(r.oid, n.oid, 'USAGE') THEN 'USAGE' END,
    CASE WHEN pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE') THEN 'CREATE' END
  ], NULL) AS effective_privileges
FROM pg_catalog.pg_namespace AS n
CROSS JOIN pg_catalog.pg_roles AS r
WHERE n.nspname IN ('public', 'auth')
  AND r.rolname IN ('anon', 'authenticated')
ORDER BY n.nspname, r.rolname;

-- View definitions and security_invoker option reveal the underlying access path.
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  COALESCE((
    SELECT lower(option.option_value) = 'true'
    FROM pg_catalog.pg_options_to_table(c.reloptions) AS option
    WHERE option.option_name = 'security_invoker'
  ), false) AS security_invoker,
  pg_catalog.pg_get_viewdef(c.oid, true) AS view_definition
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
ORDER BY c.relname;

-- Public columns, including view columns, and auth.users column metadata.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  NOT a.attnotnull AS is_nullable,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression,
  a.attidentity AS identity_kind,
  a.attgenerated AS generated_kind
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
LEFT JOIN pg_catalog.pg_attrdef AS d
  ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE ((n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
    OR (n.nspname = 'auth' AND c.relname = 'users' AND c.relkind IN ('r', 'p')))
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum;

-- Keys, foreign keys, unique/check/exclusion constraints and validation state.
SELECT
  n.nspname AS schema_name,
  t.relname AS table_name,
  con.conname AS constraint_name,
  CASE con.contype
    WHEN 'p' THEN 'primary key'
    WHEN 'f' THEN 'foreign key'
    WHEN 'u' THEN 'unique'
    WHEN 'c' THEN 'check'
    WHEN 'x' THEN 'exclusion'
    ELSE con.contype::text
  END AS constraint_type,
  con.convalidated AS is_validated,
  pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS t ON t.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
ORDER BY t.relname, con.conname;

-- Index definitions and usability, including unique and partial-index protections.
SELECT
  n.nspname AS schema_name,
  tbl.relname AS table_name,
  idx.relname AS index_name,
  i.indisprimary AS is_primary,
  i.indisunique AS is_unique,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready,
  pg_catalog.pg_get_indexdef(i.indexrelid) AS index_definition,
  pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_catalog.pg_index AS i
JOIN pg_catalog.pg_class AS tbl ON tbl.oid = i.indrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = tbl.relnamespace
JOIN pg_catalog.pg_class AS idx ON idx.oid = i.indexrelid
WHERE n.nspname = 'public'
ORDER BY tbl.relname, idx.relname;

-- All public-table policies (permissive and restrictive) plus auth.users policies.
SELECT
  schemaname AS schema_name,
  tablename AS table_name,
  policyname AS policy_name,
  permissive,
  roles,
  cmd AS command,
  qual AS using_expression,
  with_check AS check_expression
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
   OR (schemaname = 'auth' AND tablename = 'users')
ORDER BY schemaname, tablename, policyname;

-- Direct relation ACL entries for PUBLIC, anon, and authenticated.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE ((n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
    OR (n.nspname = 'auth' AND c.relname = 'users' AND c.relkind IN ('r', 'p')))
  AND (acl.grantee = 0 OR grantee_role.rolname IN ('anon', 'authenticated'))
ORDER BY n.nspname, c.relname, grantee, acl.privilege_type;

-- Effective relation privileges include PUBLIC grants and role membership.
-- An empty array means no effective relation-level privilege for that API role.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  r.rolname AS role_name,
  array_remove(ARRAY[
    CASE WHEN pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT') THEN 'SELECT' END,
    CASE WHEN pg_catalog.has_table_privilege(r.oid, c.oid, 'INSERT') THEN 'INSERT' END,
    CASE WHEN pg_catalog.has_table_privilege(r.oid, c.oid, 'UPDATE') THEN 'UPDATE' END,
    CASE WHEN pg_catalog.has_table_privilege(r.oid, c.oid, 'DELETE') THEN 'DELETE' END,
    CASE WHEN pg_catalog.has_table_privilege(r.oid, c.oid, 'TRUNCATE') THEN 'TRUNCATE' END,
    CASE WHEN pg_catalog.has_table_privilege(r.oid, c.oid, 'REFERENCES') THEN 'REFERENCES' END,
    CASE WHEN pg_catalog.has_table_privilege(r.oid, c.oid, 'TRIGGER') THEN 'TRIGGER' END
  ], NULL) AS effective_privileges
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles AS r
WHERE ((n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
    OR (n.nspname = 'auth' AND c.relname = 'users' AND c.relkind IN ('r', 'p')))
  AND r.rolname IN ('anon', 'authenticated')
ORDER BY n.nspname, c.relname, r.rolname;

-- Explicit column ACL entries for PUBLIC and the API roles.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  a.attname AS column_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE ((n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
    OR (n.nspname = 'auth' AND c.relname = 'users' AND c.relkind IN ('r', 'p')))
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND a.attacl IS NOT NULL
  AND (acl.grantee = 0 OR grantee_role.rolname IN ('anon', 'authenticated'))
ORDER BY n.nspname, c.relname, a.attname, grantee, acl.privilege_type;

-- Effective per-column privileges; only columns with at least one API-role right
-- are returned, avoiding a large matrix of false rows.
SELECT
  n.nspname AS schema_name,
  c.relname AS relation_name,
  a.attname AS column_name,
  r.rolname AS role_name,
  array_remove(ARRAY[
    CASE WHEN pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT') THEN 'SELECT' END,
    CASE WHEN pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'INSERT') THEN 'INSERT' END,
    CASE WHEN pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'UPDATE') THEN 'UPDATE' END,
    CASE WHEN pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'REFERENCES') THEN 'REFERENCES' END
  ], NULL) AS effective_privileges
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
CROSS JOIN pg_catalog.pg_roles AS r
WHERE ((n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
    OR (n.nspname = 'auth' AND c.relname = 'users' AND c.relkind IN ('r', 'p')))
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND r.rolname IN ('anon', 'authenticated')
  AND (
    pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT')
    OR pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'INSERT')
    OR pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'UPDATE')
    OR pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, 'REFERENCES')
  )
ORDER BY n.nspname, c.relname, a.attnum, r.rolname;

-- Direct sequence ACL entries and effective privileges for API roles.
SELECT
  n.nspname AS schema_name,
  c.relname AS sequence_name,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault('S', c.relowner))
) AS acl
LEFT JOIN pg_catalog.pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
WHERE c.relkind = 'S'
  AND n.nspname = 'public'
  AND (acl.grantee = 0 OR grantee_role.rolname IN ('anon', 'authenticated'))
ORDER BY c.relname, grantee, acl.privilege_type;

SELECT
  n.nspname AS schema_name,
  c.relname AS sequence_name,
  r.rolname AS role_name,
  array_remove(ARRAY[
    CASE WHEN pg_catalog.has_sequence_privilege(r.oid, c.oid, 'USAGE') THEN 'USAGE' END,
    CASE WHEN pg_catalog.has_sequence_privilege(r.oid, c.oid, 'SELECT') THEN 'SELECT' END,
    CASE WHEN pg_catalog.has_sequence_privilege(r.oid, c.oid, 'UPDATE') THEN 'UPDATE' END
  ], NULL) AS effective_privileges
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles AS r
WHERE c.relkind = 'S'
  AND n.nspname = 'public'
  AND r.rolname IN ('anon', 'authenticated')
ORDER BY c.relname, r.rolname;

-- Informational only: this signup reminder is not a substitute for the database
-- diagnostic result sets above. PostgreSQL catalogs cannot authoritatively show
-- GoTrue self-signup settings; check the confirmed project in the Dashboard.
