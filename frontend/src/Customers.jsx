import React, { useRef, useState, useEffect } from 'react';
import { supabase } from './supabase';
import { clearRequestToken, getRequestToken } from './requestTokens';
import { fetchAllRows } from './fetchAllRows.js';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadError, setLoadError] = useState('');
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', notes: '' });
  const [collectionDrafts, setCollectionDrafts] = useState({});
  const collectionRequest = useRef(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [customersResult, salesResult, receivablesResult, collectionsResult] = await Promise.all([
        fetchAllRows(() => supabase.from('customers').select('id, name, phone, notes, created_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sales').select('id, invoice_no, phone_id, customer_id, selling_price, discount, payment_mode, sale_date, returned_at, warranty_days, phones(brand, model, imei_1), customers(name, phone)', { count: 'exact' }).order('sale_date', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('customer_receivables').select('id, sale_id, customer_id, original_amount, balance, created_at, customers(name, phone), sales(invoice_no, sale_date, phones(brand, model))', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('customer_collections').select('id, customer_id, amount, payment_mode, collection_date, notes, customers(name)', { count: 'exact' }).order('collection_date', { ascending: false }).order('id', { ascending: true })),
      ]);

      if (customersResult.error) throw customersResult.error;
      if (salesResult.error) throw salesResult.error;
      if (receivablesResult.error) throw receivablesResult.error;
      if (collectionsResult.error) throw collectionsResult.error;

      setCustomers(customersResult.data);
      setSales(salesResult.data);
      setReceivables(receivablesResult.data);
      setCollections(collectionsResult.data);
      setLoadError('');
    } catch (err) {
      console.error('Error fetching customers:', err);
      setCustomers([]);
      setSales([]);
      setReceivables([]);
      setCollections([]);
      setLoadError(err.message || 'Customer sales history could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const refresh = () => loadData();
    window.addEventListener('rj-data-updated', refresh);
    return () => window.removeEventListener('rj-data-updated', refresh);
  }, []);

  const handleAddCustomer = async (event) => {
    event.preventDefault();
    if (saving || !newCustomer.name.trim()) return;
    setSaving(true);
    setLoadError('');
    try {
      const { error } = await supabase.from('customers').insert({
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || null,
        notes: newCustomer.notes.trim() || null,
      });
      if (error) throw error;
      setNewCustomer({ name: '', phone: '', notes: '' });
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      setLoadError(err.message || 'Customer could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleCollection = async (receivable) => {
    const draft = collectionDrafts[receivable.id] || {};
    const amount = Number(draft.amount);
    if (saving || !Number.isFinite(amount) || amount <= 0 || amount > Number(receivable.balance)) {
      setLoadError('Collection must be positive and no more than the remaining due.');
      return;
    }
    setSaving(true);
    setLoadError('');
    try {
      const collectionPayload = {
        p_receivable_id: receivable.id,
        p_amount: amount,
        p_payment_mode: draft.payment_mode || 'Cash',
        p_collection_date: draft.collection_date ? new Date(`${draft.collection_date}T12:00:00`).toISOString() : new Date().toISOString(),
        p_notes: draft.notes || null,
      };
      const request = await getRequestToken(collectionRequest, collectionPayload, 'customer-collection');
      const { error } = await supabase.rpc('record_customer_collection', { ...collectionPayload, p_request_id: request.id });
      if (error) throw error;
      clearRequestToken(collectionRequest);
      setCollectionDrafts(prev => ({ ...prev, [receivable.id]: { amount: '', payment_mode: 'Cash', collection_date: new Date().toISOString().slice(0, 10), notes: '' } }));
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      setLoadError(err.message || 'Customer payment could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  const filteredSales = sales.filter((s) => {
    const query = searchTerm.toLowerCase();
    return !s.returned_at && (
      (s.customers?.name || '').toLowerCase().includes(query) ||
      (s.customers?.phone || '').includes(query)
    );
  });
  const filteredCustomers = customers.filter(customer =>
    `${customer.name} ${customer.phone || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const customerTotals = (customer) => {
    const customerSales = sales.filter(sale => sale.customer_id === customer.id && !sale.returned_at);
    const due = receivables.filter(row => row.customer_id === customer.id).reduce((sum, row) => sum + Number(row.balance || 0), 0);
    const total = customerSales.reduce((sum, sale) => sum + Number(sale.selling_price || 0) - Number(sale.discount || 0), 0);
    return { total, due, paid: total - due, count: customerSales.length, lastSale: customerSales[0]?.sale_date };
  };

  return (
    <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#0f172a' }}>👥 Customer Directory & Sales History</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>सभी ग्राहकों का रिकॉर्ड और उनके खरीदे गए फोन्स की जानकारी</p>
        </div>
        <p style={{ margin: 0, color: '#64748b', fontSize: '12px' }}>Customers on record: {customers.length}</p>

        <input
          type="text"
          placeholder="🔍 नाम या मोबाइल नंबर खोजें..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '250px' }}
        />
      </div>

      {loadError && (
        <div role="alert" style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px' }}>
          {loadError}
        </div>
      )}

      <form onSubmit={handleAddCustomer} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', padding: '14px', marginBottom: '18px', background: '#f8fafc', borderRadius: '8px' }}>
        <input aria-label="Customer name" placeholder="Customer name" value={newCustomer.name} onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} required />
        <input aria-label="Customer phone" placeholder="Phone (optional)" value={newCustomer.phone} onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
        <input aria-label="Customer notes" placeholder="Notes (optional)" value={newCustomer.notes} onChange={e => setNewCustomer({ ...newCustomer, notes: e.target.value })} />
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add Customer'}</button>
      </form>

      {!loading && filteredCustomers.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: '22px' }}>
          <h3 style={{ margin: '0 0 10px' }}>Customer balances and purchase summary</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}><th style={{ padding: '9px' }}>Customer</th><th style={{ padding: '9px' }}>Purchases</th><th style={{ padding: '9px' }}>Total Sales</th><th style={{ padding: '9px' }}>Paid to Date</th><th style={{ padding: '9px' }}>Due</th><th style={{ padding: '9px' }}>Last Sale</th></tr></thead>
            <tbody>{filteredCustomers.map(customer => {
              const totals = customerTotals(customer);
              return <tr key={customer.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: '9px' }}><strong>{customer.name}</strong><div style={{ color: '#64748b' }}>{customer.phone || 'No phone'}</div></td>
                <td style={{ padding: '9px' }}>{totals.count}</td>
                <td style={{ padding: '9px' }}>₹{totals.total.toLocaleString('en-IN')}</td>
                <td style={{ padding: '9px' }}>₹{totals.paid.toLocaleString('en-IN')}</td>
                <td style={{ padding: '9px', color: totals.due > 0 ? '#b91c1c' : '#15803d', fontWeight: 700 }}>₹{totals.due.toLocaleString('en-IN')}</td>
                <td style={{ padding: '9px' }}>{totals.lastSale ? new Date(totals.lastSale).toLocaleDateString('en-IN') : '—'}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      {!loading && receivables.some(row => Number(row.balance) > 0) && (
        <div style={{ marginBottom: '22px' }}>
          <h3 style={{ margin: '0 0 10px' }}>Outstanding customer dues</h3>
          <div style={{ display: 'grid', gap: '10px' }}>
            {receivables.filter(row => Number(row.balance) > 0 && (!searchTerm || `${row.customers?.name || ''} ${row.customers?.phone || ''}`.toLowerCase().includes(searchTerm.toLowerCase()))).map(row => {
              const draft = collectionDrafts[row.id] || {};
              const setDraft = (key, value) => setCollectionDrafts(prev => ({ ...prev, [row.id]: { payment_mode: 'Cash', collection_date: new Date().toISOString().slice(0, 10), ...prev[row.id], [key]: value } }));
              return <div key={row.id} style={{ padding: '12px', border: '1px solid #fecaca', borderRadius: '8px', background: '#fffafa' }}>
                <strong>{row.customers?.name || 'Customer'} — {row.sales?.invoice_no || 'Sale'}</strong>
                <div style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 8px' }}>{row.sales?.phones?.brand} {row.sales?.phones?.model} · Remaining ₹{Number(row.balance).toLocaleString('en-IN')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                  <input type="number" min="0.01" max={row.balance} step="0.01" placeholder="Amount" value={draft.amount || ''} onChange={e => setDraft('amount', e.target.value)} />
                  <select value={draft.payment_mode || 'Cash'} onChange={e => setDraft('payment_mode', e.target.value)}><option>Cash</option><option>UPI</option><option>Bank</option></select>
                  <input type="date" value={draft.collection_date || new Date().toISOString().slice(0, 10)} onChange={e => setDraft('collection_date', e.target.value)} />
                  <button type="button" disabled={saving} onClick={() => handleCollection(row)}>{saving ? 'Saving…' : 'Record Collection'}</button>
                </div>
              </div>;
            })}
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: '#64748b' }}>डेटा लोड हो रहा है...</p>
      ) : filteredSales.length === 0 ? (
        <p style={{ color: '#64748b' }}>कोई कस्टमर/बिक्री रिकॉर्ड नहीं मिला।</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '12px' }}>Customer Name</th>
                <th style={{ padding: '12px' }}>Phone Number</th>
                <th style={{ padding: '12px' }}>Device Purchased</th>
                <th style={{ padding: '12px' }}>Sale Date</th>
                <th style={{ padding: '12px' }}>Paid to Date (₹)</th>
                <th style={{ padding: '12px' }}>Mode</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px', fontWeight: 'bold', color: '#0f172a' }}>{s.customers?.name || 'Walk-in Customer'}</td>
                  <td style={{ padding: '12px', color: '#64748b' }}>{s.customers?.phone || 'N/A'}</td>
                  <td style={{ padding: '12px' }}>
                    <strong>{s.phones?.brand} {s.phones?.model}</strong>
                    {s.phones?.imei_1 && <div style={{ fontSize: '11px', color: '#94a3b8' }}>IMEI: {s.phones.imei_1}</div>}
                  </td>
                  <td style={{ padding: '12px', color: '#64748b' }}>{new Date(s.sale_date).toLocaleDateString('en-IN')}</td>
                  <td style={{ padding: '12px', fontWeight: 'bold', color: '#16a34a' }}>{(() => { const net = Number(s.selling_price || 0) - Number(s.discount || 0); const due = Number(receivables.find(row => row.sale_id === s.id)?.balance || 0); return `₹${(net - due).toLocaleString('en-IN')}`; })()}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', backgroundColor: s.payment_mode === 'Cash' ? '#fef3c7' : '#e0f2fe', color: s.payment_mode === 'Cash' ? '#b45309' : '#0369a1' }}>
                      {s.payment_mode || 'Cash'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && collections.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '22px' }}>
          <h3 style={{ margin: '0 0 10px' }}>Collection history</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}><th style={{ padding: '9px' }}>Date</th><th style={{ padding: '9px' }}>Customer</th><th style={{ padding: '9px' }}>Mode</th><th style={{ padding: '9px' }}>Amount</th><th style={{ padding: '9px' }}>Notes</th></tr></thead>
            <tbody>{collections.filter(row => !searchTerm || (row.customers?.name || '').toLowerCase().includes(searchTerm.toLowerCase())).map(row => <tr key={row.id} style={{ borderTop: '1px solid #e2e8f0' }}>
              <td style={{ padding: '9px' }}>{new Date(row.collection_date).toLocaleDateString('en-IN')}</td><td style={{ padding: '9px' }}>{row.customers?.name || 'Customer'}</td><td style={{ padding: '9px' }}>{row.payment_mode}</td><td style={{ padding: '9px', color: '#047857', fontWeight: 700 }}>₹{Number(row.amount).toLocaleString('en-IN')}</td><td style={{ padding: '9px' }}>{row.notes || '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
