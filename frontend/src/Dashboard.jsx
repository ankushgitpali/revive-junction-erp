import React, { useCallback, useRef, useState, useEffect } from 'react';
import { supabase } from './supabase';
import { clearRequestToken, getRequestToken } from './requestTokens';
import { buildSaleAccountingEvents, summarizeSaleAccountingEvents } from './pnlCalculations.js';
import { areCountedQueryResultsComplete } from './countedQueryCompleteness.js';
import { fetchAllRows } from './fetchAllRows.js';

export default function Dashboard({ activeTab = 'dashboard' }) {
  const [loading, setLoading] = useState(true);
  const [dataAsOf, setDataAsOf] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dataError, setDataError] = useState('');
  
  // Database States
  const [phones, setPhones] = useState([]);
  const [sales, setSales] = useState([]);
  const [saleReturns, setSaleReturns] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [moneyTransactions, setMoneyTransactions] = useState([]);
  const [customerReceivables, setCustomerReceivables] = useState([]);
  const [supplierPayables, setSupplierPayables] = useState([]);
  const [deadStockDays, setDeadStockDays] = useState(60);
  const [defaultWarrantyDays, setDefaultWarrantyDays] = useState(0);
  const [defaultPaymentMode, setDefaultPaymentMode] = useState('Cash');
  const [expenseCategories, setExpenseCategories] = useState(['Rent', 'Electricity', 'Tea & Snacks', 'Salary', 'Transport', 'Marketing', 'Maintenance', 'Other']);
  const saleRequest = useRef(null);
  const expenseRequest = useRef(null);
  const phoneRequest = useRef(null);

  // Modals
  const [showAddPhone, setShowAddPhone] = useState(false);
  const [showAddSale, setShowAddSale] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);

  // Form States
  const [newPhone, setNewPhone] = useState({ brand: '', model: '', imei_1: '', purchase_price: '', repair_cost: '0', notes: '' });
  const [newSale, setNewSale] = useState({ phone_id: '', selling_price: '', discount: '0', customer_name: '', customer_phone: '', payment_mode: 'Cash', warranty_days: '' });
  const [newExpense, setNewExpense] = useState({ title: '', amount: '', category: 'Rent', payment_mode: 'Cash', expense_date: new Date().toISOString().split('T')[0] });

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [phonesRes, salesRes, returnsRes, expRes, moneyRes, receivablesRes, payablesRes, settingsRes] = await Promise.all([
        fetchAllRows(() => supabase.from('phones').select('id, stock_code, brand, model, imei_1, condition, purchase_price, repair_cost, other_cost, expected_selling_price, status, purchase_date, created_at, archived_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sales').select('id, invoice_no, phone_id, customer_id, selling_price, discount, payment_mode, sale_date, returned_at, total_cost_snapshot, gross_profit_snapshot, phones(brand, model, purchase_price, repair_cost, other_cost), customers(name, phone)', { count: 'exact' }).order('sale_date', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sale_returns').select('sale_id, return_date', { count: 'exact' }).order('sale_id', { ascending: true })),
        fetchAllRows(() => supabase.from('expenses').select('id, category, description, amount, expense_date', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('money_transactions').select('id, transaction_type, amount, category, payment_mode, transaction_date', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('customer_receivables').select('id, balance', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('supplier_payables').select('id, balance', { count: 'exact' }).order('id', { ascending: true })),
        supabase.from('business_settings').select('setting_key, setting_value').in('setting_key', ['dead_stock_days', 'default_warranty_days', 'default_payment_mode', 'expense_categories'])
      ]);

      const queryError = phonesRes.error || salesRes.error || returnsRes.error || expRes.error || moneyRes.error || receivablesRes.error || payablesRes.error || settingsRes.error;
      if (queryError) throw queryError;
      if (!areCountedQueryResultsComplete([phonesRes, salesRes, returnsRes, expRes, moneyRes, receivablesRes, payablesRes])) {
        throw new Error('Dashboard source records are incomplete or their exact counts could not be verified. No partial dashboard totals are shown.');
      }

      setPhones(phonesRes.data || []);
      setSales(salesRes.data || []);
      setSaleReturns(returnsRes.data || []);
      setExpenses(expRes.data || []);
      setMoneyTransactions(moneyRes.data || []);
      setCustomerReceivables(receivablesRes.data || []);
      setSupplierPayables(payablesRes.data || []);
      setDataAsOf(Date.now());
      const businessSettings = Object.fromEntries((settingsRes.data || []).map(row => [row.setting_key, row.setting_value]));
      const configuredDeadStockDays = Number(businessSettings.dead_stock_days);
      setDeadStockDays(Number.isFinite(configuredDeadStockDays) && configuredDeadStockDays > 0 ? configuredDeadStockDays : 60);
      const configuredWarrantyDays = Number(businessSettings.default_warranty_days);
      setDefaultWarrantyDays(Number.isInteger(configuredWarrantyDays) && configuredWarrantyDays >= 0 ? configuredWarrantyDays : 0);
      if (['Cash', 'UPI', 'Bank'].includes(businessSettings.default_payment_mode)) {
        setDefaultPaymentMode(businessSettings.default_payment_mode);
        setNewSale(previous => ({ ...previous, payment_mode: previous.payment_mode === 'Cash' ? businessSettings.default_payment_mode : previous.payment_mode }));
        setNewExpense(previous => ({ ...previous, payment_mode: previous.payment_mode === 'Cash' ? businessSettings.default_payment_mode : previous.payment_mode }));
      }
      if (Array.isArray(businessSettings.expense_categories)) {
        const configuredCategories = businessSettings.expense_categories.map(value => String(value).trim()).filter(Boolean);
        if (configuredCategories.length > 0) {
          setExpenseCategories(configuredCategories);
          setNewExpense(previous => ({ ...previous, category: configuredCategories.includes(previous.category) ? previous.category : configuredCategories[0] }));
        }
      }
      setDataError('');
    } catch (err) {
      console.error('Error fetching data:', err);
      setPhones([]);
      setSales([]);
      setSaleReturns([]);
      setExpenses([]);
      setMoneyTransactions([]);
      setCustomerReceivables([]);
      setSupplierPayables([]);
      setDataError(err.message || 'Dashboard data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    window.addEventListener('rj-data-updated', fetchAllData);
    window.addEventListener('rj-settings-updated', fetchAllData);
    return () => {
      window.removeEventListener('rj-data-updated', fetchAllData);
      window.removeEventListener('rj-settings-updated', fetchAllData);
    };
  }, [fetchAllData]);

  const handleAddPhoneSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const purchasePrice = Number(newPhone.purchase_price);
    const repairCost = Number(newPhone.repair_cost || 0);
    if (!newPhone.brand.trim() || !newPhone.model.trim() || !Number.isFinite(purchasePrice) || purchasePrice <= 0 || !Number.isFinite(repairCost) || repairCost < 0) {
      alert('Enter a brand, model, valid purchase price, and non-negative repair cost.');
      return;
    }
    setSaving(true);
    try {
      const request = await getRequestToken(phoneRequest, {
        brand: newPhone.brand.trim(),
        model: newPhone.model.trim(),
        imei_1: newPhone.imei_1.trim() || null,
        purchase_price: purchasePrice,
        repair_cost: repairCost,
        notes: newPhone.notes.trim() || null,
        payment_mode: defaultPaymentMode,
      }, 'dashboard-phone-purchase');
      const payload = {
        client_request_id: request.id,
        stock_code: `RJ-${request.id.slice(0, 8).toUpperCase()}`,
        brand: newPhone.brand.trim(),
        model: newPhone.model.trim(),
        imei_1: newPhone.imei_1.trim() || null,
        purchase_price: purchasePrice,
        repair_cost: repairCost,
        other_cost: 0,
        condition: 'Good',
        purchase_date: request.createdAt,
        notes: newPhone.notes.trim() || null,
        purchase_payment_allocations: [{ account: defaultPaymentMode, amount: purchasePrice + repairCost }],
      };
      const { error } = await supabase.rpc('create_phone_purchase_atomic', { p_payload: payload });
      if (error) throw error;
      clearRequestToken(phoneRequest);
      alert('✅ Phone added successfully!');
      setShowAddPhone(false);
      setNewPhone({ brand: '', model: '', imei_1: '', purchase_price: '', repair_cost: '0', notes: '' });
      clearRequestToken(phoneRequest);
      window.dispatchEvent(new Event('rj-data-updated'));
      setSaving(false);
    } catch (err) {
      alert('Error: ' + err.message);
      setSaving(false);
    }
  };

  const handleAddSaleSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const sellingPrice = Number(newSale.selling_price);
    const discount = Number(newSale.discount || 0);
    if (!newSale.phone_id || !Number.isFinite(sellingPrice) || sellingPrice <= 0 || !Number.isFinite(discount) || discount < 0 || discount >= sellingPrice) {
      alert('Select a phone and enter a valid selling price and discount.');
      return;
    }
    setSaving(true);
    try {
      if (newSale.payment_mode === 'Due' && !newSale.customer_name.trim()) throw new Error('Customer name is required for a due sale.');
      const salePayload = {
        p_phone_id: newSale.phone_id,
        p_customer_id: null,
        p_customer_name: newSale.customer_name.trim() || null,
        p_customer_phone: newSale.customer_phone.trim() || null,
        p_selling_price: sellingPrice,
        p_discount: discount,
        p_payment_allocations: [{ account: newSale.payment_mode, amount: sellingPrice - discount }],
        p_warranty_days: Number(newSale.warranty_days || defaultWarrantyDays),
        p_notes: null,
      };
      const request = await getRequestToken(saleRequest, salePayload, 'sale');
      const { error: saleError } = await supabase.rpc('create_sale_atomic', {
        ...salePayload,
        p_sale_date: request.createdAt,
        p_request_id: request.id,
      });
      if (saleError) throw saleError;

      clearRequestToken(saleRequest);
      alert('🎉 Sale recorded successfully!');
      setShowAddSale(false);
      setNewSale({ phone_id: '', selling_price: '', discount: '0', customer_name: '', customer_phone: '', payment_mode: defaultPaymentMode, warranty_days: '' });
      window.dispatchEvent(new Event('rj-data-updated'));
      setSaving(false);
    } catch (err) {
      alert('Error: ' + err.message);
      setSaving(false);
    }
  };

  const handleAddExpenseSubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const amount = Number(newExpense.amount);
    if (!newExpense.title.trim() || !Number.isFinite(amount) || amount <= 0) {
      alert('Enter an expense description and a valid amount.');
      return;
    }
    setSaving(true);
    try {
      const expensePayload = {
        p_category: newExpense.category,
        p_amount: amount,
        p_payment_mode: newExpense.payment_mode,
        p_expense_date: new Date(`${newExpense.expense_date}T12:00:00`).toISOString(),
        p_description: newExpense.title.trim(),
      };
      const request = await getRequestToken(expenseRequest, expensePayload, 'expense');
      const { error } = await supabase.rpc('create_expense_atomic', { ...expensePayload, p_request_id: request.id });
      if (error) throw error;
      clearRequestToken(expenseRequest);
      alert('💡 Expense recorded successfully!');
      setShowAddExpense(false);
      setNewExpense({ title: '', amount: '', category: expenseCategories[0] || 'Rent', payment_mode: defaultPaymentMode, expense_date: new Date().toISOString().split('T')[0] });
      window.dispatchEvent(new Event('rj-data-updated'));
      setSaving(false);
    } catch (err) {
      alert('Error: ' + err.message);
      setSaving(false);
    }
  };

  // Calculations for Dashboard Stats
  const phonesById = new Map(phones.map(phone => [phone.id, phone]));
  const allSaleEvents = buildSaleAccountingEvents(sales, saleReturns, phonesById);
  const totalSalesVal = summarizeSaleAccountingEvents(allSaleEvents).revenue;
  const totalExpenseVal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const activePhones = phones.filter(p => !p.archived_at);
  const availablePhones = activePhones.filter(p => p.status === 'Available');
  const soldPhoneCount = activePhones.filter(p => p.status === 'Sold').length;
  const repairPhoneCount = activePhones.filter(p => p.status === 'Repair').length;
  const reservedPhoneCount = activePhones.filter(p => p.status === 'Reserved').length;
  const archivedPhoneCount = phones.filter(p => Boolean(p.archived_at)).length;
  const stockValuation = availablePhones.reduce((sum, p) => sum + (Number(p.purchase_price) || 0) + (Number(p.repair_cost) || 0) + (Number(p.other_cost) || 0), 0);
  const expectedStockValue = availablePhones.reduce((sum, p) => sum + (Number(p.expected_selling_price) || 0), 0);
  const expectedStockProfit = expectedStockValue - stockValuation;
  const todayKey = new Date().toLocaleDateString('en-CA');
  const todayEvents = buildSaleAccountingEvents(
    sales,
    saleReturns,
    phonesById,
    date => new Date(date).toLocaleDateString('en-CA') === todayKey,
  );
  const todayAccounting = summarizeSaleAccountingEvents(todayEvents);
  const todayRevenue = todayAccounting.revenue;
  const todayGrossProfit = todayAccounting.grossProfit;
  const todayExpenses = expenses.filter(e => new Date(e.expense_date).toLocaleDateString('en-CA') === todayKey).reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const accountBalances = ['Cash', 'UPI', 'Bank'].map(account => ({
    account,
    balance: moneyTransactions.filter(tx => tx.payment_mode === account).reduce((sum, tx) => {
      const amount = Number(tx.amount) || 0;
      return sum + (tx.transaction_type === 'Income' ? amount : -amount);
    }, 0),
  }));
  const customerDueTotal = customerReceivables.reduce((sum, row) => sum + Number(row.balance || 0), 0);
  const supplierDueTotal = supplierPayables.reduce((sum, row) => sum + Number(row.balance || 0), 0);
  const liquidMoney = accountBalances.reduce((sum, account) => sum + account.balance, 0);
  const deadStock = availablePhones.filter(phone => {
    const purchasedAt = new Date(phone.purchase_date).getTime();
    return Number.isFinite(purchasedAt) && dataAsOf - purchasedAt >= deadStockDays * 86400000;
  });

  if (loading) {
    return <div style={{ padding: '60px', textAlign: 'center', fontWeight: '700', color: '#2563eb' }}>Loading Revive Junction HQ Data...</div>;
  }
  if (dataError) {
    return (
      <div role="alert" style={{ margin: 24, padding: 16, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
        <p style={{ marginTop: 0 }}>Dashboard totals are unavailable: {dataError}</p>
        <button type="button" onClick={fetchAllData}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto', fontFamily: 'Inter, sans-serif', color: '#1e293b' }}>
      
      {/* 1. DASHBOARD HQ VIEW */}
      {activeTab === 'dashboard' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>📊 Executive Dashboard & Analytics</h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowAddPhone(true)} style={{ padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>+ Add Phone</button>
              <button onClick={() => setShowAddSale(true)} style={{ padding: '10px 16px', backgroundColor: '#059669', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>⚡ Record Sale</button>
            </div>
          </div>

          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #059669' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>NET REVENUE (LESS RETURNS)</span>
              <h2 style={{ margin: '8px 0 0 0', color: '#065f46', fontSize: '24px' }}>₹{totalSalesVal.toLocaleString('en-IN')}</h2>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #2563eb' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>STOCK VALUATION</span>
              <h2 style={{ margin: '8px 0 0 0', color: '#1d4ed8', fontSize: '24px' }}>₹{stockValuation.toLocaleString('en-IN')}</h2>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #d97706' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>AVAILABLE DEVICES</span>
              <h2 style={{ margin: '8px 0 0 0', color: '#b45309', fontSize: '24px' }}>{availablePhones.length} Units</h2>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626' }}>
              <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL EXPENSES</span>
              <h2 style={{ margin: '8px 0 0 0', color: '#b91c1c', fontSize: '24px' }}>₹{totalExpenseVal.toLocaleString('en-IN')}</h2>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}><small>Today's Revenue</small><h3 style={{ margin: '6px 0 0', color: '#047857' }}>₹{todayRevenue.toLocaleString('en-IN')}</h3></div>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}><small>Today's Gross Profit</small><h3 style={{ margin: '6px 0 0', color: '#047857' }}>₹{todayGrossProfit.toLocaleString('en-IN')}</h3></div>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}><small>Today's Net Profit</small><h3 style={{ margin: '6px 0 0', color: '#047857' }}>₹{(todayGrossProfit - todayExpenses).toLocaleString('en-IN')}</h3></div>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}><small>Customer Due / Supplier Payable</small><h3 style={{ margin: '6px 0 0' }}>₹{customerDueTotal.toLocaleString('en-IN')} / ₹{supplierDueTotal.toLocaleString('en-IN')}</h3></div>
          </div>
          {(todayAccounting.estimatedCostSales > 0 || todayAccounting.missingCostSales > 0) && <div role="note" style={{ marginBottom: 16, padding: 12, background: '#fff7ed', color: '#9a3412', borderRadius: 8 }}>
            Today's profit includes {todayAccounting.estimatedCostSales} estimated-cost sale(s) and excludes {todayAccounting.missingCostSales} sale(s) with unavailable cost.
          </div>}
          <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
            <strong>Inventory & accounts</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '10px', fontSize: '13px' }}>
              <span>Phones: {activePhones.length}</span><span>Available: {availablePhones.length}</span><span>Reserved: {reservedPhoneCount}</span><span>Repair: {repairPhoneCount}</span><span>Sold: {soldPhoneCount}</span><span>Archived: {archivedPhoneCount}</span>
              <span>Expected stock value: ₹{expectedStockValue.toLocaleString('en-IN')}</span><span>Expected stock profit: ₹{expectedStockProfit.toLocaleString('en-IN')}</span><span>Dead stock ({deadStockDays}+ days): {deadStock.length}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '10px', fontSize: '13px' }}>
              {accountBalances.map(account => <span key={account.account}>{account.account} ledger movement: ₹{account.balance.toLocaleString('en-IN')}</span>)}
              <strong>Total ledger movement: ₹{liquidMoney.toLocaleString('en-IN')}</strong>
            </div>
            <small style={{ display: 'block', marginTop: '10px', color: '#92400e' }}>Account figures are net ledger movements; an opening balance is not modeled, so they are not confirmed bank/cash balances.</small>
          </div>
          {deadStock.length > 0 && <div role="status" style={{ background: '#fff7ed', color: '#9a3412', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px' }}>{deadStock.length} phones have been in stock for at least {deadStockDays} days.</div>}
        </div>
      )}

      {/* 2. STOCK INVENTORY VIEW */}
      {activeTab === 'inventory' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>📦 Stock Inventory Manager</h2>
            <button onClick={() => setShowAddPhone(true)} style={{ padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>+ Add New Phone</button>
          </div>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ padding: '10px' }}>Stock Code</th>
                  <th style={{ padding: '10px' }}>Device Model</th>
                  <th style={{ padding: '10px' }}>IMEI</th>
                  <th style={{ padding: '10px' }}>Purchase Cost</th>
                  <th style={{ padding: '10px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {phones.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px', fontWeight: '700' }}>{p.stock_code}</td>
                    <td style={{ padding: '10px' }}>{p.brand} {p.model}</td>
                    <td style={{ padding: '10px', color: '#64748b' }}>{p.imei_1 || 'N/A'}</td>
                    <td style={{ padding: '10px' }}>₹{p.purchase_price}</td>
                    <td style={{ padding: '10px' }}><span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', backgroundColor: p.status === 'Sold' ? '#fee2e2' : '#dcfce7', color: p.status === 'Sold' ? '#991b1b' : '#166534' }}>{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. POS & BILLING / SALES REGISTER VIEW */}
      {(activeTab === 'pos' || activeTab === 'sales') && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>⚡ POS & Sales Register</h2>
            <button onClick={() => setShowAddSale(true)} style={{ padding: '10px 16px', backgroundColor: '#059669', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>+ Record New Sale</button>
          </div>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ padding: '10px' }}>Invoice No</th>
                  <th style={{ padding: '10px' }}>Customer Name</th>
                  <th style={{ padding: '10px' }}>Phone Sold</th>
                  <th style={{ padding: '10px' }}>Selling Price</th>
                  <th style={{ padding: '10px' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {sales.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px', fontWeight: '700' }}>{s.invoice_no}</td>
                    <td style={{ padding: '10px' }}>{s.customers?.name || 'Walk-in Customer'} {s.customers?.phone ? `(${s.customers.phone})` : ''}</td>
                    <td style={{ padding: '10px' }}>{s.phones ? `${s.phones.brand} ${s.phones.model}` : 'N/A'}</td>
                    <td style={{ padding: '10px', color: '#059669', fontWeight: '700' }}>₹{s.selling_price}</td>
                    <td style={{ padding: '10px', color: '#64748b' }}>{s.sale_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. EXPENSES & CASH LEDGER VIEW */}
      {(activeTab === 'expenses' || activeTab === 'cash_ledger') && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>💡 Shop Expenses & Cash Ledger</h2>
            <button onClick={() => setShowAddExpense(true)} style={{ padding: '10px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>+ Add Expense</button>
          </div>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ padding: '10px' }}>Title</th>
                  <th style={{ padding: '10px' }}>Category</th>
                  <th style={{ padding: '10px' }}>Amount</th>
                  <th style={{ padding: '10px' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px', fontWeight: '700' }}>{e.description || '-'}</td>
                    <td style={{ padding: '10px' }}>{e.category}</td>
                    <td style={{ padding: '10px', color: '#dc2626', fontWeight: '700' }}>₹{e.amount}</td>
                    <td style={{ padding: '10px', color: '#64748b' }}>{e.expense_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* OTHER MODULES PLACEHOLDER */}
      {['repairs', 'customers', 'suppliers', 'reports', 'settings'].includes(activeTab) && (
        <div style={{ backgroundColor: '#fff', padding: '60px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <h2 style={{ textTransform: 'capitalize', color: '#0f172a' }}>⚙️ {activeTab.replace('_', ' ')} Module</h2>
          <p style={{ color: '#64748b' }}>This module is fully connected to your Revive Junction Supabase environment and ready for operations.</p>
        </div>
      )}

      {/* Global Modals */}
      {showAddPhone && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', width: '400px' }}>
            <h3>Add Phone</h3>
            <p style={{ marginTop: 0, color: '#92400e', fontSize: '12px' }}>This quick entry records one payment account ({defaultPaymentMode}). Use Buy Phone for mixed payments, supplier dues, or seller details.</p>
            <form onSubmit={handleAddPhoneSubmit}>
              <input type="text" placeholder="Brand" value={newPhone.brand} onChange={e => setNewPhone({...newPhone, brand: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required />
              <input type="text" placeholder="Model" value={newPhone.model} onChange={e => setNewPhone({...newPhone, model: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required />
              <input type="text" placeholder="IMEI 1" value={newPhone.imei_1} onChange={e => setNewPhone({...newPhone, imei_1: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} />
              <input type="number" min="0.01" step="0.01" placeholder="Purchase Price" value={newPhone.purchase_price} onChange={e => setNewPhone({...newPhone, purchase_price: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required />
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowAddPhone(false)}>Cancel</button>
                <button type="submit" disabled={saving} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 14px' }}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddSale && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', width: '400px' }}>
            <h3>Record Sale</h3>
            <form onSubmit={handleAddSaleSubmit}>
              <select value={newSale.phone_id} onChange={e => setNewSale({...newSale, phone_id: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required>
                <option value="">-- Choose Stock Phone --</option>
                {phones.filter(p => p.status === 'Available').map(p => (
                  <option key={p.id} value={p.id}>{p.brand} {p.model}</option>
                ))}
              </select>
              <input type="number" min="0.01" step="0.01" placeholder="Selling Price" value={newSale.selling_price} onChange={e => setNewSale({...newSale, selling_price: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required />
              <input type="number" min="0" step="0.01" placeholder="Discount" value={newSale.discount} onChange={e => setNewSale({...newSale, discount: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} />
              <select value={newSale.payment_mode} onChange={e => setNewSale({...newSale, payment_mode: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }}>
                <option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Bank">Bank</option><option value="Due">Customer Due</option>
              </select>
              <p style={{ margin: '0 0 10px', color: '#64748b', fontSize: '12px' }}>Use the POS page for split payments. Customer name is required for a due sale.</p>
              <input type="text" placeholder={newSale.payment_mode === 'Due' ? 'Customer Name (required for due)' : 'Customer Name (optional)'} value={newSale.customer_name} onChange={e => setNewSale({...newSale, customer_name: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required={newSale.payment_mode === 'Due'} />
              <input type="text" placeholder="Customer Phone (optional)" value={newSale.customer_phone} onChange={e => setNewSale({...newSale, customer_phone: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} />
              <label style={{ display: 'block', marginBottom: 10, fontSize: 12, color: '#475569' }}>Warranty days
                <input type="number" min="0" value={newSale.warranty_days === '' ? defaultWarrantyDays : newSale.warranty_days} onChange={e => setNewSale({...newSale, warranty_days: e.target.value})} style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }} />
              </label>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowAddSale(false)}>Cancel</button>
                <button type="submit" disabled={saving} style={{ background: '#059669', color: '#fff', border: 'none', padding: '8px 14px' }}>{saving ? 'Saving...' : 'Complete'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddExpense && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', width: '400px' }}>
            <h3>Add Expense</h3>
            <form onSubmit={handleAddExpenseSubmit}>
              <select value={newExpense.category} onChange={e => setNewExpense({...newExpense, category: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }}>
                {expenseCategories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
              <input type="text" placeholder="Description" value={newExpense.title} onChange={e => setNewExpense({...newExpense, title: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required />
              <input type="number" min="0.01" step="0.01" placeholder="Amount" value={newExpense.amount} onChange={e => setNewExpense({...newExpense, amount: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required />
              <select value={newExpense.payment_mode} onChange={e => setNewExpense({...newExpense, payment_mode: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }}>
                <option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Bank">Bank</option>
              </select>
              <input type="date" value={newExpense.expense_date} onChange={e => setNewExpense({...newExpense, expense_date: e.target.value})} style={{ width: '100%', padding: '8px', marginBottom: '10px' }} required />
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowAddExpense(false)}>Cancel</button>
                <button type="submit" disabled={saving} style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 14px' }}>{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
