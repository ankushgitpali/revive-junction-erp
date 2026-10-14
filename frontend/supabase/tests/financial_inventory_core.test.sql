-- Run only in a disposable Supabase project after all ERP migrations, including payload-bound idempotency.
-- Every row created below is inside one transaction that is rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

DO $test$
DECLARE
  v_purchase jsonb;
  v_purchase_retry jsonb;
  v_purchase_payload jsonb;
  v_duplicate_imei_payload jsonb;
  v_sale jsonb;
  v_retry jsonb;
  v_return_record public.sale_returns%ROWTYPE;
  v_phone_id uuid;
  v_sale_id uuid;
  v_receivable_id uuid;
  v_payable_id uuid;
  v_expense_id uuid;
  v_transfer_id uuid;
  v_repair_id uuid;
  v_cancel_repair_id uuid;
  v_customer_id uuid;
  v_sale_request uuid := gen_random_uuid();
  v_purchase_request uuid := gen_random_uuid();
  v_collection_request uuid := gen_random_uuid();
  v_supplier_payment_request uuid := gen_random_uuid();
  v_transfer_request uuid := gen_random_uuid();
  v_expense_request uuid := gen_random_uuid();
  v_sale_date timestamptz := now();
  v_result jsonb;
  v_rejected boolean;
  v_error text;
  v_count integer;
  v_amount numeric;
  v_opening_balance numeric;
  v_cash_in numeric;
  v_cash_out numeric;
  v_cash_out_before_return numeric;
  v_closing_balance numeric;
  v_invoice text;
  v_test_imei text := 'TEST-IMEI-' || gen_random_uuid()::text;
  v_mode text;
  v_mode_allocations jsonb;
  v_mode_purchase jsonb;
  v_mode_sale jsonb;
  v_mode_phone_id uuid;
  v_mode_sale_id uuid;
  v_mode_customer_id uuid;
  v_mode_due numeric;
  v_mode_paid numeric;
  v_mode_rows integer;
  v_mode_payables integer;
  v_mode_payable numeric;
  v_mode_purchase_due numeric;
  v_invoice_phone jsonb;
  v_invoice_phone_id uuid;
  v_duplicate_invoice_rejected boolean;
  v_mode_request uuid;
  v_mode_count integer;
  v_mode_expected_paid numeric;
  v_mode_expected_due numeric;
  v_mode_return jsonb;
  v_cash_base_in numeric := 0;
  v_cash_base_out numeric := 0;
  v_rpc record;
  v_invalid_purchase_payload jsonb;
