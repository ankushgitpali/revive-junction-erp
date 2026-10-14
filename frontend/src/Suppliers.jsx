import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { clearRequestToken, getRequestToken } from './requestTokens';
import { fetchAllRows } from './fetchAllRows.js';

const today = () => new Date().toISOString().slice(0, 10);

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [phones, setPhones] = useState([]);
  const [payables, setPayables] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', address: '', notes: '' });
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const paymentRequest = useRef(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [supplierResult, phoneResult, payableResult, paymentResult] = await Promise.all([
        fetchAllRows(() => supabase.from('suppliers').select('id, name, phone, address, notes, created_at', { count: 'exact' }).order('name').order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('phones').select('id, stock_code, brand, model, purchase_date, purchase_price, repair_cost, other_cost, status, supplier_id, suppliers(name)', { count: 'exact' }).order('purchase_date', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('supplier_payables').select('id, phone_id, supplier_id, payee_name, original_amount, balance, created_at, phones(stock_code, brand, model), suppliers(name)', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('supplier_payments').select('id, payable_id, supplier_id, amount, payment_mode, payment_date, notes, suppliers(name)', { count: 'exact' }).order('payment_date', { ascending: false }).order('id', { ascending: true })),
      ]);
      const failed = [supplierResult, phoneResult, payableResult, paymentResult].find(result => result.error);
      if (failed?.error) throw failed.error;
      setSuppliers(supplierResult.data);
      setPhones(phoneResult.data);
      setPayables(payableResult.data);
      setPayments(paymentResult.data);
      setError('');
    } catch (err) {
      setError(err.message || 'Supplier data could not be loaded. Apply the Supabase migration and verify RLS access.');
      setSuppliers([]);
      setPhones([]);
      setPayables([]);
      setPayments([]);
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

  const filteredSuppliers = useMemo(() => suppliers.filter(supplier =>
    `${supplier.name} ${supplier.phone || ''} ${supplier.address || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  ), [suppliers, searchTerm]);

  const handleAddSupplier = async (event) => {
    event.preventDefault();
    if (saving || !supplierForm.name.trim()) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { error: insertError } = await supabase.from('suppliers').insert({
        name: supplierForm.name.trim(),
        phone: supplierForm.phone.trim() || null,
        address: supplierForm.address.trim() || null,
        notes: supplierForm.notes.trim() || null,
      });
      if (insertError) throw insertError;
      setSupplierForm({ name: '', phone: '', address: '', notes: '' });
      setMessage('Supplier saved.');
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      setError(err.message || 'Supplier could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handlePayment = async (payable) => {
    const draft = paymentDrafts[payable.id] || {};
    const amount = Number(draft.amount);
    if (saving || !Number.isFinite(amount) || amount <= 0 || amount > Number(payable.balance)
      || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
      setError('Payment must be positive and cannot exceed the outstanding payable.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const paymentPayload = {
        p_payable_id: payable.id,
        p_amount: amount,
        p_payment_mode: draft.payment_mode || 'Cash',
        p_payment_date: draft.payment_date ? new Date(`${draft.payment_date}T12:00:00`).toISOString() : new Date().toISOString(),
        p_notes: draft.notes || null,
      };
      const request = await getRequestToken(paymentRequest, paymentPayload, 'supplier-payment');
      const { error: rpcError } = await supabase.rpc('record_supplier_payment', { ...paymentPayload, p_request_id: request.id });
      if (rpcError) throw rpcError;
      clearRequestToken(paymentRequest);
      setPaymentDrafts(prev => ({ ...prev, [payable.id]: { amount: '', payment_mode: 'Cash', payment_date: today(), notes: '' } }));
      setMessage('Supplier payment recorded in the ledger.');
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      setError(err.message || 'Supplier payment could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  const supplierSummary = (supplier) => {
    const purchases = phones.filter(phone => phone.supplier_id === supplier.id);
    const purchaseTotal = purchases.reduce((sum, phone) => sum + Number(phone.purchase_price || 0) + Number(phone.repair_cost || 0) + Number(phone.other_cost || 0), 0);
    const due = payables.filter(row => row.supplier_id === supplier.id).reduce((sum, row) => sum + Number(row.balance || 0), 0);
    return { purchases, purchaseTotal, due, paid: purchaseTotal - due };
  };

  const openPayables = payables.filter(payable => Number(payable.balance) > 0 && (!searchTerm || `${payable.suppliers?.name || payable.payee_name || ''} ${payable.phones?.stock_code || ''}`.toLowerCase().includes(searchTerm.toLowerCase())));

  return (
    <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#0f172a' }}>Supplier directory and payables</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>Phone purchases link to a supplier when selected in Buy Phone.</p>
        </div>
        <input type="search" placeholder="Search supplier, phone, code" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px' }} />
      </div>

      {error && <div role="alert" style={{ marginBottom: '12px', padding: '12px', background: '#fee2e2', color: '#991b1b', borderRadius: '8px' }}>{error}</div>}
      {message && <div role="status" style={{ marginBottom: '12px', padding: '12px', background: '#dcfce7', color: '#166534', borderRadius: '8px' }}>{message}</div>}

      <form onSubmit={handleAddSupplier} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px', padding: '14px', background: '#f8fafc', borderRadius: '8px', marginBottom: '20px' }}>
        <input placeholder="Supplier name" aria-label="Supplier name" value={supplierForm.name} onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} required />
        <input placeholder="Phone" aria-label="Supplier phone" value={supplierForm.phone} onChange={e => setSupplierForm({ ...supplierForm, phone: e.target.value })} />
        <input placeholder="Address" aria-label="Supplier address" value={supplierForm.address} onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })} />
        <input placeholder="Notes" aria-label="Supplier notes" value={supplierForm.notes} onChange={e => setSupplierForm({ ...supplierForm, notes: e.target.value })} />
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add Supplier'}</button>
      </form>

      {loading ? <p>Loading supplier ledger…</p> : (
        <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}><th style={{ padding: '10px' }}>Supplier</th><th style={{ padding: '10px' }}>Phones</th><th style={{ padding: '10px' }}>Purchase Total</th><th style={{ padding: '10px' }}>Paid / Credited</th><th style={{ padding: '10px' }}>Payable</th><th style={{ padding: '10px' }}>Last Purchase</th></tr></thead>
            <tbody>{filteredSuppliers.map(supplier => {
              const summary = supplierSummary(supplier);
              const lastPurchase = summary.purchases[0]?.purchase_date;
              return <tr key={supplier.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: '10px' }}><strong>{supplier.name}</strong><div style={{ color: '#64748b' }}>{supplier.phone || 'No phone'}</div></td>
                <td style={{ padding: '10px' }}>{summary.purchases.length}</td>
                <td style={{ padding: '10px' }}>₹{summary.purchaseTotal.toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px' }}>₹{summary.paid.toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px', color: summary.due > 0 ? '#b91c1c' : '#15803d', fontWeight: 700 }}>₹{summary.due.toLocaleString('en-IN')}</td>
                <td style={{ padding: '10px' }}>{lastPurchase ? new Date(lastPurchase).toLocaleDateString('en-IN') : '—'}</td>
              </tr>;
            })}</tbody>
          </table>
          {filteredSuppliers.length === 0 && <p style={{ color: '#64748b' }}>No suppliers found. Individual sellers can still be recorded in Buy Phone.</p>}
        </div>
      )}

      <h3 style={{ margin: '0 0 10px' }}>Outstanding supplier payables</h3>
      {openPayables.length === 0 ? <p style={{ color: '#64748b' }}>No recorded supplier payables. Historical balances are not inferred or backfilled.</p> : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {openPayables.map(payable => {
            const draft = paymentDrafts[payable.id] || {};
            const setDraft = (key, value) => setPaymentDrafts(prev => ({ ...prev, [payable.id]: { payment_mode: 'Cash', payment_date: today(), ...prev[payable.id], [key]: value } }));
            return <div key={payable.id} style={{ padding: '12px', border: '1px solid #fed7aa', borderRadius: '8px', background: '#fffaf0' }}>
              <strong>{payable.suppliers?.name || payable.payee_name || 'Individual seller'} · {payable.phones?.stock_code || 'Phone'}</strong>
              <div style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 8px' }}>{payable.phones?.brand} {payable.phones?.model} · Due ₹{Number(payable.balance).toLocaleString('en-IN')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <input type="number" min="0.01" max={payable.balance} step="0.01" placeholder="Amount" value={draft.amount || ''} onChange={e => setDraft('amount', e.target.value)} />
                <select value={draft.payment_mode || 'Cash'} onChange={e => setDraft('payment_mode', e.target.value)}><option>Cash</option><option>UPI</option><option>Bank</option></select>
                <input type="date" value={draft.payment_date || today()} onChange={e => setDraft('payment_date', e.target.value)} />
                <button type="button" disabled={saving} onClick={() => handlePayment(payable)}>{saving ? 'Saving…' : 'Record Payment'}</button>
              </div>
            </div>;
          })}
        </div>
      )}

      {payments.length > 0 && <div style={{ marginTop: '22px', overflowX: 'auto' }}>
        <h3>Payment history</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead><tr style={{ textAlign: 'left', background: '#f8fafc' }}><th style={{ padding: '9px' }}>Date</th><th style={{ padding: '9px' }}>Supplier</th><th style={{ padding: '9px' }}>Mode</th><th style={{ padding: '9px' }}>Amount</th><th style={{ padding: '9px' }}>Notes</th></tr></thead>
          <tbody>{payments.map(payment => <tr key={payment.id} style={{ borderTop: '1px solid #e2e8f0' }}><td style={{ padding: '9px' }}>{new Date(payment.payment_date).toLocaleDateString('en-IN')}</td><td style={{ padding: '9px' }}>{payment.suppliers?.name || 'Individual seller'}</td><td style={{ padding: '9px' }}>{payment.payment_mode}</td><td style={{ padding: '9px' }}>₹{Number(payment.amount).toLocaleString('en-IN')}</td><td style={{ padding: '9px' }}>{payment.notes || '—'}</td></tr>)}</tbody>
        </table>
      </div>}
    </div>
  );
}
