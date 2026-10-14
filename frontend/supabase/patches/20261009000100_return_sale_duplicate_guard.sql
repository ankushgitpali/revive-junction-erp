BEGIN;

DO $return_guard_preflight$
DECLARE
  v_table text;
  v_required record;
  v_relation regclass;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'sales', 'phones', 'repairs', 'customer_receivables', 'customer_collections',
    'sale_returns', 'money_transactions', 'stock_movements'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'Return guard patch stopped: required relation public.% is missing.', v_table;
    END IF;
  END LOOP;

  FOR v_required IN
    SELECT * FROM (VALUES
      ('sales', 'id'), ('sales', 'phone_id'), ('sales', 'selling_price'),
      ('sales', 'discount'), ('sales', 'payment_mode'), ('sales', 'payment_allocations'),
      ('sales', 'invoice_no'), ('sales', 'returned_at'),
      ('phones', 'id'), ('phones', 'status'), ('phones', 'archived_at'), ('phones', 'updated_at'),
      ('repairs', 'phone_id'), ('repairs', 'status'),
      ('customer_receivables', 'sale_id'), ('customer_receivables', 'balance'),
      ('customer_receivables', 'closed_at'),
      ('customer_collections', 'receivable_id'), ('customer_collections', 'payment_mode'),
      ('customer_collections', 'amount'),
      ('sale_returns', 'sale_id'), ('sale_returns', 'phone_id'), ('sale_returns', 'refund_amount'),
      ('sale_returns', 'refund_allocations'), ('sale_returns', 'notes'), ('sale_returns', 'created_by'),
      ('money_transactions', 'transaction_type'), ('money_transactions', 'category'),
      ('money_transactions', 'amount'), ('money_transactions', 'payment_mode'),
      ('money_transactions', 'reference_id'), ('money_transactions', 'transaction_date'),
      ('money_transactions', 'notes'),
      ('stock_movements', 'phone_id'), ('stock_movements', 'movement_type'),
      ('stock_movements', 'quantity'), ('stock_movements', 'reference_id'),
      ('stock_movements', 'movement_date'), ('stock_movements', 'notes')
    ) AS required(table_name, column_name)
  LOOP
    v_relation := to_regclass(format('public.%I', v_required.table_name));
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = v_relation
        AND a.attname = v_required.column_name
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'Return guard patch stopped: required column public.%.% is missing.',
        v_required.table_name, v_required.column_name;
    END IF;
  END LOOP;

  FOR v_required IN
    SELECT * FROM (VALUES
      ('phones', 'phones_status_check'),
      ('sales', 'sales_payment_mode_check'),
      ('repairs', 'repairs_status_check'),
      ('stock_movements', 'stock_movements_movement_type_check')
    ) AS expected(table_name, constraint_name)
  LOOP
    v_relation := to_regclass(format('public.%I', v_required.table_name));
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS c
      WHERE c.conrelid = v_relation
        AND c.conname = v_required.constraint_name
        AND c.contype = 'c'
    ) THEN
      RAISE EXCEPTION 'Return guard patch stopped: expected check constraint public.%.% is missing.',
        v_required.table_name, v_required.constraint_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS i
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = i.indrelid
     AND a.attnum = i.indkey[0]
     AND a.attname = 'sale_id'
     AND a.attnum > 0
     AND NOT a.attisdropped
    WHERE i.indrelid = 'public.sale_returns'::regclass
      AND i.indisunique
      AND i.indnkeyatts = 1
  ) THEN
    RAISE EXCEPTION 'Return guard patch stopped: public.sale_returns requires a single-column unique constraint or index on sale_id.';
  END IF;

  IF to_regprocedure('public.return_sale_atomic(uuid,text)') IS NULL
     OR (SELECT prorettype FROM pg_catalog.pg_proc
         WHERE oid = to_regprocedure('public.return_sale_atomic(uuid,text)'))
       IS DISTINCT FROM 'jsonb'::regtype
     OR (SELECT proargnames FROM pg_catalog.pg_proc
         WHERE oid = to_regprocedure('public.return_sale_atomic(uuid,text)'))
       IS DISTINCT FROM ARRAY['p_sale_id', 'p_notes']::text[]
     OR to_regprocedure('public.guard_phone_lifecycle_update()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS t
       WHERE t.tgrelid = 'public.phones'::regclass
         AND t.tgname = 'trg_guard_phone_lifecycle_update'
         AND t.tgfoid = 'public.guard_phone_lifecycle_update()'::regprocedure
         AND NOT t.tgisinternal
         AND (t.tgtype & 1) = 0
         AND (t.tgtype & 2) = 2
         AND (t.tgtype & 16) = 16
         AND t.tgenabled <> 'D'
     ) THEN
    RAISE EXCEPTION 'Return guard patch stopped: expected core return and phone lifecycle functions are missing.';
  END IF;
