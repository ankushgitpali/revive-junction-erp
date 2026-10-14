-- Additive payload-bound idempotency endpoints.
BEGIN;

DO $preflight$
DECLARE
  v_item record;
  v_table regclass;
  v_column_type oid;
  v_existing_idempotency_table regclass;
BEGIN
  IF to_regprocedure('public.create_phone_purchase_atomic(jsonb)') IS NULL
     OR to_regprocedure('public.create_expense_atomic(uuid,text,numeric,text,timestamp with time zone,text)') IS NULL
     OR to_regprocedure('public.create_sale_atomic(uuid,uuid,text,text,numeric,numeric,jsonb,timestamp with time zone,integer,text,uuid)') IS NULL
     OR to_regprocedure('public.record_customer_collection(uuid,numeric,text,timestamp with time zone,text,uuid)') IS NULL
     OR to_regprocedure('public.record_supplier_payment(uuid,numeric,text,timestamp with time zone,text,uuid)') IS NULL
     OR to_regprocedure('public.record_internal_transfer(text,text,numeric,timestamp with time zone,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Payload idempotency migration stopped: one or more expected core RPC signatures are missing.';
  END IF;
  IF (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.create_phone_purchase_atomic(jsonb)'))
       IS DISTINCT FROM ARRAY['p_payload']::text[]
     OR (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.create_expense_atomic(uuid,text,numeric,text,timestamp with time zone,text)'))
       IS DISTINCT FROM ARRAY['p_request_id', 'p_category', 'p_amount', 'p_payment_mode', 'p_expense_date', 'p_description']::text[]
     OR (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.create_sale_atomic(uuid,uuid,text,text,numeric,numeric,jsonb,timestamp with time zone,integer,text,uuid)'))
       IS DISTINCT FROM ARRAY['p_phone_id', 'p_customer_id', 'p_customer_name', 'p_customer_phone', 'p_selling_price', 'p_discount', 'p_payment_allocations', 'p_sale_date', 'p_warranty_days', 'p_notes', 'p_request_id']::text[]
     OR (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.record_customer_collection(uuid,numeric,text,timestamp with time zone,text,uuid)'))
       IS DISTINCT FROM ARRAY['p_receivable_id', 'p_amount', 'p_payment_mode', 'p_collection_date', 'p_notes', 'p_request_id']::text[]
     OR (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.record_supplier_payment(uuid,numeric,text,timestamp with time zone,text,uuid)'))
       IS DISTINCT FROM ARRAY['p_payable_id', 'p_amount', 'p_payment_mode', 'p_payment_date', 'p_notes', 'p_request_id']::text[]
     OR (SELECT proargnames FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.record_internal_transfer(text,text,numeric,timestamp with time zone,text,uuid)'))
       IS DISTINCT FROM ARRAY['p_from_account', 'p_to_account', 'p_amount', 'p_transfer_date', 'p_notes', 'p_request_id']::text[] THEN
    RAISE EXCEPTION 'Payload idempotency migration stopped: RPC parameter names do not match the expected contract.';
  END IF;
  IF to_regclass('public.phones') IS NULL
     OR to_regclass('public.sales') IS NULL
     OR to_regclass('public.expenses') IS NULL
     OR to_regclass('public.customer_collections') IS NULL
     OR to_regclass('public.supplier_payments') IS NULL
     OR to_regclass('public.internal_transfers') IS NULL THEN
    RAISE EXCEPTION 'Payload idempotency migration stopped: one or more request-ID tables are missing.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.phones'::regclass AND attname = 'client_request_id' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.sales'::regclass AND attname = 'client_request_id' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.expenses'::regclass AND attname = 'client_request_id' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.customer_collections'::regclass AND attname = 'client_request_id' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.supplier_payments'::regclass AND attname = 'client_request_id' AND NOT attisdropped
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.internal_transfers'::regclass AND attname = 'client_request_id' AND NOT attisdropped
     ) THEN
    RAISE EXCEPTION 'Payload idempotency migration stopped: a request-ID column is missing.';
  END IF;

  FOR v_item IN
    SELECT * FROM (VALUES
      ('phones', 'phones_client_request_id_uidx'),
      ('sales', 'sales_client_request_id_uidx'),
      ('expenses', 'expenses_client_request_id_uidx'),
      ('customer_collections', 'customer_collections_client_request_id_uidx'),
      ('supplier_payments', 'supplier_payments_client_request_id_uidx'),
      ('internal_transfers', 'internal_transfers_client_request_id_uidx')
    ) AS expected(table_name, index_name)
  LOOP
    v_table := to_regclass(format('public.%I', v_item.table_name));
    SELECT a.atttypid
    INTO v_column_type
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = v_table
      AND a.attname = 'client_request_id'
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_column_type IS DISTINCT FROM 'uuid'::regtype THEN
      RAISE EXCEPTION 'Payload idempotency migration stopped: %.client_request_id must be uuid.',
        v_item.table_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS i
      JOIN pg_catalog.pg_attribute AS a
        ON a.attrelid = i.indrelid
       AND a.attnum = i.indkey[0]
       AND a.attname = 'client_request_id'
       AND a.attnum > 0
       AND NOT a.attisdropped
      WHERE i.indrelid = v_table
        AND i.indisunique
        AND i.indisvalid
        AND i.indisready
        AND i.indnkeyatts = 1
        AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) ILIKE '%client_request_id IS NOT NULL%'
    ) THEN
      RAISE EXCEPTION 'Payload idempotency migration stopped: expected unique partial request-ID index on public.%.client_request_id is missing or incompatible.',
        v_item.table_name;
    END IF;
  END LOOP;

  v_existing_idempotency_table := to_regclass('public.rj_idempotency_requests');
  IF v_existing_idempotency_table IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS c
      WHERE c.oid = v_existing_idempotency_table
        AND c.relkind IN ('r', 'p')
    ) THEN
      RAISE EXCEPTION 'Payload idempotency migration stopped: public.rj_idempotency_requests exists but is not a table.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (VALUES
        ('requester_id', 'uuid'::regtype),
        ('operation', 'text'::regtype),
        ('request_id', 'uuid'::regtype),
        ('payload_sha256', 'bytea'::regtype),
        ('result', 'jsonb'::regtype),
        ('created_at', 'timestamp with time zone'::regtype)
      ) AS expected(column_name, type_oid)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS a
        WHERE a.attrelid = v_existing_idempotency_table
          AND a.attname = expected.column_name
          AND a.atttypid = expected.type_oid
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
    ) THEN
      RAISE EXCEPTION 'Payload idempotency migration stopped: existing rj_idempotency_requests columns or types are incompatible.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS c
      WHERE c.conrelid = v_existing_idempotency_table
        AND c.contype = 'p'
        AND pg_catalog.pg_get_constraintdef(c.oid) =
          'PRIMARY KEY (requester_id, operation, request_id)'
    ) OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS c
      WHERE c.conrelid = v_existing_idempotency_table
        AND c.contype = 'c'
        AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%octet_length(payload_sha256) = 32%'
    ) OR NOT (
      SELECT relrowsecurity
      FROM pg_catalog.pg_class
      WHERE oid = v_existing_idempotency_table
    ) THEN
      RAISE EXCEPTION 'Payload idempotency migration stopped: existing idempotency table constraints or RLS state are incompatible.';
    END IF;
  END IF;
