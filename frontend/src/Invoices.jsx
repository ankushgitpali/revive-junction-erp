import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { buildSaleAccountingEvents } from './pnlCalculations.js';
import { fetchAllRows } from './fetchAllRows.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const formatMoney = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatDate = value => value ? new Date(value).toLocaleDateString('en-IN') : 'N/A';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function warrantyDetails(sale, now = new Date()) {
  const start = new Date(sale.sale_date);
  if (Number.isNaN(start.getTime())) return { start: 'N/A', end: 'N/A', status: 'Date unavailable' };
  const days = Math.max(0, Number(sale.warranty_days) || 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return {
    start: formatDate(start),
    end: formatDate(end),
    status: days === 0 ? 'No warranty' : now <= end ? 'Active' : 'Expired',
  };
}

export default function Invoices() {
  const [sales, setSales] = useState([]);
  const [saleReturns, setSaleReturns] = useState([]);
  const [receivables, setReceivables] = useState({});
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [search, setSearch] = useState('');
  const [returnFilter, setReturnFilter] = useState('all');
  const [recordCount, setRecordCount] = useState(0);

  const fetchSalesData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [salesResult, returnsResult, dueResult, settingsResult] = await Promise.all([
      fetchAllRows(() => supabase.from('sales')
          .select('id, invoice_no, phone_id, customer_id, selling_price, discount, payment_mode, payment_allocations, sale_date, warranty_days, notes, returned_at, total_cost_snapshot, gross_profit_snapshot, phones(stock_code, brand, model, imei_1, purchase_price, repair_cost, other_cost), customers(name, phone)', { count: 'exact' })
        .order('sale_date', { ascending: false }).order('id', { ascending: true })),
      fetchAllRows(() => supabase.from('sale_returns').select('sale_id, return_date', { count: 'exact' }).order('sale_id', { ascending: true })),
        fetchAllRows(() => supabase.from('customer_receivables').select('sale_id, balance', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('business_settings').select('setting_key, setting_value', { count: 'exact' }).order('setting_key', { ascending: true })),
      ]);

      if (salesResult.error || returnsResult.error) throw salesResult.error || returnsResult.error;
      if (dueResult.error) throw dueResult.error;
      if (settingsResult.error) throw settingsResult.error;
      const rows = salesResult.data || [];
      const returnRows = returnsResult.data || [];
      if (rows.some(sale => !sale.phones)) {
        throw new Error('A sale has no linked phone record. Invoice totals were not displayed.');
      }
      const returns = returnRows;
      const returnsBySaleId = new Map(returns.map(saleReturn => [saleReturn.sale_id, saleReturn]));
      setSales(rows.map(sale => ({
        ...sale,
        returned_at: sale.returned_at || returnsBySaleId.get(sale.id)?.return_date || null,
        return_date: returnsBySaleId.get(sale.id)?.return_date || null,
      })));
      setSaleReturns(returns);
      setRecordCount(salesResult.count ?? rows.length);
      setReceivables(Object.fromEntries((dueResult.data || []).map(row => [row.sale_id, Number(row.balance) || 0])));
      setSettings(Object.fromEntries((settingsResult.data || []).map(row => [row.setting_key, row.setting_value])));
    } catch (error) {
      console.error('Error loading invoice records:', error.message);
      setSales([]);
      setSaleReturns([]);
      setRecordCount(0);
      setReceivables({});
      setErrorMsg(error.message || 'Invoice data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSalesData();
    const refresh = () => fetchSalesData();
    window.addEventListener('rj-data-updated', refresh);
    return () => window.removeEventListener('rj-data-updated', refresh);
  }, [fetchSalesData]);

  const chartData = useMemo(() => {
    const year = new Date().getFullYear();
    const now = new Date();
    const revenueByMonth = Array(12).fill(0);
    const grossProfitByMonth = Array(12).fill(0);

    const events = buildSaleAccountingEvents(
      sales,
      saleReturns,
      new Map(),
      value => {
        const date = new Date(value);
        return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date <= now;
      },
    );
    for (const event of events) {
      const month = new Date(event.date).getMonth();
      revenueByMonth[month] += event.revenueCents / 100;
      if (event.grossProfitCents !== null) grossProfitByMonth[month] += event.grossProfitCents / 100;
    }

    return {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      datasets: [
        { label: 'Net Revenue (₹)', data: revenueByMonth, backgroundColor: '#2563eb' },
        { label: 'Gross Profit (₹)', data: grossProfitByMonth, backgroundColor: '#059669' },
      ],
    };
  }, [sales, saleReturns]);

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sales.filter(sale => {
      if (returnFilter === 'active' && sale.returned_at) return false;
      if (returnFilter === 'returned' && !sale.returned_at) return false;
      if (!term) return true;
      return [sale.invoice_no, sale.customers?.name, sale.customers?.phone,
        sale.phones?.brand, sale.phones?.model, sale.phones?.stock_code]
        .some(value => String(value || '').toLowerCase().includes(term));
    });
  }, [returnFilter, sales, search]);

  const printInvoice = sale => {
    const phone = sale.phones || {};
    const customer = sale.customers || {};
    const net = Number(sale.selling_price) - Number(sale.discount);
    const due = receivables[sale.id] || 0;
    const warranty = warrantyDetails(sale);
    const allocations = Array.isArray(sale.payment_allocations) ? sale.payment_allocations : [];
    const paymentRows = allocations.length
      ? allocations.map(item => `<tr><td>${escapeHtml(item.account)}</td><td>${escapeHtml(formatMoney(item.amount))}</td></tr>`).join('')
      : `<tr><td>${escapeHtml(sale.payment_mode || 'Unknown')}<br><small>Historical payment split unavailable</small></td><td>${escapeHtml(formatMoney(net - due))}</td></tr>`;
    const businessName = settings.business_name || 'REVIVE JUNCTION';
    const ownerName = settings.owner_name || 'Ankush Gupta';
    const address = settings.business_address || '';
    const businessPhone = settings.business_phone || '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(sale.invoice_no)}</title>
      <style>body{font:14px Arial,sans-serif;color:#111827;margin:36px}header{border-bottom:2px solid #111827;padding-bottom:16px;margin-bottom:20px}h1{margin:0 0 4px;font-size:23px}.muted{color:#4b5563}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}.box{border:1px solid #d1d5db;padding:12px;border-radius:6px}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{padding:9px;border-bottom:1px solid #e5e7eb;text-align:left}.total{text-align:right;font-size:18px;font-weight:bold}.notes{white-space:pre-wrap}.footer{margin-top:28px;color:#4b5563;font-size:12px}@media print{body{margin:15mm}}</style></head><body>
      <header><h1>${escapeHtml(businessName)}</h1><div>${escapeHtml(ownerName)}</div><div class="muted">${escapeHtml(address)}</div>${businessPhone ? `<div>${escapeHtml(businessPhone)}</div>` : ''}</header>
      <div class="grid"><div class="box"><b>Invoice</b><div>${escapeHtml(sale.invoice_no)}</div><div>Date: ${escapeHtml(formatDate(sale.sale_date))}</div></div><div class="box"><b>Customer</b><div>${escapeHtml(customer.name || 'Walk-in Customer')}</div><div>${escapeHtml(customer.phone || '')}</div></div></div>
      <table><thead><tr><th>Phone</th><th>Stock code</th><th>IMEI</th><th>Amount</th></tr></thead><tbody><tr><td>${escapeHtml(`${phone.brand || ''} ${phone.model || ''}`.trim())}</td><td>${escapeHtml(phone.stock_code || '')}</td><td>${escapeHtml(phone.imei_1 || 'Not recorded')}</td><td>${escapeHtml(formatMoney(sale.selling_price))}</td></tr></tbody></table>
      <table><tbody><tr><td>Selling price</td><td>${escapeHtml(formatMoney(sale.selling_price))}</td></tr><tr><td>Discount</td><td>${escapeHtml(formatMoney(sale.discount))}</td></tr><tr><td><b>Net amount</b></td><td><b>${escapeHtml(formatMoney(net))}</b></td></tr><tr><td>Current outstanding due</td><td>${escapeHtml(formatMoney(due))}</td></tr></tbody></table>
      <h3>Payment breakdown</h3><table><thead><tr><th>Account</th><th>Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>
      <div class="box"><b>Warranty</b><div>Duration: ${escapeHtml(Number(sale.warranty_days) || 0)} days</div><div>Start: ${escapeHtml(warranty.start)}</div><div>End: ${escapeHtml(warranty.end)}</div><div>Status: ${escapeHtml(warranty.status)}</div></div>
      ${sale.notes ? `<p class="notes"><b>Notes:</b> ${escapeHtml(sale.notes)}</p>` : ''}<div class="footer">Thank you for your purchase.</div></body></html>`;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setErrorMsg('The invoice window was blocked. Allow pop-ups for this site and try again.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  };

  const returnSale = async sale => {
    const invoiceNo = sale.invoice_no || 'this sale';
    if (!window.confirm(`Return ${invoiceNo}? This preserves the sale and records the refund, due adjustment, stock return, and audit history.`)) return;
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const { error } = await supabase.rpc('return_sale_atomic', { p_sale_id: sale.id, p_notes: 'Returned from invoice history' });
      if (error) throw error;
      setSuccessMsg(`${invoiceNo} was returned. The original invoice remains in history.`);
      window.dispatchEvent(new CustomEvent('rj-data-updated'));
    } catch (error) {
      setErrorMsg(error.message || 'The sale could not be returned. No success was recorded.');
      setLoading(false);
    }
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: `Revenue vs Gross Profit — ${new Date().getFullYear()}` },
    },
  };

  return (
    <div style={{ padding: 24, maxWidth: 1250, margin: '0 auto', fontFamily: 'Inter, sans-serif', color: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
        <div><h2 style={{ margin: 0, fontSize: 22 }}>Invoices & Sales Analytics</h2><p style={{ margin: '5px 0 0', color: '#64748b', fontSize: 13 }}>Sales remain linked to the original phone and customer records.</p></div>
        <span style={{ fontSize: 12, color: '#065f46', background: '#dcfce7', padding: '7px 12px', borderRadius: 6, fontWeight: 700 }}>{recordCount} records</span>
      </div>

      {errorMsg && <div role="alert" style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 14 }}>{errorMsg}</div>}
      {successMsg && <div role="status" style={{ padding: 12, background: '#dcfce7', color: '#166534', borderRadius: 8, marginBottom: 14 }}>{successMsg}</div>}

      <section style={{ background: '#fff', padding: 20, borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 22 }}>
        {!errorMsg && <div style={{ height: 320 }}><Bar options={chartOptions} data={chartData} /></div>}
        {!errorMsg && sales.some(sale => !sale.returned_at && (sale.total_cost_snapshot === null || sale.total_cost_snapshot === undefined))
          && <p role="note" style={{ color: '#92400e', background: '#fff7ed', borderRadius: 7, padding: 10, fontSize: 12, marginBottom: 0 }}>Some older sales have no cost snapshot, so their chart profit uses the phone&apos;s current recorded costs.</p>}
      </section>

      <section style={{ background: '#fff', padding: 18, borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Invoice history</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input aria-label="Search invoices" placeholder="Search invoice, customer, phone…" value={search} onChange={event => setSearch(event.target.value)} style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '8px 10px', minWidth: 220 }} />
            <select aria-label="Return status" value={returnFilter} onChange={event => setReturnFilter(event.target.value)} style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '8px 10px' }}>
              <option value="all">All invoices</option><option value="active">Active sales</option><option value="returned">Returned sales</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead><tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
              <th style={{ padding: 10 }}>Invoice No</th><th style={{ padding: 10 }}>Customer</th><th style={{ padding: 10 }}>Phone / Item</th><th style={{ padding: 10 }}>Discount</th><th style={{ padding: 10 }}>Net total</th><th style={{ padding: 10 }}>Due</th><th style={{ padding: 10 }}>Warranty</th><th style={{ padding: 10 }}>Date / Status</th><th style={{ padding: 10 }}>Actions</th>
            </tr></thead>
            <tbody>
              {filteredSales.map(sale => {
                const warranty = warrantyDetails(sale);
                return <tr key={sale.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: sale.returned_at ? 0.68 : 1 }}>
                  <td style={{ padding: 10, fontWeight: 700 }}>{sale.invoice_no}</td>
                  <td style={{ padding: 10 }}>{sale.customers?.name || 'Walk-in Customer'}{sale.customers?.phone && <div style={{ color: '#64748b', fontSize: 11 }}>{sale.customers.phone}</div>}</td>
                  <td style={{ padding: 10 }}>{sale.phones?.brand} {sale.phones?.model}<div style={{ color: '#64748b', fontSize: 11 }}>{sale.phones?.stock_code}</div></td>
                  <td style={{ padding: 10 }}>{formatMoney(sale.discount)}</td>
                  <td style={{ padding: 10, color: '#059669', fontWeight: 700 }}>{formatMoney(Number(sale.selling_price) - Number(sale.discount))}</td>
                  <td style={{ padding: 10, color: receivables[sale.id] > 0 ? '#b45309' : '#64748b' }}>{formatMoney(receivables[sale.id])}</td>
                  <td style={{ padding: 10 }} title={`${warranty.start} – ${warranty.end}`}>{Number(sale.warranty_days) || 0} days · {warranty.status}</td>
                  <td style={{ padding: 10 }}>{formatDate(sale.sale_date)}{sale.returned_at && <div style={{ color: '#b91c1c', fontWeight: 700, fontSize: 11 }}>Returned {formatDate(sale.returned_at)}</div>}</td>
                  <td style={{ padding: 10, whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => printInvoice(sale)} style={{ marginRight: 6, padding: '6px 8px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 5, cursor: 'pointer' }}>Print</button>
                    {!sale.returned_at && <button type="button" onClick={() => returnSale(sale)} disabled={loading} style={{ padding: '6px 8px', border: 0, background: '#fee2e2', color: '#991b1b', borderRadius: 5, cursor: loading ? 'wait' : 'pointer' }}>Return</button>}
                  </td>
                </tr>;
              })}
              {!loading && filteredSales.length === 0 && <tr><td colSpan="9" style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>{errorMsg ? 'Invoice data could not be loaded.' : 'No matching invoice records found.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {loading && <div style={{ padding: 14, color: '#2563eb', fontWeight: 700 }}>Loading invoices…</div>}
      </section>
    </div>
  );
}