END;
$return_guard_preflight$;

DO $phones_status_check$
DECLARE
  v_definition text;
  v_check_expression text;
  v_repair_allowed boolean;
BEGIN
  SELECT pg_get_constraintdef(oid, false)
  INTO v_definition
  FROM pg_constraint
  WHERE conrelid = 'public.phones'::regclass
    AND conname = 'phones_status_check'
    AND contype = 'c';

  IF FOUND THEN
    v_check_expression := substring(v_definition FROM '^CHECK \((.*)\)$');
    IF v_check_expression IS NULL THEN
      RAISE EXCEPTION 'Unable to safely extend public.phones.phones_status_check to support repair lifecycle.';
    END IF;

    EXECUTE format(
      'SELECT (%s)',
      replace(v_check_expression, 'status', quote_literal('Repair'))
    ) INTO v_repair_allowed;
    IF v_repair_allowed IS DISTINCT FROM true THEN
      ALTER TABLE public.phones DROP CONSTRAINT phones_status_check;
      EXECUTE format(
        'ALTER TABLE public.phones ADD CONSTRAINT phones_status_check CHECK ((%s) OR status = %L) NOT VALID',
        v_check_expression,
        'Repair'
      );
      ALTER TABLE public.phones VALIDATE CONSTRAINT phones_status_check;
    END IF;
  END IF;
END;
$phones_status_check$;

DO $sales_payment_mode_check$
DECLARE
  v_definition text;
  v_check_expression text;
  v_required_modes constant text[] := ARRAY['Cash', 'UPI', 'Bank', 'Due', 'Mixed'];
  v_missing_modes text[] := ARRAY[]::text[];
  v_payment_mode text;
  v_missing_values text;
  v_mode_allowed boolean;
BEGIN
  SELECT pg_get_constraintdef(oid, false)
  INTO v_definition
  FROM pg_constraint
  WHERE conrelid = 'public.sales'::regclass
    AND conname = 'sales_payment_mode_check'
    AND contype = 'c';

  IF FOUND THEN
    v_check_expression := substring(v_definition FROM '^CHECK \((.*)\)$');
    IF v_check_expression IS NULL THEN
      RAISE EXCEPTION 'Unable to safely extend public.sales.sales_payment_mode_check for sale payment modes.';
    END IF;

    FOREACH v_payment_mode IN ARRAY v_required_modes LOOP
      EXECUTE format(
        'SELECT (%s)',
        replace(v_check_expression, 'payment_mode', quote_literal(v_payment_mode))
      ) INTO v_mode_allowed;
      IF v_mode_allowed IS DISTINCT FROM true THEN
        v_missing_modes := array_append(v_missing_modes, v_payment_mode);
      END IF;
    END LOOP;

    IF cardinality(v_missing_modes) > 0 THEN
      SELECT string_agg(quote_literal(value), ', ' ORDER BY ordinal)
      INTO v_missing_values
      FROM unnest(v_missing_modes) WITH ORDINALITY AS missing(value, ordinal);

      ALTER TABLE public.sales DROP CONSTRAINT sales_payment_mode_check;
      EXECUTE format(
        'ALTER TABLE public.sales ADD CONSTRAINT sales_payment_mode_check CHECK ((%s) OR payment_mode IN (%s)) NOT VALID',
        v_check_expression,
        v_missing_values
      );
      ALTER TABLE public.sales VALIDATE CONSTRAINT sales_payment_mode_check;
    END IF;
  END IF;
END;
$sales_payment_mode_check$;

DO $repairs_status_check$
DECLARE
  v_definition text;
  v_check_expression text;
  v_required_statuses constant text[] := ARRAY[
    'Pending', 'In Progress', 'Completed', 'Cancelled'
  ];
  v_missing_statuses text[] := ARRAY[]::text[];
  v_repair_status text;
  v_status_allowed boolean;
  v_missing_values text;