END;
$preflight$;

DO $rename_unbound_functions$
BEGIN
  IF to_regprocedure('public.create_phone_purchase_atomic_unbound_legacy(jsonb)') IS NULL THEN
    ALTER FUNCTION public.create_phone_purchase_atomic(jsonb) RENAME TO create_phone_purchase_atomic_unbound_legacy;
  END IF;
  IF to_regprocedure('public.create_expense_atomic_unbound_legacy(uuid,text,numeric,text,timestamp with time zone,text)') IS NULL THEN
    ALTER FUNCTION public.create_expense_atomic(uuid, text, numeric, text, timestamptz, text) RENAME TO create_expense_atomic_unbound_legacy;
  END IF;
  IF to_regprocedure('public.create_sale_atomic_unbound_legacy(uuid,uuid,text,text,numeric,numeric,jsonb,timestamp with time zone,integer,text,uuid)') IS NULL THEN
    ALTER FUNCTION public.create_sale_atomic(uuid, uuid, text, text, numeric, numeric, jsonb, timestamptz, integer, text, uuid) RENAME TO create_sale_atomic_unbound_legacy;
  END IF;
  IF to_regprocedure('public.record_customer_collection_unbound_legacy(uuid,numeric,text,timestamp with time zone,text,uuid)') IS NULL THEN
    ALTER FUNCTION public.record_customer_collection(uuid, numeric, text, timestamptz, text, uuid) RENAME TO record_customer_collection_unbound_legacy;
  END IF;
  IF to_regprocedure('public.record_supplier_payment_unbound_legacy(uuid,numeric,text,timestamp with time zone,text,uuid)') IS NULL THEN
    ALTER FUNCTION public.record_supplier_payment(uuid, numeric, text, timestamptz, text, uuid) RENAME TO record_supplier_payment_unbound_legacy;
  END IF;
  IF to_regprocedure('public.record_internal_transfer_unbound_legacy(text,text,numeric,timestamp with time zone,text,uuid)') IS NULL THEN
    ALTER FUNCTION public.record_internal_transfer(text, text, numeric, timestamptz, text, uuid) RENAME TO record_internal_transfer_unbound_legacy;
  END IF;
