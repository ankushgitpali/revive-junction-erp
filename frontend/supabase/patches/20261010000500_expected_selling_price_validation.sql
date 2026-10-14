-- Staging-only candidate patch.
-- Enforces the same finite, non-negative, two-decimal expected-price contract
-- as the current phone-purchase workflow without rewriting any existing rows.
BEGIN;

DO $preflight$
DECLARE
  v_phones regclass := to_regclass('public.phones');
BEGIN
  IF v_phones IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_class AS c
    WHERE c.oid = v_phones
      AND c.relkind IN ('r', 'p')
  ) THEN
    RAISE EXCEPTION 'Expected-price validation stopped: public.phones is not an existing table.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = v_phones
      AND attname = 'expected_selling_price'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Expected-price validation stopped: public.phones.expected_selling_price is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = v_phones
      AND attname = 'expected_selling_price'
      AND atttypid = 'numeric'::regtype
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Expected-price validation stopped: public.phones.expected_selling_price must have numeric type.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = v_phones
      AND conname = 'phones_expected_selling_price_finite_check'
  ) THEN
    RAISE EXCEPTION 'Expected-price validation stopped: the named constraint already exists; inspect and verify it before continuing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.phones
    WHERE expected_selling_price IS NOT NULL
      AND (
        expected_selling_price < 0
        OR expected_selling_price::text IN ('NaN', 'Infinity', '-Infinity')
        OR expected_selling_price <> round(expected_selling_price, 2)
      )
  ) THEN
    RAISE EXCEPTION 'Expected-price validation stopped: existing rows contain invalid prices. Reconcile them before applying this patch; this script will not alter rows.';
  END IF;
END;
$preflight$;

ALTER TABLE public.phones
  ADD CONSTRAINT phones_expected_selling_price_finite_check
  CHECK (
    expected_selling_price IS NULL
    OR (
      expected_selling_price >= 0
      AND expected_selling_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND expected_selling_price = round(expected_selling_price, 2)
    )
  ) NOT VALID;

ALTER TABLE public.phones
  VALIDATE CONSTRAINT phones_expected_selling_price_finite_check;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.phones'::regclass
      AND conname = 'phones_expected_selling_price_finite_check'
      AND contype = 'c'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'Expected-price validation failed: the check constraint is absent or not validated.';
  END IF;
END;
$verify$;

COMMIT;