BEGIN
  SELECT pg_get_constraintdef(oid, false)
  INTO v_definition
  FROM pg_constraint
  WHERE conrelid = 'public.repairs'::regclass
    AND conname = 'repairs_status_check'
    AND contype = 'c';

  IF FOUND THEN
    v_check_expression := substring(v_definition FROM '^CHECK \((.*)\)$');
    IF v_check_expression IS NULL THEN
      RAISE EXCEPTION 'Unable to safely extend public.repairs.repairs_status_check for repair lifecycle.';
    END IF;

    FOREACH v_repair_status IN ARRAY v_required_statuses LOOP
      EXECUTE format(
        'SELECT (%s)',
        replace(v_check_expression, 'status', quote_literal(v_repair_status))
      ) INTO v_status_allowed;
      IF v_status_allowed IS DISTINCT FROM true THEN
        v_missing_statuses := array_append(v_missing_statuses, v_repair_status);
      END IF;
    END LOOP;

    IF cardinality(v_missing_statuses) > 0 THEN
      SELECT string_agg(quote_literal(value), ', ' ORDER BY ordinal)
      INTO v_missing_values
      FROM unnest(v_missing_statuses) WITH ORDINALITY AS missing(value, ordinal);

      ALTER TABLE public.repairs DROP CONSTRAINT repairs_status_check;
      EXECUTE format(
        'ALTER TABLE public.repairs ADD CONSTRAINT repairs_status_check CHECK ((%s) OR status IN (%s)) NOT VALID',
        v_check_expression,
        v_missing_values
      );
      ALTER TABLE public.repairs VALIDATE CONSTRAINT repairs_status_check;
    END IF;
  END IF;
END;
$repairs_status_check$;

DO $stock_movement_type_check$
DECLARE
  v_definition text;
  v_check_expression text;
  v_required_types constant text[] := ARRAY[
    'Purchase', 'Sale', 'Repair Out', 'Repair In', 'Return', 'Archive', 'Restore'
  ];
  v_missing_types text[] := ARRAY[]::text[];
  v_movement_type text;
  v_missing_values text;
  v_type_allowed boolean;
BEGIN
  SELECT pg_get_constraintdef(oid, false)
  INTO v_definition
  FROM pg_constraint
  WHERE conrelid = 'public.stock_movements'::regclass
    AND conname = 'stock_movements_movement_type_check'
    AND contype = 'c';

  IF FOUND THEN
    v_check_expression := substring(v_definition FROM '^CHECK \((.*)\)$');
    IF v_check_expression IS NULL THEN
      RAISE EXCEPTION 'Unable to safely extend public.stock_movements.stock_movements_movement_type_check for inventory workflows.';
    END IF;

    FOREACH v_movement_type IN ARRAY v_required_types LOOP
      EXECUTE format(
        'SELECT (%s)',
        replace(v_check_expression, 'movement_type', quote_literal(v_movement_type))
      ) INTO v_type_allowed;
      IF v_type_allowed IS DISTINCT FROM true THEN
        v_missing_types := array_append(v_missing_types, v_movement_type);
      END IF;
    END LOOP;

    IF cardinality(v_missing_types) > 0 THEN
      SELECT string_agg(quote_literal(value), ', ' ORDER BY ordinal)
      INTO v_missing_values
      FROM unnest(v_missing_types) WITH ORDINALITY AS missing(value, ordinal);

      ALTER TABLE public.stock_movements
        DROP CONSTRAINT stock_movements_movement_type_check;
      EXECUTE format(
        'ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK ((%s) OR movement_type IN (%s)) NOT VALID',
        v_check_expression,
        v_missing_values
      );
      ALTER TABLE public.stock_movements
        VALIDATE CONSTRAINT stock_movements_movement_type_check;
    END IF;
  END IF;
END;
$stock_movement_type_check$;

