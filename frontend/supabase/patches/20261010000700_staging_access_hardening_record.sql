-- Records the focused access hardening already applied and verified directly
-- on RJ-Staging-Test. Do not execute this file as part of the repository review.
-- Replay-safe statements are retained as an auditable record; no production
-- project is authorized by this patch.
BEGIN;

DROP POLICY IF EXISTS "Allow Public Delete" ON public.cash_ledger;
DROP POLICY IF EXISTS "Allow Public Delete" ON public.expenses;
DROP POLICY IF EXISTS "Allow Public Delete" ON public.phones;
DROP POLICY IF EXISTS "Allow Public Delete" ON public.sales;

REVOKE ALL PRIVILEGES ON TABLE
  public.cash_ledger,
  public.inventory,
  public.phone_profit_view
FROM anon;

REVOKE ALL PRIVILEGES ON SEQUENCE
  public.audit_log_id_seq,
  public.sales_invoice_seq
FROM anon;

REVOKE UPDATE ON SEQUENCE
  public.audit_log_id_seq,
  public.sales_invoice_seq
FROM authenticated;

REVOKE ALL ON FUNCTION public.rls_auto_enable()
FROM PUBLIC, anon, authenticated;

COMMIT;
