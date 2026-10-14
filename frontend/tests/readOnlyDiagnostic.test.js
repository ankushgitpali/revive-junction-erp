import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const diagnosticFiles = [
  new URL("../supabase/staging_read_only_diagnostic.sql", import.meta.url),
  new URL("../supabase/staging_rpc_read_only_diagnostic.sql", import.meta.url),
];

test("staging diagnostics are direct, read-only catalog SELECT batches", async () => {
  const batches = await Promise.all(diagnosticFiles.map(async (path) => readFile(path, "utf8")));
  const statementCounts = [];
  for (const sql of batches) {
    const withoutComments = sql
      .replace(/--[^\r\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    const statements = withoutComments
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    statementCounts.push(statements.length);
    assert.ok(statements.length >= 5, "expected a useful set of catalog queries per batch");
    for (const statement of statements) {
      assert.match(statement, /^SELECT\b/i, "every diagnostic statement must be a SELECT");
      const withoutStringLiterals = statement.replace(/'(?:''|[^'])*'/g, "''");
      assert.doesNotMatch(
        withoutStringLiterals,
        /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|CALL|DO|COPY|SET|RESET|VACUUM)\b/i,
        "diagnostics must not contain a data or schema mutation",
      );
      assert.doesNotMatch(
        withoutStringLiterals,
        /\b(?:query_to_xml|query_to_xmlschema|dblink(?:_exec)?|set_config|pg_read_file|pg_read_binary_file|lo_import|lo_export|pg_terminate_backend|pg_cancel_backend)\s*\(/i,
        "diagnostics must not invoke dynamic-query, file, or state-changing helpers",
      );
    }
    assert.doesNotMatch(sql, /supabase_migrations|query_to_xml|dblink/i);
  }

  const [catalogSql, rpcSql] = batches;
  assert.equal(statementCounts[0], 14, "batch 1 should contain all 14 catalog result queries");
  assert.equal(statementCounts[1], 6, "batch 2 should contain all 6 RPC/event-trigger result queries");
  assert.match(catalogSql, /signup reminder is not a substitute for the database/i);
  assert.match(catalogSql, /run each top-level SELECT separately/i);
  assert.match(rpcSql, /run each top-level SELECT separately/i);
  assert.match(catalogSql, /pg_catalog\.pg_policies/);
  assert.match(catalogSql, /has_schema_privilege/);
  assert.match(catalogSql, /has_table_privilege/);
  assert.match(catalogSql, /has_column_privilege/);
  assert.match(catalogSql, /pg_catalog\.pg_get_viewdef/);
  assert.match(catalogSql, /pg_catalog\.pg_options_to_table/);
  assert.match(catalogSql, /c\.relkind IN \('r', 'p', 'v', 'm', 'f'\)/);
  assert.match(catalogSql, /pg_catalog\.has_sequence_privilege/);

  assert.match(rpcSql, /pg_catalog\.pg_get_functiondef\(p\.oid\)\s+AS function_definition/i);
  assert.match(rpcSql, /pg_catalog\.pg_event_trigger\s+AS evt/i);
  assert.match(rpcSql, /evt\.evtenabled\s+AS enabled_state/i);
  assert.match(rpcSql, /pg_catalog\.has_function_privilege/);
  for (const functionName of [
    "rls_auto_enable",
    "return_sale_atomic",
    "mark_phone_sold",
    "normalize_payment_allocations",
    "payment_mode_for_allocations",
    "record_sale_money",
    "update_phone_updated_at",
    "create_phone_purchase_atomic_v2",
    "create_sale_atomic_v2",
    "create_expense_atomic_v2",
    "record_customer_collection_v2",
    "record_supplier_payment_v2",
    "record_internal_transfer_v2",
  ]) {
    assert.match(rpcSql, new RegExp(functionName), `diagnostic must include ${functionName}`);
  }
});
