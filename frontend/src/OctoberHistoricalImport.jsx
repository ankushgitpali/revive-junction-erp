import { useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import {
  getHistoricalImportOperations,
  getProjectRef,
  HISTORICAL_IMPORT_PROJECT_REF,
  isMatchingImportPhone,
  isMatchingImportSale,
  historicalPhoneImports,
  verifyImportSaleState,
} from './historicalImportPlan.js';

const operations = getHistoricalImportOperations();
const operationKeys = operations.map(operation => operation.key);

function initialOperationState() {
  return Object.fromEntries(operationKeys.map(key => [key, { status: 'pending' }]));
}

export default function OctoberHistoricalImport() {
  const projectRef = useMemo(() => getProjectRef(supabase.supabaseUrl), []);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [operationState, setOperationState] = useState(initialOperationState);
  const [summary, setSummary] = useState('');
  const runningRef = useRef(false);

  const allowedProject = projectRef === HISTORICAL_IMPORT_PROJECT_REF;
  const completedCount = Object.values(operationState).filter(item => item.status === 'verified').length;
  const unresolvedPurchases = historicalPhoneImports.filter(record => {
    const purchase = operationState[`${record.key}:purchase`];
    const sale = operationState[`${record.key}:sale`];
    return purchase.status === 'verified' && sale.status !== 'verified';
  });

  const updateOperation = (key, update) => {
    setOperationState(previous => ({
      ...previous,
      [key]: { ...previous[key], ...update },
    }));
  };

  async function findSingle(table, column, value, select) {
    const result = await supabase.from(table).select(select).eq(column, value).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  async function preflight() {
    if (!allowedProject) throw new Error('The detected Supabase project does not match the required production project.');
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error('An authenticated user session is required.');

    const records = new Map();
    for (const record of historicalPhoneImports) {
      const byRequest = await findSingle(
        'phones',
        'client_request_id',
        record.purchaseRequestId,
        'id, client_request_id, stock_code, brand, model, variant, storage, ram, imei_1, imei_2, purchase_price, repair_cost, other_cost, expected_selling_price, purchase_date, purchase_payment_allocations, notes, status',
      );
      const byStockCode = await findSingle(
        'phones',
        'stock_code',
        record.stockCode,
        'id, client_request_id, stock_code, brand, model, variant, storage, ram, imei_1, imei_2, purchase_price, repair_cost, other_cost, expected_selling_price, purchase_date, purchase_payment_allocations, notes, status',
      );
      if (Boolean(byRequest) !== Boolean(byStockCode)
        || (byRequest && byRequest.id !== byStockCode.id)
        || (byRequest && !isMatchingImportPhone(byRequest, record))) {
        throw new Error(`Existing phone data conflicts with import ${record.stockCode}; no operation was started.`);
      }
      const sale = await findSingle(
        'sales',
        'client_request_id',
        record.saleRequestId,
        'id, client_request_id, phone_id, selling_price, discount, payment_mode, payment_allocations, sale_date, notes, invoice_no, returned_at',
      );
      if (sale && (!byRequest || !isMatchingImportSale(sale, record, byRequest.id))) {
        throw new Error(`Existing sale data conflicts with import ${record.stockCode}; no operation was started.`);
      }
      if (byRequest && !isMatchingImportPhone(byRequest, record, sale ? 'Sold' : 'Available')) {
        const expectedStatus = sale ? 'Sold' : 'Available';
        throw new Error(`Phone ${record.stockCode} has status "${byRequest.status || 'unknown'}"; expected "${expectedStatus}" for its saved import records. No operation was started.`);
      }
      records.set(record.key, { phone: byRequest, sale });
    }
    return records;
  }

  async function verifyPhone(record, rpcPhoneId) {
    const phone = await findSingle(
      'phones',
      'client_request_id',
      record.purchaseRequestId,
      'id, client_request_id, stock_code, brand, model, variant, storage, ram, imei_1, imei_2, purchase_price, repair_cost, other_cost, expected_selling_price, purchase_date, purchase_payment_allocations, notes, status',
    );
    if (!isMatchingImportPhone(phone, record, 'Available') || phone.id !== rpcPhoneId) {
      throw new Error(`Purchase ${record.stockCode} could not be verified from the saved phone record.`);
    }
    return phone;
  }

  async function verifySoldPhone(record, sale) {
    const phone = await findSingle('phones', 'id', sale.phone_id, 'id, status');
    const state = verifyImportSaleState(sale, phone, record);
    if (!state.verified) throw new Error(`${record.stockCode}: ${state.reason}`);
  }

  async function createOrVerifyPurchase(record, knownPhone) {
    if (knownPhone) return knownPhone;
    const payload = {
      client_request_id: record.purchaseRequestId,
      stock_code: record.stockCode,
      brand: record.brand,
      model: record.model,
      variant: record.variant,
      storage: record.storage,
      ram: record.ram,
      imei_1: record.imei1,
      imei_2: record.imei2,
      purchase_price: record.purchasePrice,
      repair_cost: record.repairCost,
      other_cost: record.otherCost,
      expected_selling_price: record.expectedSellingPrice,
      purchase_date: record.purchaseDate,
      purchase_payment_allocations: [{
        account: 'Cash',
        amount: record.purchasePrice + record.repairCost + record.otherCost,
      }],
      notes: record.notes,
    };
    const { data, error } = await supabase.rpc('create_phone_purchase_atomic', { p_payload: payload });
    if (error) {
      const saved = await findSingle(
        'phones',
        'client_request_id',
        record.purchaseRequestId,
        'id, client_request_id, stock_code, brand, model, variant, storage, ram, imei_1, imei_2, purchase_price, repair_cost, other_cost, expected_selling_price, purchase_date, purchase_payment_allocations, notes, status',
      );
      if (!isMatchingImportPhone(saved, record, 'Available')) throw error;
      return saved;
    }
    if (!data?.phone_id) throw new Error(`Purchase RPC returned no phone UUID for ${record.stockCode}.`);
    return verifyPhone(record, data.phone_id);
  }

  async function createOrVerifySale(record, phone, knownSale) {
    if (knownSale) {
      const state = verifyImportSaleState(knownSale, phone, record);
      if (!state.verified) throw new Error(`${record.stockCode}: ${state.reason}`);
      await verifySoldPhone(record, knownSale);
      return knownSale;
    }
    const { data, error } = await supabase.rpc('create_sale_atomic', {
      p_phone_id: phone.id,
      p_customer_id: null,
      p_customer_name: null,
      p_customer_phone: null,
      p_selling_price: record.sellingPrice,
      p_discount: record.discount,
      p_payment_allocations: [{ account: 'Cash', amount: record.sellingPrice - record.discount }],
      p_sale_date: record.saleDate,
      p_warranty_days: 0,
      p_notes: record.notes,
      p_request_id: record.saleRequestId,
    });
    if (error) {
      const saved = await findSingle(
        'sales',
        'client_request_id',
        record.saleRequestId,
        'id, client_request_id, phone_id, selling_price, discount, payment_mode, payment_allocations, sale_date, notes, invoice_no, returned_at',
      );
      const state = verifyImportSaleState(saved, await findSingle('phones', 'id', phone.id, 'id, status'), record);
      if (!state.verified) throw new Error(`${record.stockCode}: ${state.reason}`);
      return saved;
    }
    if (!data?.sale_id) throw new Error(`Sale RPC returned no sale UUID for ${record.stockCode}.`);
    const sale = await findSingle(
      'sales',
      'client_request_id',
      record.saleRequestId,
      'id, client_request_id, phone_id, selling_price, discount, payment_mode, payment_allocations, sale_date, notes, invoice_no, returned_at',
    );
    const state = verifyImportSaleState(sale, await findSingle('phones', 'id', phone.id, 'id, status'), record);
    if (!state.verified || sale.id !== data.sale_id) {
      throw new Error(`${record.stockCode}: ${state.reason || 'The sale RPC ID does not match the saved sale.'}`);
    }
    return sale;
  }

  async function executeImport() {
    if (runningRef.current) return;
    if (!allowedProject) {
      setSummary('Execution blocked: the configured project does not match the required project reference.');
      return;
    }
    if (!confirmed) {
      setSummary('Execution blocked: review the ten-operation preview and explicitly confirm first.');
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setSummary('Checking authenticated session and existing records before any writes…');

    try {
      const existing = await preflight();
      for (const record of historicalPhoneImports) {
        const purchaseKey = `${record.key}:purchase`;
        const saleKey = `${record.key}:sale`;
        let phone = existing.get(record.key).phone;
        let sale = existing.get(record.key).sale;

        updateOperation(purchaseKey, { status: 'running', message: 'Creating/confirming purchase…' });
        try {
          phone = await createOrVerifyPurchase(record, phone);
          updateOperation(purchaseKey, {
            status: 'verified',
            message: `Verified phone ${phone.id}`,
            phoneId: phone.id,
          });
        } catch (error) {
          updateOperation(purchaseKey, { status: 'failed', message: error.message });
          setSummary(`Stopped at purchase ${record.stockCode}. No later operations were attempted.`);
          return;
        }

        updateOperation(saleKey, { status: 'running', message: 'Creating/confirming sale for the exact purchased phone…' });
        try {
          sale = await createOrVerifySale(record, phone, sale);
          updateOperation(saleKey, {
            status: 'verified',
            message: `Verified sale ${sale.id} · invoice ${sale.invoice_no || 'generated'}`,
            phoneId: phone.id,
          });
        } catch (error) {
          updateOperation(saleKey, { status: 'failed', message: error.message, phoneId: phone.id });
          setSummary(`Stopped at sale ${record.stockCode}. Its purchase is recorded as an unresolved orphan; retry this sale before considering the import complete.`);
          return;
        }
      }
      setSummary('All five purchases and all five corresponding sales were verified.');
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (error) {
      setSummary(`Preflight failed before import operations began: ${error.message}`);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  const allVerified = completedCount === operations.length;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, color: '#0f172a' }}>
      <h2 style={{ marginTop: 0 }}>October 2026 Historical Import</h2>
      <div role="note" style={{ padding: 14, marginBottom: 16, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, color: '#9a3412' }}>
        One-time historical entry. All listed dates are estimates, not verified actual dates. IMEI fields will be blank; every record will state that its placeholder requires verification. No customer, invoice, or warranty promises will be invented.
      </div>
      <section style={{ padding: 14, marginBottom: 18, borderRadius: 8, background: allowedProject ? '#ecfdf5' : '#fef2f2', border: `1px solid ${allowedProject ? '#86efac' : '#fecaca'}` }}>
        <strong>Configured Supabase project reference:</strong>{' '}
        <code>{projectRef || 'Unable to detect from configured Supabase URL'}</code>
        <div>{allowedProject ? 'Target verified. Execution can be enabled after explicit confirmation.' : `Writes are blocked; required project reference is ${HISTORICAL_IMPORT_PROJECT_REF}.`}</div>
      </section>

      <h3>Preview — ten RPC operations, in sequence</h3>
      <ol style={{ paddingLeft: 26 }}>
        {operations.map((operation, index) => {
          const record = operation.record;
          const purchase = operation.kind === 'Purchase';
          const amount = purchase
            ? record.purchasePrice + record.repairCost + record.otherCost
            : record.sellingPrice - record.discount;
          const date = purchase ? record.purchaseDate : record.saleDate;
          const state = operationState[operation.key];
          return (
            <li key={operation.key} style={{ marginBottom: 10 }}>
              <strong>{index + 1}. {operation.kind}: {record.brand} {record.model}{record.variant ? ` (${record.variant})` : ''} — {record.stockCode}</strong>
              <div>{purchase
                ? `Purchase date: ${date}; purchase ₹${record.purchasePrice.toLocaleString('en-IN')}; repair ₹${record.repairCost.toLocaleString('en-IN')}; other ₹${record.otherCost.toLocaleString('en-IN')}; expected sale ₹${record.expectedSellingPrice.toLocaleString('en-IN')}; Cash allocation ₹${amount.toLocaleString('en-IN')}. IMEI fields blank.`
                : `Sale date: ${date}; sale ₹${record.sellingPrice.toLocaleString('en-IN')}; discount ₹${record.discount.toLocaleString('en-IN')}; Cash allocation ₹${amount.toLocaleString('en-IN')}; warranty days 0; no customer details.`}</div>
              <div>{record.notes}</div>
              <div role="status">{state.status}{state.message ? ` — ${state.message}` : ''}</div>
            </li>
          );
        })}
      </ol>

      {unresolvedPurchases.length > 0 && (
        <div role="alert" style={{ padding: 14, marginBottom: 14, color: '#991b1b', background: '#fee2e2', borderRadius: 8 }}>
          Unresolved purchase(s): {unresolvedPurchases.map(record => {
            const phoneId = operationState[`${record.key}:purchase`].phoneId;
            return `${record.stockCode} (${phoneId || 'phone UUID unavailable'})`;
          }).join(', ')}. The import is not complete; retry and verify the associated sale.
        </div>
      )}

      <label style={{ display: 'block', margin: '18px 0' }}>
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={running || allVerified} />{' '}
        I reviewed all ten operations, understand the dates are estimates, and authorize this one-time import to the verified project.
      </label>
      <button type="button" onClick={executeImport} disabled={!allowedProject || !confirmed || running || allVerified}
        style={{ padding: '11px 18px', border: 0, borderRadius: 7, background: !allowedProject || !confirmed || running || allVerified ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 700 }}>
        {running ? 'Import running…' : allVerified ? 'All ten operations verified' : completedCount ? 'Retry remaining operations' : 'Execute one-time import'}
      </button>
      {summary && <p role="status" style={{ marginTop: 14, fontWeight: 700 }}>{summary}</p>}
    </main>
  );
}