CREATE OR REPLACE FUNCTION public.return_sale_atomic(p_sale_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_receivable public.customer_receivables%ROWTYPE;
  v_has_receivable boolean := false;
  v_refund numeric;
  v_refunds jsonb;
  v_item jsonb;
  v_return_id uuid := gen_random_uuid();
  v_previous_lifecycle_setting text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in is required.'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found or was already returned.';
  END IF;
  IF v_sale.returned_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.sale_returns WHERE sale_id = v_sale.id) THEN
    RAISE EXCEPTION 'Sale was not found or was already returned.';
  END IF;
  PERFORM 1 FROM public.phones WHERE id = v_sale.phone_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.repairs
    WHERE phone_id = v_sale.phone_id AND lower(status) IN ('pending', 'in progress')
  ) THEN
    RAISE EXCEPTION 'Complete or cancel the active repair before returning this phone to available stock.';
  END IF;

  SELECT * INTO v_receivable FROM public.customer_receivables WHERE sale_id = v_sale.id FOR UPDATE;
  v_has_receivable := FOUND;
  IF (jsonb_array_length(COALESCE(v_sale.payment_allocations, '[]'::jsonb)) = 0
      AND v_sale.payment_mode = 'Due')
     OR (jsonb_array_length(COALESCE(v_sale.payment_allocations, '[]'::jsonb)) > 0
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_sale.payment_allocations) AS x(item)
        WHERE item ->> 'account' = 'Due'
      ) AND NOT v_has_receivable) THEN
    RAISE EXCEPTION 'This sale has an unverified due balance. Reconcile its payment history before returning it.';
  END IF;
  v_refund := (v_sale.selling_price - v_sale.discount)
    - CASE WHEN v_has_receivable THEN v_receivable.balance ELSE 0 END;
  IF v_refund < 0 THEN
    RAISE EXCEPTION 'The recorded customer due exceeds the sale total. Reconcile the balance before returning it.';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('account', account, 'amount', amount) ORDER BY account), '[]'::jsonb)
  INTO v_refunds
  FROM (
    SELECT account, SUM(amount) AS amount
    FROM (
      SELECT item ->> 'account' AS account, (item ->> 'amount')::numeric AS amount
      FROM jsonb_array_elements(COALESCE(v_sale.payment_allocations, '[]'::jsonb)) AS x(item)
      WHERE item ->> 'account' IN ('Cash', 'UPI', 'Bank')
      UNION ALL
      SELECT CASE WHEN v_sale.payment_mode = 'Mixed' THEN 'Cash' ELSE v_sale.payment_mode END,
        v_sale.selling_price - v_sale.discount
      WHERE jsonb_array_length(COALESCE(v_sale.payment_allocations, '[]'::jsonb)) = 0
        AND v_sale.payment_mode IN ('Cash', 'UPI', 'Bank', 'Mixed')
      UNION ALL
      SELECT payment_mode AS account, amount
      FROM public.customer_collections
      WHERE receivable_id = v_receivable.id
    ) AS received
    GROUP BY account
  ) AS totals;

  IF COALESCE((
    SELECT SUM((item ->> 'amount')::numeric)
    FROM jsonb_array_elements(v_refunds) AS x(item)
  ), 0) <> v_refund THEN
    RAISE EXCEPTION 'Recorded payment allocations do not match the refundable amount. Reconcile before returning it.';
  END IF;

  INSERT INTO public.sale_returns (id, sale_id, phone_id, refund_amount, refund_allocations, notes, created_by)
  VALUES (v_return_id, v_sale.id, v_sale.phone_id, v_refund, v_refunds, NULLIF(BTRIM(p_notes), ''), auth.uid());

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_refunds) AS x(value) LOOP
    INSERT INTO public.money_transactions (transaction_type, category, amount, payment_mode, reference_id, transaction_date, notes)
    VALUES ('Expense', 'Sale Refund', (v_item ->> 'amount')::numeric, v_item ->> 'account', v_return_id, now(), 'Refund for invoice ' || v_sale.invoice_no);
  END LOOP;

  IF v_has_receivable THEN
    UPDATE public.customer_receivables SET balance = 0, closed_at = now() WHERE id = v_receivable.id;
  END IF;
  UPDATE public.sales SET returned_at = now() WHERE id = v_sale.id;
  v_previous_lifecycle_setting := current_setting('rj.lifecycle_write', true);
  PERFORM set_config('rj.lifecycle_write', 'on', true);
  UPDATE public.phones SET status = 'Available', archived_at = NULL, updated_at = now() WHERE id = v_sale.phone_id;
  PERFORM set_config('rj.lifecycle_write', COALESCE(v_previous_lifecycle_setting, ''), true);
  INSERT INTO public.stock_movements (phone_id, movement_type, quantity, reference_id, movement_date, notes)
  VALUES (v_sale.phone_id, 'Return', 1, v_return_id, now(), 'Returned sale ' || v_sale.invoice_no);

  RETURN jsonb_build_object('return_id', v_return_id, 'refund_amount', v_refund, 'refund_allocations', v_refunds);
END;
$function$;

REVOKE ALL ON FUNCTION public.return_sale_atomic(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_sale_atomic(uuid, text) TO authenticated;

COMMIT;