BEGIN
  FOR v_rpc IN
    SELECT * FROM (VALUES
      (
        'public.create_phone_purchase_atomic_v2(jsonb)',
        'public.create_phone_purchase_atomic(jsonb)',
        'public.create_phone_purchase_atomic_unbound_legacy(jsonb)'
      ),
      (
        'public.create_expense_atomic_v2(uuid,text,numeric,text,timestamptz,text)',
        'public.create_expense_atomic(uuid,text,numeric,text,timestamptz,text)',
        'public.create_expense_atomic_unbound_legacy(uuid,text,numeric,text,timestamptz,text)'
      ),
      (
        'public.create_sale_atomic_v2(uuid,uuid,text,text,numeric,numeric,jsonb,timestamptz,integer,text,uuid)',
        'public.create_sale_atomic(uuid,uuid,text,text,numeric,numeric,jsonb,timestamptz,integer,text,uuid)',
        'public.create_sale_atomic_unbound_legacy(uuid,uuid,text,text,numeric,numeric,jsonb,timestamptz,integer,text,uuid)'
      ),
      (
        'public.record_customer_collection_v2(uuid,numeric,text,timestamptz,text,uuid)',
        'public.record_customer_collection(uuid,numeric,text,timestamptz,text,uuid)',
        'public.record_customer_collection_unbound_legacy(uuid,numeric,text,timestamptz,text,uuid)'
      ),
      (
        'public.record_supplier_payment_v2(uuid,numeric,text,timestamptz,text,uuid)',
        'public.record_supplier_payment(uuid,numeric,text,timestamptz,text,uuid)',
        'public.record_supplier_payment_unbound_legacy(uuid,numeric,text,timestamptz,text,uuid)'
      ),
      (
        'public.record_internal_transfer_v2(text,text,numeric,timestamptz,text,uuid)',
        'public.record_internal_transfer(text,text,numeric,timestamptz,text,uuid)',
        'public.record_internal_transfer_unbound_legacy(text,text,numeric,timestamptz,text,uuid)'
      )
    ) AS expected(v2_signature, wrapper_signature, legacy_signature)
  LOOP
    IF to_regprocedure(v_rpc.v2_signature) IS NULL
       OR to_regprocedure(v_rpc.wrapper_signature) IS NULL
       OR to_regprocedure(v_rpc.legacy_signature) IS NULL THEN
      RAISE EXCEPTION 'Payload-bound RPC or protected legacy function is missing: %.',
        v_rpc.v2_signature;
    END IF;

    IF NOT has_function_privilege('authenticated', v_rpc.v2_signature, 'EXECUTE')
       OR has_function_privilege('anon', v_rpc.v2_signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_rpc.wrapper_signature, 'EXECUTE')
       OR has_function_privilege('anon', v_rpc.wrapper_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_rpc.legacy_signature, 'EXECUTE')
       OR has_function_privilege('anon', v_rpc.legacy_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'RPC privileges are incompatible for %.', v_rpc.v2_signature;
    END IF;
  END LOOP;

  SELECT cash_in, cash_out INTO v_cash_base_in, v_cash_base_out
  FROM public.cashbook_account_summary(v_sale_date - interval '1 day', v_sale_date + interval '1 day')
  WHERE account = 'Cash';
  v_cash_base_in := COALESCE(v_cash_base_in, 0);
  v_cash_base_out := COALESCE(v_cash_base_out, 0);

  v_invalid_purchase_payload := jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'stock_code', 'RJ-TEST-' || left(gen_random_uuid()::text, 12),
    'brand', 'Test Brand', 'model', 'Invalid Expected Price Test', 'condition', 'Good',
    'purchase_price', 100, 'repair_cost', 0, 'other_cost', 0,
    'expected_selling_price', 'NaN',
    'purchase_payment_allocations', jsonb_build_array(
      jsonb_build_object('account', 'Cash', 'amount', 100)
    )
  );
  v_rejected := false;
  BEGIN
    PERFORM public.create_phone_purchase_atomic_v2(v_invalid_purchase_payload);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'Phone costs and expected selling price must be finite non-negative amounts with at most two decimal places.' THEN
      RAISE;
    END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A non-finite expected selling price was accepted.';
  END IF;

  -- Purchase: one phone, one Purchase movement, Cash ledger plus supplier due.
  v_purchase_payload := jsonb_build_object(
    'client_request_id', v_purchase_request,
    'stock_code', 'RJ-TEST-' || left(gen_random_uuid()::text, 12),
    'brand', 'Test Brand', 'model', 'Atomic Test Phone', 'condition', 'Good',
    'imei_2', v_test_imei,
    'purchase_price', 1200, 'repair_cost', 200, 'other_cost', 100,
    'expected_selling_price', 2200, 'purchase_date', v_sale_date,
    'seller_name', 'Rollback Test Seller',
    'purchase_payment_allocations', jsonb_build_array(
      jsonb_build_object('account', 'Cash', 'amount', 1000),
      jsonb_build_object('account', 'Due', 'amount', 500)
    )
  );
  v_purchase := public.create_phone_purchase_atomic(v_purchase_payload);
  v_phone_id := (v_purchase ->> 'phone_id')::uuid;
  v_purchase_retry := public.create_phone_purchase_atomic_v2(v_purchase_payload);
  IF (v_purchase_retry ->> 'phone_id')::uuid <> v_phone_id THEN
    RAISE EXCEPTION 'Purchase retry did not return the original phone.';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.create_phone_purchase_atomic_v2(
      v_purchase_payload || jsonb_build_object('notes', 'Different request payload')
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Purchase retry with a changed payload was accepted.'; END IF;

  v_duplicate_imei_payload := jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'stock_code', 'RJ-TEST-' || left(gen_random_uuid()::text, 12),
    'brand', 'Test Brand', 'model', 'Duplicate IMEI Test', 'condition', 'Good',
    'imei_1', 'TEST-DUPLICATE-IMEI-' || gen_random_uuid()::text, 'imei_2', v_test_imei,
    'purchase_price', 1, 'repair_cost', 0, 'other_cost', 0, 'purchase_date', v_sale_date,
    'purchase_payment_allocations', jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 1))
  );
  v_rejected := false;
  BEGIN
    PERFORM public.create_phone_purchase_atomic(v_duplicate_imei_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A duplicate IMEI across phone IMEI fields was accepted.'; END IF;

  -- A reused stock code must also be rejected while blank optional IMEIs remain valid.
  v_duplicate_imei_payload := jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'stock_code', v_purchase_payload ->> 'stock_code',
    'brand', 'Test Brand', 'model', 'Duplicate Stock Code Test', 'condition', 'Good',
    'purchase_price', 1, 'repair_cost', 0, 'other_cost', 0, 'purchase_date', v_sale_date,
    'purchase_payment_allocations', jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 1))
  );
  v_rejected := false;
  BEGIN
    PERFORM public.create_phone_purchase_atomic(v_duplicate_imei_payload);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A duplicate stock code was accepted.'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.normalize_payment_allocations(
      jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 9)), 10
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'An under-allocated transaction was accepted.'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.normalize_payment_allocations(
      jsonb_build_array(jsonb_build_object('account', 'Due', 'amount', 11)), 10
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'An over-allocated transaction was accepted.'; END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.phones SET status = 'Sold' WHERE id = v_phone_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A direct phone status change bypassed the audited sale workflow.'; END IF;

  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type = 'Purchase';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Purchase should create exactly one stock movement; found %.', v_count; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_amount FROM public.money_transactions
  WHERE reference_id = v_phone_id AND category = 'Mobile Purchase';
  IF v_amount <> 1000 THEN RAISE EXCEPTION 'Purchase cash allocation should post exactly 1000; found %.', v_amount; END IF;
  SELECT id INTO v_payable_id FROM public.supplier_payables WHERE phone_id = v_phone_id;
  IF NOT FOUND OR (SELECT balance FROM public.supplier_payables WHERE id = v_payable_id) <> 500 THEN
    RAISE EXCEPTION 'Purchase due should create one supplier payable for 500.';
  END IF;

  -- Sale: mixed payment, invoice uniqueness, sale-time cost snapshot, and retry idempotency.
  v_sale := public.create_sale_atomic(
    v_phone_id, NULL, 'Rollback Test Customer', NULL, 10000, 0,
    jsonb_build_array(
      jsonb_build_object('account', 'Cash', 'amount', 4000),
      jsonb_build_object('account', 'UPI', 'amount', 2000),
      jsonb_build_object('account', 'Due', 'amount', 4000)
    ), v_sale_date, 7, 'Rollback-only test sale', v_sale_request
  );
  v_sale_id := (v_sale ->> 'sale_id')::uuid;
  v_invoice := v_sale ->> 'invoice_no';
  v_customer_id := (v_sale ->> 'customer_id')::uuid;

  SELECT count(*) INTO v_count FROM public.sales WHERE id = v_sale_id AND invoice_no = v_invoice;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Sale invoice was not stored exactly once.'; END IF;
  IF (SELECT total_cost_snapshot FROM public.sales WHERE id = v_sale_id) <> 1500 THEN
    RAISE EXCEPTION 'Sale cost snapshot should equal 1500.';
  END IF;
  IF abs((SELECT margin_percent_snapshot FROM public.sales WHERE id = v_sale_id) - 85) > 0.000001 THEN
    RAISE EXCEPTION 'Sale margin snapshot should equal 85 percent.';
  END IF;
  IF (SELECT status FROM public.phones WHERE id = v_phone_id) <> 'Sold' THEN
    RAISE EXCEPTION 'Sale should mark the phone Sold.';
  END IF;
  IF (SELECT purchase_cost_snapshot + repair_cost_snapshot + other_cost_snapshot
      FROM public.sales WHERE id = v_sale_id) <> 1500 THEN
    RAISE EXCEPTION 'Sale cost snapshots do not match the phone costs at sale time.';
  END IF;
  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type = 'Sale' AND reference_id = v_sale_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Sale should create exactly one sale movement.'; END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_amount FROM public.money_transactions
  WHERE reference_id = v_sale_id AND category = 'Mobile Sale' AND transaction_type = 'Income';
  IF v_amount <> 6000 THEN RAISE EXCEPTION 'Sale should post 6000 received across Cash and UPI; found %.', v_amount; END IF;
  SELECT id INTO v_receivable_id FROM public.customer_receivables WHERE sale_id = v_sale_id;
  IF NOT FOUND OR (SELECT balance FROM public.customer_receivables WHERE id = v_receivable_id) <> 4000 THEN
    RAISE EXCEPTION 'Sale should create a customer receivable for 4000.';
  END IF;
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'A customer should be linked to a sale with due.'; END IF;

  v_retry := public.create_sale_atomic_v2(
    v_phone_id, NULL, 'Rollback Test Customer', NULL, 10000, 0,
    jsonb_build_array(
      jsonb_build_object('account', 'Cash', 'amount', 4000),
      jsonb_build_object('account', 'UPI', 'amount', 2000),
      jsonb_build_object('account', 'Due', 'amount', 4000)
    ), v_sale_date, 7, 'Rollback-only test sale', v_sale_request
  );
  IF v_retry ->> 'invoice_no' <> v_invoice THEN RAISE EXCEPTION 'Sale retry did not return the original invoice.'; END IF;
  SELECT count(*) INTO v_count FROM public.sales WHERE phone_id = v_phone_id AND returned_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Sale retry created a duplicate sale.'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_atomic_v2(
      v_phone_id, NULL, 'Rollback Test Customer', NULL, 10000, 0,
      jsonb_build_array(
        jsonb_build_object('account', 'Cash', 'amount', 4000),
        jsonb_build_object('account', 'UPI', 'amount', 2000),
        jsonb_build_object('account', 'Due', 'amount', 4000)
      ), v_sale_date, 7, 'Different request payload', v_sale_request
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Sale retry with a changed payload was accepted.'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_atomic(
      v_phone_id, NULL, 'Duplicate Test Customer', NULL, 10000, 0,
      jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 10000)),
      v_sale_date, 0, NULL, gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A second sale of a Sold phone was accepted.'; END IF;

  -- Repeated customer collection request must only reduce the receivable once.
  v_result := public.record_customer_collection_v2(v_receivable_id, 1500, 'UPI', v_sale_date, 'Rollback-only collection', v_collection_request);
  PERFORM public.record_customer_collection_v2(v_receivable_id, 1500, 'UPI', v_sale_date, 'Rollback-only collection', v_collection_request);
  IF (SELECT balance FROM public.customer_receivables WHERE id = v_receivable_id) <> 2500 THEN
    RAISE EXCEPTION 'Customer collection retry reduced the due more than once.';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.record_customer_collection_v2(
      v_receivable_id, 1500, 'UPI', v_sale_date, 'Changed retry payload', v_collection_request
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Customer collection retry with a changed payload was accepted.'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.record_customer_collection(
      v_receivable_id, 2500.01, 'Cash', v_sale_date, 'Over-collection attempt', gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A customer collection greater than the remaining due was accepted.'; END IF;
  SELECT count(*) INTO v_count FROM public.customer_collections WHERE client_request_id = v_collection_request;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Customer collection retry created duplicate records.'; END IF;

  -- Supplier payment retry must only reduce payable and ledger once.
  PERFORM public.record_supplier_payment_v2(v_payable_id, 200, 'Bank', v_sale_date, 'Rollback-only payment', v_supplier_payment_request);
  PERFORM public.record_supplier_payment_v2(v_payable_id, 200, 'Bank', v_sale_date, 'Rollback-only payment', v_supplier_payment_request);
  IF (SELECT balance FROM public.supplier_payables WHERE id = v_payable_id) <> 300 THEN
    RAISE EXCEPTION 'Supplier payment retry reduced the payable more than once.';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.record_supplier_payment_v2(
      v_payable_id, 200, 'Bank', v_sale_date, 'Changed retry payload', v_supplier_payment_request
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Supplier payment retry with a changed payload was accepted.'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.record_supplier_payment(
      v_payable_id, 300.01, 'Cash', v_sale_date, 'Over-payment attempt', gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A supplier payment greater than the remaining payable was accepted.'; END IF;
  SELECT count(*) INTO v_count FROM public.supplier_payments WHERE client_request_id = v_supplier_payment_request;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Supplier payment retry created duplicate records.'; END IF;

  -- Each supported expense account produces one expense and one trigger-created ledger row.
  FOREACH v_mode IN ARRAY ARRAY['Cash', 'UPI', 'Bank'] LOOP
    v_expense_request := gen_random_uuid();
    PERFORM public.create_expense_atomic_v2(v_expense_request, 'Test', 45.25, v_mode, v_sale_date, 'Rollback-only expense');
    IF v_mode = 'UPI' THEN
      PERFORM public.create_expense_atomic_v2(v_expense_request, 'Test', 45.25, v_mode, v_sale_date, 'Rollback-only expense');
      v_rejected := false;
      BEGIN
        PERFORM public.create_expense_atomic_v2(
          v_expense_request, 'Test', 45.25, v_mode, v_sale_date, 'Changed retry payload'
        );
      EXCEPTION WHEN OTHERS THEN
        v_rejected := true;
      END;
      IF NOT v_rejected THEN RAISE EXCEPTION 'Expense retry with a changed payload was accepted.'; END IF;
    END IF;
    SELECT id INTO v_expense_id FROM public.expenses WHERE client_request_id = v_expense_request;
    SELECT count(*) INTO v_count FROM public.money_transactions
    WHERE reference_id = v_expense_id AND transaction_type = 'Expense'
      AND category = 'Test' AND payment_mode = v_mode AND amount = 45.25;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Expense account % should create exactly one matching ledger transaction.', v_mode; END IF;
  END LOOP;
  v_rejected := false;
  BEGIN
    PERFORM public.create_expense_atomic(gen_random_uuid(), 'Test', 10, 'Due', v_sale_date, 'Invalid due expense');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'An expense paid by Due was accepted.'; END IF;

  -- A transfer moves account balances but is idempotent and does not create extra records.
  PERFORM public.record_internal_transfer_v2('Cash', 'Bank', 50, v_sale_date, 'Rollback-only transfer', v_transfer_request);
  PERFORM public.record_internal_transfer_v2('Cash', 'Bank', 50, v_sale_date, 'Rollback-only transfer', v_transfer_request);
  v_rejected := false;
  BEGIN
    PERFORM public.record_internal_transfer_v2(
      'Cash', 'Bank', 51, v_sale_date, 'Rollback-only transfer', v_transfer_request
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Internal transfer retry with a changed payload was accepted.'; END IF;
  SELECT id INTO v_transfer_id FROM public.internal_transfers WHERE client_request_id = v_transfer_request;
  SELECT count(*) INTO v_count FROM public.money_transactions WHERE reference_id = v_transfer_id;
  IF v_count <> 2 THEN RAISE EXCEPTION 'A transfer should create one paired ledger entry per account.'; END IF;
  IF (SELECT sum(CASE WHEN transaction_type = 'Income' THEN amount ELSE -amount END)
      FROM public.money_transactions WHERE reference_id = v_transfer_id) <> 0 THEN
    RAISE EXCEPTION 'An internal transfer must not change total business money.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.money_transactions WHERE reference_id = v_transfer_id
      AND category = 'Internal Transfer Out' AND payment_mode = 'Cash')
     OR NOT EXISTS (SELECT 1 FROM public.money_transactions WHERE reference_id = v_transfer_id
      AND category = 'Internal Transfer In' AND payment_mode = 'Bank') THEN
    RAISE EXCEPTION 'Cash-to-Bank transfer entries were not kept in separate accounts.';
  END IF;

  -- A return preserves the sale, refunds receipts only, clears the remaining due, and restores stock.
  SELECT COALESCE(sum(cash_out), 0) INTO v_cash_out_before_return
  FROM public.cashbook_account_summary(v_sale_date - interval '1 day', v_sale_date + interval '1 day');
  v_result := public.return_sale_atomic(v_sale_id, 'Rollback-only return');
  IF (v_result ->> 'refund_amount')::numeric <> 7500 THEN RAISE EXCEPTION 'Return refund amount should equal received amount of 7500.'; END IF;
  SELECT COALESCE(sum((item ->> 'amount')::numeric), 0) INTO v_amount
  FROM jsonb_array_elements(v_result -> 'refund_allocations') AS x(item)
  WHERE item ->> 'account' = 'Cash';
  IF v_amount <> 4000 THEN RAISE EXCEPTION 'Return should refund exactly 4000 to Cash.'; END IF;
  SELECT COALESCE(sum((item ->> 'amount')::numeric), 0) INTO v_amount
  FROM jsonb_array_elements(v_result -> 'refund_allocations') AS x(item)
  WHERE item ->> 'account' = 'UPI';
  IF v_amount <> 3500 THEN RAISE EXCEPTION 'Return should refund the 2000 UPI sale allocation plus the 1500 UPI collection.'; END IF;
  IF (SELECT balance FROM public.customer_receivables WHERE id = v_receivable_id) <> 0 THEN
    RAISE EXCEPTION 'Return should close the remaining customer due.';
  END IF;
  IF (SELECT status FROM public.phones WHERE id = v_phone_id) <> 'Available' THEN
    RAISE EXCEPTION 'Return should restore phone to Available.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE id = v_sale_id AND returned_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Return must preserve and mark the original sale.';
  END IF;
  SELECT count(*) INTO v_count FROM public.sale_returns WHERE sale_id = v_sale_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Return must create exactly one return audit record.'; END IF;
  SELECT count(*) INTO v_count FROM public.money_transactions
  WHERE reference_id = (v_result ->> 'return_id')::uuid AND category = 'Sale Refund';
  IF v_count <> 2 THEN RAISE EXCEPTION 'Mixed Cash/UPI return should post one refund entry per received account.'; END IF;
  SELECT COALESCE(sum(cash_out), 0) INTO v_cash_out
  FROM public.cashbook_account_summary(v_sale_date - interval '1 day', v_sale_date + interval '1 day');
  IF v_cash_out - v_cash_out_before_return <> 7500 THEN
    RAISE EXCEPTION 'Cashbook outflow should increase by the refund exactly once.';
  END IF;

  -- A return is rejected by returned_at even if its return record is missing.
  SELECT * INTO v_return_record FROM public.sale_returns WHERE sale_id = v_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The successful first return record was not found.'; END IF;
  DELETE FROM public.sale_returns WHERE sale_id = v_sale_id;
  v_rejected := false;
  v_error := NULL;
  BEGIN
    PERFORM public.return_sale_atomic(v_sale_id, 'Duplicate return attempt');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_rejected := true;
  END;
  IF v_rejected IS DISTINCT FROM true
     OR v_error IS DISTINCT FROM 'Sale was not found or was already returned.' THEN
    RAISE EXCEPTION 'A second return was not rejected by sales.returned_at.';
  END IF;

  -- An existing return record must also reject a sale whose returned_at is unset.
  INSERT INTO public.sale_returns (
    id, sale_id, phone_id, refund_amount, refund_allocations, return_date, notes, created_by, created_at
  ) VALUES (
    v_return_record.id, v_return_record.sale_id, v_return_record.phone_id, v_return_record.refund_amount,
    v_return_record.refund_allocations, v_return_record.return_date, v_return_record.notes,
    v_return_record.created_by, v_return_record.created_at
  );
  UPDATE public.sales SET returned_at = NULL WHERE id = v_sale_id;
  v_rejected := false;
  v_error := NULL;
  BEGIN
    PERFORM public.return_sale_atomic(v_sale_id, 'Duplicate return attempt');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_rejected := true;
  END;
  IF v_rejected IS DISTINCT FROM true
     OR v_error IS DISTINCT FROM 'Sale was not found or was already returned.' THEN
    RAISE EXCEPTION 'A second return was not rejected by its sale_returns record.';
  END IF;
  UPDATE public.sales SET returned_at = now() WHERE id = v_sale_id;

  SELECT count(*) INTO v_count FROM public.sale_returns WHERE sale_id = v_sale_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Duplicate return attempts changed the sale return record.'; END IF;
  SELECT count(*) INTO v_count FROM public.money_transactions
  WHERE reference_id = (v_result ->> 'return_id')::uuid AND category = 'Sale Refund';
  IF v_count <> 2 THEN RAISE EXCEPTION 'Duplicate return attempts changed the refund ledger.'; END IF;
  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type = 'Return' AND reference_id = (v_result ->> 'return_id')::uuid;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Duplicate return attempts changed return stock movements.'; END IF;
  IF (SELECT balance FROM public.customer_receivables WHERE id = v_receivable_id) <> 0 THEN
    RAISE EXCEPTION 'Duplicate return attempts changed the customer receivable.';
  END IF;

  INSERT INTO public.account_opening_balances (account, opening_amount, opening_date)
  VALUES ('Cash', 1000, v_sale_date - interval '1 day')
  ON CONFLICT (account) DO UPDATE
    SET opening_amount = EXCLUDED.opening_amount, opening_date = EXCLUDED.opening_date;
  SELECT opening_balance, cash_in, cash_out, closing_balance
  INTO v_opening_balance, v_cash_in, v_cash_out, v_closing_balance
  FROM public.cashbook_account_summary(v_sale_date - interval '1 day', v_sale_date + interval '1 day')
  WHERE account = 'Cash';
  IF v_opening_balance <> 1000
     OR v_cash_in - v_cash_base_in <> 4000
     OR v_cash_out - v_cash_base_out <> 5095.25
     OR v_closing_balance <> 1000 + v_cash_in - v_cash_out THEN
    RAISE EXCEPTION 'Cashbook reconciliation returned unexpected opening, movement, or closing values.';
  END IF;

  -- Completing a repair applies cost once; editing only its notes must not add it again.
  UPDATE public.phones SET repair_cost = 0 WHERE id = v_phone_id;
  INSERT INTO public.repairs (
    client_request_id, phone_id, issue, technician, labour_cost, parts_cost,
    status, started_at, completed_at, notes, created_at
  ) VALUES (
    gen_random_uuid(), v_phone_id, 'Rollback-only repair', NULL, 500, 300,
    'Pending', v_sale_date, NULL, 'Rollback-only repair test', v_sale_date
  )
  RETURNING id INTO v_repair_id;
  IF (SELECT status FROM public.phones WHERE id = v_phone_id) <> 'Repair' THEN
    RAISE EXCEPTION 'Starting a repair should move available stock to Repair.';
  END IF;
  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type = 'Repair Out' AND reference_id = v_repair_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Starting a repair should create one Repair Out movement.'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_atomic(
      v_phone_id, NULL, 'Repair Test Customer', NULL, 1000, 0,
      jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 1000)),
      v_sale_date, 0, NULL, gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A phone under repair was accepted for sale.'; END IF;
  UPDATE public.repairs SET status = 'In Progress' WHERE id = v_repair_id;
  IF (SELECT status FROM public.phones WHERE id = v_phone_id) <> 'Repair' THEN
    RAISE EXCEPTION 'An in-progress repair should keep the phone in Repair status.';
  END IF;
  UPDATE public.repairs SET status = 'Completed', completed_at = v_sale_date WHERE id = v_repair_id;
  UPDATE public.repairs SET notes = 'Edit after completion' WHERE id = v_repair_id;
  IF (SELECT repair_cost FROM public.phones WHERE id = v_phone_id) <> 800 THEN
    RAISE EXCEPTION 'Completed repair cost should be 800 and must be applied exactly once.';
  END IF;
  IF (SELECT total_cost_snapshot FROM public.sales WHERE id = v_sale_id) <> 1500 THEN
    RAISE EXCEPTION 'Changing phone repair cost altered the historical sale snapshot.';
  END IF;
  IF (SELECT status FROM public.phones WHERE id = v_phone_id) <> 'Available' THEN
    RAISE EXCEPTION 'Completing a repair should restore the phone to Available.';
  END IF;
  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type = 'Repair In' AND reference_id = v_repair_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Completing a repair should create one Repair In movement.'; END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.repairs SET parts_cost = 11.25 WHERE id = v_repair_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Completed repair cost edits were not blocked.'; END IF;

  INSERT INTO public.repairs (
    client_request_id, phone_id, issue, technician, labour_cost, parts_cost,
    status, started_at, completed_at, notes, created_at
  ) VALUES (
    gen_random_uuid(), v_phone_id, 'Rollback-only cancelled repair', NULL, 25, 15,
    'Pending', v_sale_date, NULL, 'Rollback-only cancellation test', v_sale_date
  )
  RETURNING id INTO v_cancel_repair_id;
  UPDATE public.repairs SET status = 'Cancelled' WHERE id = v_cancel_repair_id;
  IF (SELECT status FROM public.phones WHERE id = v_phone_id) <> 'Available' THEN
    RAISE EXCEPTION 'Cancelling a repair should restore the phone to Available.';
  END IF;
  IF (SELECT repair_cost FROM public.phones WHERE id = v_phone_id) <> 800 THEN
    RAISE EXCEPTION 'Cancelling a repair must not add its costs to the phone.';
  END IF;
  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type = 'Repair Out' AND reference_id = v_cancel_repair_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Starting a cancelled repair should create one Repair Out movement.'; END IF;
  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type = 'Repair In' AND reference_id = v_cancel_repair_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Cancelling a repair should create one Repair In movement.'; END IF;

  -- Archive and restore both keep an explicit movement record.
  PERFORM public.archive_phone_atomic(v_phone_id, 'Rollback-only archive');
  v_rejected := false;
  BEGIN
    PERFORM public.create_sale_atomic(
      v_phone_id, NULL, 'Archived Test Customer', NULL, 1000, 0,
      jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 1000)),
      v_sale_date, 0, NULL, gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'An archived phone was accepted for sale.'; END IF;
  PERFORM public.restore_phone_atomic(v_phone_id);
  SELECT count(*) INTO v_count FROM public.stock_movements
  WHERE phone_id = v_phone_id AND movement_type IN ('Purchase', 'Sale', 'Return', 'Archive', 'Restore');
  IF v_count <> 5 THEN RAISE EXCEPTION 'Purchase, sale, return, archive, and restore movements should each exist once; found %.', v_count; END IF;

  -- Exercise all purchase and sale payment modes through the actual atomic RPCs.
  FOREACH v_mode IN ARRAY ARRAY['Cash', 'UPI', 'Bank', 'Due', 'Mixed'] LOOP
    v_mode_request := gen_random_uuid();
    v_mode_allocations := CASE v_mode
      WHEN 'Cash' THEN jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 115))
      WHEN 'UPI' THEN jsonb_build_array(jsonb_build_object('account', 'UPI', 'amount', 115))
      WHEN 'Bank' THEN jsonb_build_array(jsonb_build_object('account', 'Bank', 'amount', 115))
      WHEN 'Due' THEN jsonb_build_array(jsonb_build_object('account', 'Due', 'amount', 115))
      ELSE jsonb_build_array(
        jsonb_build_object('account', 'Cash', 'amount', 15),
        jsonb_build_object('account', 'UPI', 'amount', 25),
        jsonb_build_object('account', 'Bank', 'amount', 30),
        jsonb_build_object('account', 'Due', 'amount', 45)
      )
    END;
    v_mode_purchase := public.create_phone_purchase_atomic(jsonb_build_object(
      'client_request_id', v_mode_request,
      'stock_code', 'RJ-MODE-' || v_mode || '-' || left(gen_random_uuid()::text, 8),
      'brand', 'Test Brand', 'model', 'Purchase Mode ' || v_mode, 'condition', 'Good',
      'purchase_price', 100, 'repair_cost', 10, 'other_cost', 5,
      'purchase_date', v_sale_date, 'seller_name', 'Rollback Mode Seller',
      'purchase_payment_allocations', v_mode_allocations
    ));
    v_mode_phone_id := (v_mode_purchase ->> 'phone_id')::uuid;

    SELECT COALESCE(sum((item ->> 'amount')::numeric), 0),
           COALESCE(sum((item ->> 'amount')::numeric) FILTER (WHERE item ->> 'account' = 'Due'), 0),
           count(*) FILTER (WHERE item ->> 'account' <> 'Due')
    INTO v_mode_paid, v_mode_due, v_mode_rows
    FROM jsonb_array_elements(v_mode_allocations) AS x(item);
    v_mode_purchase_due := v_mode_due;
    v_mode_paid := 115 - v_mode_due;
    SELECT count(*) INTO v_count FROM public.stock_movements
    WHERE phone_id = v_mode_phone_id AND movement_type = 'Purchase';
    IF v_count <> 1 THEN RAISE EXCEPTION 'Purchase mode % created % purchase movements.', v_mode, v_count; END IF;
    SELECT count(*) INTO v_count FROM public.money_transactions
    WHERE reference_id = v_mode_phone_id AND category = 'Mobile Purchase';
    IF v_count <> v_mode_rows THEN RAISE EXCEPTION 'Purchase mode % posted the wrong number of paid ledger allocations.', v_mode; END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_amount FROM public.money_transactions
    WHERE reference_id = v_mode_phone_id AND category = 'Mobile Purchase';
    IF v_amount <> v_mode_paid THEN RAISE EXCEPTION 'Purchase mode % paid amount should be %, found %.', v_mode, v_mode_paid, v_amount; END IF;
    SELECT count(*) INTO v_mode_payables FROM public.supplier_payables WHERE phone_id = v_mode_phone_id;
    IF (v_mode_due > 0 AND v_mode_payables <> 1)
       OR (v_mode_due = 0 AND v_mode_payables <> 0) THEN
      RAISE EXCEPTION 'Purchase mode % created an incorrect supplier payable count.', v_mode;
    END IF;
    IF v_mode_due > 0 THEN
      SELECT balance INTO v_mode_payable FROM public.supplier_payables WHERE phone_id = v_mode_phone_id;
      IF v_mode_payable <> v_mode_due THEN RAISE EXCEPTION 'Purchase mode % payable should be %, found %.', v_mode, v_mode_due, v_mode_payable; END IF;
    END IF;

    v_mode_sale := CASE v_mode
      WHEN 'Cash' THEN jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 190))
      WHEN 'UPI' THEN jsonb_build_array(jsonb_build_object('account', 'UPI', 'amount', 190))
      WHEN 'Bank' THEN jsonb_build_array(jsonb_build_object('account', 'Bank', 'amount', 190))
      WHEN 'Due' THEN jsonb_build_array(jsonb_build_object('account', 'Due', 'amount', 190))
      ELSE jsonb_build_array(
        jsonb_build_object('account', 'Cash', 'amount', 40),
        jsonb_build_object('account', 'UPI', 'amount', 50),
        jsonb_build_object('account', 'Bank', 'amount', 20),
        jsonb_build_object('account', 'Due', 'amount', 80)
      )
    END;
    SELECT COALESCE(sum((item ->> 'amount')::numeric) FILTER (WHERE item ->> 'account' <> 'Due'), 0),
           COALESCE(sum((item ->> 'amount')::numeric) FILTER (WHERE item ->> 'account' = 'Due'), 0),
           count(*) FILTER (WHERE item ->> 'account' <> 'Due')
    INTO v_mode_expected_paid, v_mode_expected_due, v_mode_rows
    FROM jsonb_array_elements(v_mode_sale) AS x(item);
    v_mode_sale_id := (public.create_sale_atomic(
      v_mode_phone_id, NULL, 'Rollback ' || v_mode || ' Customer', NULL, 200, 10,
      v_mode_sale, v_sale_date, 0, 'Payment mode test', gen_random_uuid()
    ) ->> 'sale_id')::uuid;
    IF (SELECT payment_mode FROM public.sales WHERE id = v_mode_sale_id) <> v_mode THEN
      RAISE EXCEPTION 'Sale payment mode % was not preserved.', v_mode;
    END IF;
    IF (SELECT total_cost_snapshot FROM public.sales WHERE id = v_mode_sale_id) <> 115
       OR (SELECT gross_profit_snapshot FROM public.sales WHERE id = v_mode_sale_id) <> 75 THEN
      RAISE EXCEPTION 'Sale mode % has incorrect cost/profit snapshots.', v_mode;
    END IF;
    SELECT count(*) INTO v_count FROM public.stock_movements
    WHERE phone_id = v_mode_phone_id AND movement_type = 'Sale'
      AND reference_id = v_mode_sale_id;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Sale mode % did not create exactly one stock movement.', v_mode; END IF;
    SELECT count(*) INTO v_count FROM public.money_transactions
    WHERE reference_id = v_mode_sale_id AND category = 'Mobile Sale';
    IF v_count <> v_mode_rows THEN RAISE EXCEPTION 'Sale mode % posted the wrong number of paid ledger allocations.', v_mode; END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_amount FROM public.money_transactions
    WHERE reference_id = v_mode_sale_id AND category = 'Mobile Sale';
    IF v_amount <> v_mode_expected_paid THEN RAISE EXCEPTION 'Sale mode % received %, expected %.', v_mode, v_amount, v_mode_expected_paid; END IF;
    SELECT count(*) INTO v_count FROM public.customer_receivables WHERE sale_id = v_mode_sale_id;
    IF (v_mode_expected_due > 0 AND v_count <> 1)
       OR (v_mode_expected_due = 0 AND v_count <> 0) THEN
      RAISE EXCEPTION 'Sale mode % created an incorrect receivable count.', v_mode;
    END IF;
    IF v_mode_expected_due > 0 THEN
      SELECT id, balance INTO v_mode_customer_id, v_mode_due
      FROM public.customer_receivables WHERE sale_id = v_mode_sale_id;
      IF v_mode_due <> v_mode_expected_due THEN RAISE EXCEPTION 'Sale mode % due should be %, found %.', v_mode, v_mode_expected_due, v_mode_due; END IF;
      IF v_mode = 'Due' THEN
        v_result := public.record_customer_collection(
          v_mode_customer_id, 190, 'Cash', v_sale_date, 'Full collection test', gen_random_uuid()
        );
        IF (v_result ->> 'remaining_due')::numeric <> 0 THEN
          RAISE EXCEPTION 'Full customer collection did not clear the due balance.';
        END IF;
      END IF;
    END IF;
    IF v_mode_payables = 1 THEN
      SELECT id INTO v_payable_id FROM public.supplier_payables WHERE phone_id = v_mode_phone_id;
      PERFORM public.record_supplier_payment(
        v_payable_id, v_mode_purchase_due, 'UPI', v_sale_date, 'Full supplier payment test', gen_random_uuid()
      );
      IF (SELECT balance FROM public.supplier_payables WHERE id = v_payable_id) <> 0 THEN
        RAISE EXCEPTION 'Full supplier payment did not clear the payable.';
      END IF;
    END IF;
  END LOOP;

  -- Legacy sale fixture: snapshots stay NULL and existing sale facts remain unchanged.
  UPDATE public.sales
  SET purchase_cost_snapshot = NULL, repair_cost_snapshot = NULL, other_cost_snapshot = NULL,
      total_cost_snapshot = NULL, gross_profit_snapshot = NULL, margin_percent_snapshot = NULL
  WHERE id = v_mode_sale_id;
  UPDATE public.phones
  SET purchase_price = COALESCE(purchase_price, 0) + 25
  WHERE id = (SELECT phone_id FROM public.sales WHERE id = v_mode_sale_id);
  IF (SELECT total_cost_snapshot FROM public.sales WHERE id = v_mode_sale_id) IS NOT NULL
     OR (SELECT selling_price FROM public.sales WHERE id = v_mode_sale_id) <> 200
     OR (SELECT purchase_price FROM public.phones
         WHERE id = (SELECT phone_id FROM public.sales WHERE id = v_mode_sale_id)) <> 125 THEN
    RAISE EXCEPTION 'Legacy sale fixture was unexpectedly backfilled or its original sale facts changed.';
  END IF;

  -- The UNIQUE invoice constraint must reject a conflicting invoice even on a different phone.
  v_invoice_phone := public.create_phone_purchase_atomic(jsonb_build_object(
    'client_request_id', gen_random_uuid(),
    'stock_code', 'RJ-INVOICE-' || left(gen_random_uuid()::text, 8),
    'brand', 'Test Brand', 'model', 'Invoice Conflict Test', 'condition', 'Good',
    'purchase_price', 1, 'repair_cost', 0, 'other_cost', 0, 'purchase_date', v_sale_date,
    'purchase_payment_allocations', jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 1))
  ));
  v_invoice_phone_id := (v_invoice_phone ->> 'phone_id')::uuid;
  v_duplicate_invoice_rejected := false;
  BEGIN
    INSERT INTO public.sales (
      phone_id, selling_price, discount, payment_mode, invoice_no, sale_date,
      warranty_days, payment_allocations
    ) VALUES (
      v_invoice_phone_id, 2, 0, 'Cash', v_invoice, v_sale_date, 0,
      jsonb_build_array(jsonb_build_object('account', 'Cash', 'amount', 2))
    );
  EXCEPTION WHEN unique_violation THEN
    v_duplicate_invoice_rejected := true;
  END;
  IF NOT v_duplicate_invoice_rejected THEN RAISE EXCEPTION 'A duplicate invoice number was accepted.'; END IF;
  IF (SELECT status FROM public.phones WHERE id = v_invoice_phone_id) <> 'Available' THEN
    RAISE EXCEPTION 'A failed duplicate-invoice insert changed phone status.';
  END IF;
END;
$test$;

ROLLBACK;