END;
$rename_unbound_functions$;

CREATE TABLE IF NOT EXISTS public.rj_idempotency_requests (
  requester_id uuid NOT NULL,
  operation text NOT NULL,
  request_id uuid NOT NULL,
  payload_sha256 bytea NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, operation, request_id),
  CHECK (octet_length(payload_sha256) = 32)
);

ALTER TABLE public.rj_idempotency_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rj_idempotency_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rj_payload_sha256(p_payload jsonb)
RETURNS bytea
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.sha256(pg_catalog.convert_to(p_payload::text, 'UTF8'));
$function$;

CREATE OR REPLACE FUNCTION public.rj_claim_idempotency_request(
  p_operation text,
  p_request_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_requester uuid := auth.uid();
  v_existing_hash bytea;
  v_existing_result jsonb;
BEGIN
  IF v_requester IS NULL THEN RAISE EXCEPTION 'Sign in is required.'; END IF;
  IF NULLIF(BTRIM(p_operation), '') IS NULL OR p_request_id IS NULL OR p_payload IS NULL THEN
    RAISE EXCEPTION 'A request ID and canonical business payload are required.';
  END IF;

  INSERT INTO public.rj_idempotency_requests (requester_id, operation, request_id, payload_sha256)
  VALUES (v_requester, p_operation, p_request_id, public.rj_payload_sha256(p_payload))
  ON CONFLICT (requester_id, operation, request_id) DO NOTHING;

  SELECT payload_sha256, result
  INTO v_existing_hash, v_existing_result
  FROM public.rj_idempotency_requests
  WHERE requester_id = v_requester AND operation = p_operation AND request_id = p_request_id
  FOR UPDATE;

  IF v_existing_hash IS DISTINCT FROM public.rj_payload_sha256(p_payload) THEN
    RAISE EXCEPTION 'This request ID was already used with different transaction details.';
  END IF;

  RETURN v_existing_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rj_store_idempotency_result(
  p_operation text,
  p_request_id uuid,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_requester uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_requester IS NULL OR p_request_id IS NULL OR p_result IS NULL THEN
    RAISE EXCEPTION 'An authenticated request and non-empty result are required.';
  END IF;

  UPDATE public.rj_idempotency_requests
  SET result = p_result
  WHERE requester_id = v_requester AND operation = p_operation AND request_id = p_request_id
    AND result IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'The idempotency result could not be saved.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_phone_purchase_atomic_v2(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_request_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required.'; END IF;
  BEGIN
    v_request_id := NULLIF(p_payload ->> 'client_request_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Phone purchase request ID is invalid.';
  END;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'Phone purchase request ID is required.'; END IF;

  v_result := public.rj_claim_idempotency_request('phone_purchase', v_request_id, p_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  IF EXISTS (SELECT 1 FROM public.phones WHERE client_request_id = v_request_id) THEN
    RAISE EXCEPTION 'This request ID predates payload-bound retries; verify the saved phone record before retrying.';
  END IF;

  v_result := public.create_phone_purchase_atomic_unbound_legacy(p_payload);
  PERFORM public.rj_store_idempotency_result('phone_purchase', v_request_id, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_expense_atomic_v2(
  p_request_id uuid, p_category text, p_amount numeric, p_payment_mode text,
  p_expense_date timestamptz, p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object(
    'p_request_id', p_request_id, 'p_category', p_category, 'p_amount', p_amount,
    'p_payment_mode', p_payment_mode, 'p_expense_date', p_expense_date, 'p_description', p_description
  );
  v_result jsonb;
BEGIN
  v_result := public.rj_claim_idempotency_request('expense', p_request_id, v_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  IF EXISTS (SELECT 1 FROM public.expenses WHERE client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'This request ID predates payload-bound retries; verify the saved expense before retrying.';
  END IF;

  v_result := public.create_expense_atomic_unbound_legacy(
    p_request_id, p_category, p_amount, p_payment_mode, p_expense_date, p_description
  );
  PERFORM public.rj_store_idempotency_result('expense', p_request_id, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_sale_atomic_v2(
  p_phone_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text,
  p_selling_price numeric, p_discount numeric, p_payment_allocations jsonb,
  p_sale_date timestamptz, p_warranty_days integer, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object(
    'p_phone_id', p_phone_id, 'p_customer_id', p_customer_id, 'p_customer_name', p_customer_name,
    'p_customer_phone', p_customer_phone, 'p_selling_price', p_selling_price, 'p_discount', p_discount,
    'p_payment_allocations', p_payment_allocations, 'p_sale_date', p_sale_date,
    'p_warranty_days', p_warranty_days, 'p_notes', p_notes, 'p_request_id', p_request_id
  );
  v_result jsonb;
BEGIN
  v_result := public.rj_claim_idempotency_request('sale', p_request_id, v_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'This request ID predates payload-bound retries; verify the saved sale before retrying.';
  END IF;

  v_result := public.create_sale_atomic_unbound_legacy(
    p_phone_id, p_customer_id, p_customer_name, p_customer_phone, p_selling_price, p_discount,
    p_payment_allocations, p_sale_date, p_warranty_days, p_notes, p_request_id
  );
  PERFORM public.rj_store_idempotency_result('sale', p_request_id, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_collection_v2(
  p_receivable_id uuid, p_amount numeric, p_payment_mode text,
  p_collection_date timestamptz, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object(
    'p_receivable_id', p_receivable_id, 'p_amount', p_amount, 'p_payment_mode', p_payment_mode,
    'p_collection_date', p_collection_date, 'p_notes', p_notes, 'p_request_id', p_request_id
  );
  v_result jsonb;
BEGIN
  v_result := public.rj_claim_idempotency_request('customer_collection', p_request_id, v_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  IF EXISTS (SELECT 1 FROM public.customer_collections WHERE client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'This request ID predates payload-bound retries; verify the saved collection before retrying.';
  END IF;

  v_result := public.record_customer_collection_unbound_legacy(
    p_receivable_id, p_amount, p_payment_mode, p_collection_date, p_notes, p_request_id
  );
  PERFORM public.rj_store_idempotency_result('customer_collection', p_request_id, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_supplier_payment_v2(
  p_payable_id uuid, p_amount numeric, p_payment_mode text,
  p_payment_date timestamptz, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object(
    'p_payable_id', p_payable_id, 'p_amount', p_amount, 'p_payment_mode', p_payment_mode,
    'p_payment_date', p_payment_date, 'p_notes', p_notes, 'p_request_id', p_request_id
  );
  v_result jsonb;
BEGIN
  v_result := public.rj_claim_idempotency_request('supplier_payment', p_request_id, v_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_payments WHERE client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'This request ID predates payload-bound retries; verify the saved supplier payment before retrying.';
  END IF;

  v_result := public.record_supplier_payment_unbound_legacy(
    p_payable_id, p_amount, p_payment_mode, p_payment_date, p_notes, p_request_id
  );
  PERFORM public.rj_store_idempotency_result('supplier_payment', p_request_id, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_internal_transfer_v2(
  p_from_account text, p_to_account text, p_amount numeric,
  p_transfer_date timestamptz, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object(
    'p_from_account', p_from_account, 'p_to_account', p_to_account, 'p_amount', p_amount,
    'p_transfer_date', p_transfer_date, 'p_notes', p_notes, 'p_request_id', p_request_id
  );
  v_result jsonb;
BEGIN
  v_result := public.rj_claim_idempotency_request('internal_transfer', p_request_id, v_payload);
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  IF EXISTS (SELECT 1 FROM public.internal_transfers WHERE client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'This request ID predates payload-bound retries; verify the saved transfer before retrying.';
  END IF;

  v_result := public.record_internal_transfer_unbound_legacy(
    p_from_account, p_to_account, p_amount, p_transfer_date, p_notes, p_request_id
  );
  PERFORM public.rj_store_idempotency_result('internal_transfer', p_request_id, v_result);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_phone_purchase_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.create_phone_purchase_atomic_v2(p_payload);
$function$;

CREATE OR REPLACE FUNCTION public.create_expense_atomic(
  p_request_id uuid, p_category text, p_amount numeric, p_payment_mode text,
  p_expense_date timestamptz, p_description text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.create_expense_atomic_v2(p_request_id, p_category, p_amount, p_payment_mode, p_expense_date, p_description);
$function$;

CREATE OR REPLACE FUNCTION public.create_sale_atomic(
  p_phone_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text,
  p_selling_price numeric, p_discount numeric, p_payment_allocations jsonb,
  p_sale_date timestamptz, p_warranty_days integer, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.create_sale_atomic_v2(
    p_phone_id, p_customer_id, p_customer_name, p_customer_phone, p_selling_price,
    p_discount, p_payment_allocations, p_sale_date, p_warranty_days, p_notes, p_request_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_collection(
  p_receivable_id uuid, p_amount numeric, p_payment_mode text,
  p_collection_date timestamptz, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.record_customer_collection_v2(
    p_receivable_id, p_amount, p_payment_mode, p_collection_date, p_notes, p_request_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_payable_id uuid, p_amount numeric, p_payment_mode text,
  p_payment_date timestamptz, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.record_supplier_payment_v2(
    p_payable_id, p_amount, p_payment_mode, p_payment_date, p_notes, p_request_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_internal_transfer(
  p_from_account text, p_to_account text, p_amount numeric,
  p_transfer_date timestamptz, p_notes text, p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.record_internal_transfer_v2(
    p_from_account, p_to_account, p_amount, p_transfer_date, p_notes, p_request_id
  );
$function$;

REVOKE ALL ON FUNCTION public.rj_payload_sha256(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rj_claim_idempotency_request(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rj_store_idempotency_result(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_phone_purchase_atomic_unbound_legacy(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_expense_atomic_unbound_legacy(uuid, text, numeric, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sale_atomic_unbound_legacy(uuid, uuid, text, text, numeric, numeric, jsonb, timestamptz, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_customer_collection_unbound_legacy(uuid, numeric, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_supplier_payment_unbound_legacy(uuid, numeric, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_internal_transfer_unbound_legacy(text, text, numeric, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_phone_purchase_atomic_v2(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_expense_atomic_v2(uuid, text, numeric, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_sale_atomic_v2(uuid, uuid, text, text, numeric, numeric, jsonb, timestamptz, integer, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_customer_collection_v2(uuid, numeric, text, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_supplier_payment_v2(uuid, numeric, text, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_internal_transfer_v2(text, text, numeric, timestamptz, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_phone_purchase_atomic_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense_atomic_v2(uuid, text, numeric, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale_atomic_v2(uuid, uuid, text, text, numeric, numeric, jsonb, timestamptz, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_collection_v2(uuid, numeric, text, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment_v2(uuid, numeric, text, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_internal_transfer_v2(text, text, numeric, timestamptz, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_phone_purchase_atomic(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_expense_atomic(uuid, text, numeric, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_sale_atomic(uuid, uuid, text, text, numeric, numeric, jsonb, timestamptz, integer, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_customer_collection(uuid, numeric, text, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid, numeric, text, timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_internal_transfer(text, text, numeric, timestamptz, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_phone_purchase_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense_atomic(uuid, text, numeric, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale_atomic(uuid, uuid, text, text, numeric, numeric, jsonb, timestamptz, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_collection(uuid, numeric, text, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, timestamptz, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_internal_transfer(text, text, numeric, timestamptz, text, uuid) TO authenticated;

COMMIT;
