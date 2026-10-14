import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { areCountedQueryResultsComplete } from './countedQueryCompleteness.js';

const ROW_LIMIT = 5000;

function duplicateValues(rows, getValue) {
  const counts = new Map();
  rows.forEach(row => {
    const value = String(getValue(row) ?? '').trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].filter(([, count]) => count > 1);
}

function allocationTotal(allocations) {
  if (!Array.isArray(allocations)) return null;
  return allocations.reduce((sum, item) => {
    const amount = Number(item?.amount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : NaN;
  }, 0);
}

export default function DataIntegrity({ onNavigate }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [scannedAt, setScannedAt] = useState(null);
  const [partialScan, setPartialScan] = useState(false);

  const runChecks = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');

    const specs = [
      ['phones', 'id, stock_code, imei_1, imei_2, status, purchase_price, repair_cost, other_cost, supplier_id, seller_name, purchase_payment_allocations, archived_at'],
      ['sales', 'id, invoice_no, phone_id, customer_id, selling_price, discount, payment_allocations, payment_mode, returned_at'],
      ['stock_movements', 'id, phone_id, movement_type, quantity, reference_id, movement_date'],
      ['money_transactions', 'id, transaction_type, amount, category, payment_mode, reference_id'],
      ['expenses', 'id, amount, category'],
      ['repairs', 'id, phone_id, labour_cost, parts_cost, status'],
      ['customer_receivables', 'id, sale_id, customer_id, balance'],
      ['customer_collections', 'id'],
      ['supplier_payables', 'id, phone_id, supplier_id, payee_name, balance'],
      ['supplier_payments', 'id'],
      ['internal_transfers', 'id'],
      ['sale_returns', 'id'],
    ];

    try {
      const results = await Promise.all(specs.map(async ([table, columns]) => {
        const result = await supabase.from(table).select(columns, { count: 'exact' }).limit(ROW_LIMIT);
        if (result.error) throw new Error(`${table}: ${result.error.message}`);
        return { table, rows: result.data || [], data: result.data, count: result.count, error: result.error };
      }));
      const tables = Object.fromEntries(results.map(result => [result.table, result.rows]));
      const wasTruncated = !areCountedQueryResultsComplete(results);
      const phones = tables.phones;
      const sales = tables.sales;
      const movements = tables.stock_movements;
      const transactions = tables.money_transactions;
      const activeSales = sales.filter(sale => !sale.returned_at);
      const phoneIds = new Set(phones.map(phone => phone.id));
      const phoneById = new Map(phones.map(phone => [phone.id, phone]));
      const activeSaleByPhone = new Map();
      activeSales.forEach(sale => {
        if (!activeSaleByPhone.has(sale.phone_id)) activeSaleByPhone.set(sale.phone_id, []);
        activeSaleByPhone.get(sale.phone_id).push(sale);
      });

      const nextIssues = [];
      const add = (severity, title, count, detail, module) => {
        if (count > 0) nextIssues.push({ severity, title, count, detail, module });
      };

      add('error', 'Available phones referenced by active sales',
        phones.filter(phone => phone.status === 'Available' && (activeSaleByPhone.get(phone.id) || []).length > 0).length,
        'Review the sale and current stock status. This scan does not change either record.', 'inventory');
      add('error', 'Sold phones without an active sale',
        phones.filter(phone => phone.status === 'Sold' && (activeSaleByPhone.get(phone.id) || []).length === 0).length,
        'Legacy returns and manually changed statuses may need review.', 'inventory');
      add('error', 'Active sales whose phone is not marked Sold',
        activeSales.filter(sale => phoneById.get(sale.phone_id)?.status !== 'Sold').length,
        'A valid active sale should leave its linked phone in Sold status.', 'inventory');
      add('error', 'Sales without a linked phone',
        activeSales.filter(sale => !phoneIds.has(sale.phone_id)).length,
        'This can indicate a historical orphan; inspect the sale before taking action.', 'invoices');
      add('error', 'Stock movements without a linked phone',
        movements.filter(movement => !phoneIds.has(movement.phone_id)).length,
        'The movement references a phone ID that is not present in the scanned phone records.', 'stock_movements');

      const repeatedInvoiceNos = duplicateValues(sales, sale => sale.invoice_no);
      add('error', 'Duplicate invoice numbers', repeatedInvoiceNos.length,
        repeatedInvoiceNos.slice(0, 5).map(([number, count]) => `${number} (${count})`).join(', '), 'invoices');
      add('error', 'Duplicate stock codes', duplicateValues(phones, phone => phone.stock_code).length,
        'Stock codes should identify one phone each.', 'inventory');

      const imeiValues = phones.flatMap(phone => [phone.imei_1, phone.imei_2]
        .map(value => String(value || '').trim()).filter(Boolean));
      const imeiCounts = new Map();
      imeiValues.forEach(value => imeiCounts.set(value, (imeiCounts.get(value) || 0) + 1));
      add('error', 'Duplicate IMEI values across either IMEI field',
        [...imeiCounts.values()].filter(count => count > 1).length,
        'Review the affected records before correcting any IMEI.', 'inventory');

      const customersQuery = await supabase.from('customers').select('id', { count: 'exact' }).limit(ROW_LIMIT);
      if (customersQuery.error) throw new Error(`customers: ${customersQuery.error.message}`);
      const knownCustomers = new Set((customersQuery.data || []).map(customer => customer.id));
      add('error', 'Sales with a missing customer reference',
        activeSales.filter(sale => sale.customer_id && !knownCustomers.has(sale.customer_id)).length,
        'A customer reference exists on the sale but does not resolve to a customer record.', 'customers');
      add('warning', 'Sales with customer due but no customer',
        activeSales.filter(sale => Array.isArray(sale.payment_allocations)
          && sale.payment_allocations.some(item => item?.account === 'Due') && !sale.customer_id).length,
        'Only sales with saved payment allocations are checked; legacy due records need separate reconciliation.', 'customers');

      const saleMovementCounts = new Map();
      const purchaseMovementCounts = new Map();
      movements.forEach(movement => {
        if (movement.movement_type === 'Sale' && movement.reference_id) {
          saleMovementCounts.set(movement.reference_id, (saleMovementCounts.get(movement.reference_id) || 0) + 1);
        }
        if (movement.movement_type === 'Purchase') {
          purchaseMovementCounts.set(movement.phone_id, (purchaseMovementCounts.get(movement.phone_id) || 0) + 1);
        }
      });
      add('error', 'Active sales without a sale stock movement',
        activeSales.filter(sale => !saleMovementCounts.has(sale.id)).length,
        'Sale movement rows should be created by the database sale automation.', 'stock_movements');
      add('warning', 'Phones without exactly one purchase movement',
        phones.filter(phone => purchaseMovementCounts.get(phone.id) !== 1).length,
        'Legacy inventory may predate the purchase movement trigger; verify before adding a correction.', 'stock_movements');
      add('error', 'Duplicate sale stock movements for one sale',
        [...saleMovementCounts.values()].filter(count => count > 1).length,
        'The same sale reference has multiple Sale movement rows.', 'stock_movements');

      const expenseIds = new Set(tables.expenses.map(expense => expense.id));
      const expenseReferenceCounts = new Map();
      transactions.forEach(transaction => {
        if (transaction.reference_id && expenseIds.has(transaction.reference_id)) {
          expenseReferenceCounts.set(transaction.reference_id, (expenseReferenceCounts.get(transaction.reference_id) || 0) + 1);
        }
      });
      add('warning', 'Expenses without exactly one linked ledger transaction',
        tables.expenses.filter(expense => expenseReferenceCounts.get(expense.id) !== 1).length,
        'The expense automation should create one money transaction per expense.', 'expenses');
      add('warning', 'Money transactions without reference IDs',
        transactions.filter(transaction => !transaction.reference_id).length,
        'Some manual adjustments may legitimately have no source reference; review the category and notes.', 'cashbook');
      const referencedEntityIds = new Set([
        ...phones.map(row => row.id), ...sales.map(row => row.id), ...tables.expenses.map(row => row.id),
        ...tables.customer_collections.map(row => row.id), ...tables.supplier_payments.map(row => row.id),
        ...tables.internal_transfers.map(row => row.id), ...tables.sale_returns.map(row => row.id),
      ]);
      add('warning', 'Money transactions with references to no scanned business record',
        transactions.filter(transaction => transaction.reference_id && !referencedEntityIds.has(transaction.reference_id)).length,
        'A reference can be older than the scan window or belong to an unmodeled adjustment; review it before treating it as orphaned.', 'cashbook');

      const invalidSaleAllocations = activeSales.filter(sale => {
        if (!Array.isArray(sale.payment_allocations) || sale.payment_allocations.length === 0) return false;
        const total = allocationTotal(sale.payment_allocations);
        return !Number.isFinite(total) || Math.abs(total - (Number(sale.selling_price) - Number(sale.discount))) > 0.005;
      });
      add('error', 'Sales with mismatched payment allocation totals', invalidSaleAllocations.length,
        'Legacy sales without saved allocations are excluded from this check.', 'invoices');
      const invalidPurchaseAllocations = phones.filter(phone => {
        if (!Array.isArray(phone.purchase_payment_allocations) || phone.purchase_payment_allocations.length === 0) return false;
        const total = allocationTotal(phone.purchase_payment_allocations);
        return !Number.isFinite(total) || Math.abs(total
          - (Number(phone.purchase_price || 0) + Number(phone.repair_cost || 0) + Number(phone.other_cost || 0))) > 0.005;
      });
      add('error', 'Purchases with mismatched payment allocation totals', invalidPurchaseAllocations.length,
        'Legacy purchases without saved allocations are excluded from this check.', 'suppliers');

      const paidAllocationTotal = allocations => allocations
        .filter(item => item?.account !== 'Due')
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const linkedTransactionTotal = (referenceId, category) => transactions
        .filter(row => row.reference_id === referenceId && row.category === category)
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const newSalesWithLedgerMismatch = activeSales.filter(sale => Array.isArray(sale.payment_allocations)
        && sale.payment_allocations.length > 0
        && Math.abs(linkedTransactionTotal(sale.id, 'Mobile Sale') - paidAllocationTotal(sale.payment_allocations)) > 0.005);
      add('error', 'Sales whose paid allocation does not match sale ledger entries', newSalesWithLedgerMismatch.length,
        'Only sales with saved allocation data are checked; fully due sales correctly have no cash/UPI/bank sale receipt.', 'cashbook');
      const newPurchasesWithLedgerMismatch = phones.filter(phone => Array.isArray(phone.purchase_payment_allocations)
        && phone.purchase_payment_allocations.length > 0
        && Math.abs(linkedTransactionTotal(phone.id, 'Mobile Purchase') - paidAllocationTotal(phone.purchase_payment_allocations)) > 0.005);
      add('error', 'Purchases whose paid allocation does not match purchase ledger entries', newPurchasesWithLedgerMismatch.length,
        'Only purchases with saved allocation data are checked; purchase dues are held in supplier payables.', 'cashbook');

      const repairTotals = new Map();
      tables.repairs.filter(repair => repair.status === 'Completed').forEach(repair => {
        repairTotals.set(repair.phone_id, (repairTotals.get(repair.phone_id) || 0)
          + Number(repair.labour_cost || 0) + Number(repair.parts_cost || 0));
      });
      add('warning', 'Completed repair totals exceed the phone repair-cost field',
        phones.filter(phone => (repairTotals.get(phone.id) || 0) > Number(phone.repair_cost || 0)).length,
        'Initial repair costs may be included in the phone field, so this only flags cases where recorded completed repairs exceed it.', 'repairs');
      add('warning', 'Supplier payables without supplier or payee name',
        tables.supplier_payables.filter(payable => !payable.supplier_id && !String(payable.payee_name || '').trim()).length,
        'A due exists but its counterparty label is missing.', 'suppliers');
      add('error', 'Negative customer receivable balances',
        tables.customer_receivables.filter(row => Number(row.balance) < 0).length,
        'Review the receivable and linked collection ledger.', 'customers');
      add('error', 'Negative supplier payable balances',
        tables.supplier_payables.filter(row => Number(row.balance) < 0).length,
        'Review the payable and linked payment ledger.', 'suppliers');

      setIssues(nextIssues);
      setPartialScan(wasTruncated || !areCountedQueryResultsComplete([customersQuery]));
      setScannedAt(new Date());
    } catch (error) {
      setIssues([]);
      setErrorMessage(error.message || 'The data integrity scan could not be completed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runChecks();
    const refresh = () => runChecks();
    window.addEventListener('rj-data-updated', refresh);
    return () => window.removeEventListener('rj-data-updated', refresh);
  }, [runChecks]);

  const errorCount = issues.filter(issue => issue.severity === 'error').reduce((total, issue) => total + issue.count, 0);
  const warningCount = issues.filter(issue => issue.severity === 'warning').reduce((total, issue) => total + issue.count, 0);

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'Inter, sans-serif', color: '#0f172a' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Data Integrity</h2>
          <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>Read-only checks across inventory, sales, ledger, expenses, repairs, and balances.</p>
        </div>
        <button type="button" onClick={runChecks} disabled={loading} style={{ border: 0, borderRadius: 7, background: '#2563eb', color: '#fff', padding: '10px 14px', fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Scanning…' : 'Run scan again'}
        </button>
      </header>

      {errorMessage && <div role="alert" style={{ padding: 14, borderRadius: 8, background: '#fee2e2', color: '#991b1b', marginBottom: 16 }}>
        <b>Scan failed.</b> {errorMessage} Confirm the ERP migration is applied and the signed-in account can read the required tables, then retry.
      </div>}

      {!errorMessage && <>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Error findings</div><strong style={{ fontSize: 24, color: errorCount ? '#b91c1c' : '#15803d' }}>{loading ? '…' : errorCount}</strong></div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Review findings</div><strong style={{ fontSize: 24, color: warningCount ? '#b45309' : '#15803d' }}>{loading ? '…' : warningCount}</strong></div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Last scan</div><strong style={{ fontSize: 14 }}>{scannedAt ? scannedAt.toLocaleString('en-IN') : 'Not run'}</strong></div>
        </section>
        {partialScan && <p role="note" style={{ color: '#92400e', background: '#fef3c7', borderRadius: 8, padding: 12, fontSize: 13 }}>At least one table exceeded the {ROW_LIMIT.toLocaleString()}-row scan limit or its exact row count could not be verified. Findings may be incomplete.</p>}
        <p style={{ color: '#475569', fontSize: 12, marginBottom: 14 }}>This checker reports possible inconsistencies. It never edits records. Some checks intentionally skip historical rows that lack payment-allocation data.</p>
        <section style={{ display: 'grid', gap: 10 }}>
          {loading && <div style={{ background: '#fff', padding: 18, borderRadius: 8, color: '#2563eb' }}>Reading business records…</div>}
          {!loading && issues.length === 0 && <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: 18, borderRadius: 8 }}>No issues were found in the records scanned.</div>}
          {!loading && issues.map((issue, index) => (
            <article key={`${issue.title}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: '#fff', border: `1px solid ${issue.severity === 'error' ? '#fecaca' : '#fde68a'}`, borderLeft: `4px solid ${issue.severity === 'error' ? '#dc2626' : '#d97706'}`, borderRadius: 8, padding: 14 }}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <strong>{issue.title}</strong>
                  <span style={{ fontWeight: 800, color: issue.severity === 'error' ? '#b91c1c' : '#b45309' }}>{issue.count}</span>
                </div>
                <p style={{ color: '#64748b', fontSize: 12, margin: '5px 0 0' }}>{issue.detail}</p>
              </div>
              {onNavigate && <button type="button" onClick={() => onNavigate(issue.module)} style={{ border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', padding: '7px 10px', cursor: 'pointer', fontWeight: 600 }}>Open related module</button>}
            </article>
          ))}
        </section>
      </>}
    </main>
  );
}
