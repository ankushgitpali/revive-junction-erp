import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { areBackupResultsComplete } from './backupCompleteness.js';
import { fetchAllRows } from './fetchAllRows.js';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('shop');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });
  const [connectionStatus, setConnectionStatus] = useState('Checking…');

  // Shop Profile State
  const [shopDetails, setShopDetails] = useState({
    shopName: 'REVIVE JUNCTION',
    tagline: 'Pre-owned Smartphones & Repairs',
    ownerName: 'Ankush Gupta',
    phone: '',
    address: 'Near Sai Mandir, Birsinghpur Pali, Umaria, Madhya Pradesh',
    gstin: '',
    invoiceTerms: '1. 7 Days Shop Warranty on Second Hand Devices.\n2. No Warranty on Liquid or Physical Damage.\n3. Goods once sold will not be taken back without valid invoice.'
  });

  // Invoice Preferences State
  const [invoiceConfig, setInvoiceConfig] = useState({
    defaultWarranty: '7',
    prefix: 'RJ-',
    deadStockDays: '60',
    currency: 'INR',
    defaultPaymentMode: 'Cash',
    expenseCategories: 'Rent\nElectricity\nTea & Snacks\nSalary\nTransport\nMarketing\nMaintenance\nOther',
    phoneConditions: 'Flawless\nSuperb\nGood\nFair\nDamaged',
    autoPrint: false
  });

  // Database Stats State
  const [dbStats, setDbStats] = useState({
    phonesCount: 0,
    salesCount: 0,
    expensesCount: 0,
    customersCount: 0,
    lastChecked: null
  });

  const fetchBusinessSettings = async () => {
    try {
      const { data, error } = await supabase.from('business_settings').select('setting_key, setting_value');
      if (error) throw error;
      const settings = Object.fromEntries((data || []).map(row => [row.setting_key, row.setting_value]));
      setShopDetails(previous => ({
        ...previous,
        shopName: settings.business_name ?? previous.shopName,
        ownerName: settings.owner_name ?? previous.ownerName,
        phone: settings.business_phone ?? previous.phone,
        address: settings.business_address ?? previous.address,
      }));
      setInvoiceConfig(previous => ({
        ...previous,
        prefix: settings.invoice_prefix ?? previous.prefix,
        defaultWarranty: String(settings.default_warranty_days ?? previous.defaultWarranty),
        deadStockDays: String(settings.dead_stock_days ?? previous.deadStockDays),
        currency: settings.currency ?? previous.currency,
        defaultPaymentMode: settings.default_payment_mode ?? previous.defaultPaymentMode,
        expenseCategories: Array.isArray(settings.expense_categories) ? settings.expense_categories.join('\n') : previous.expenseCategories,
        phoneConditions: Array.isArray(settings.phone_conditions) ? settings.phone_conditions.join('\n') : previous.phoneConditions,
      }));
    } catch (error) {
      console.error('Business settings could not be loaded:', error);
      setStatusMsg({ type: 'error', text: 'Business settings could not be loaded. Apply the ERP migration and verify access.' });
    }
  };

  const fetchSystemHealth = async () => {
    setLoading(true);
    try {
      const [p, s, e, c] = await Promise.all([
        supabase.from('phones').select('id', { count: 'exact', head: true }),
        supabase.from('sales').select('id', { count: 'exact', head: true }),
        supabase.from('expenses').select('id', { count: 'exact', head: true }),
        supabase.from('customers').select('id', { count: 'exact', head: true })
      ]);

      const checkError = [p.error, s.error, e.error, c.error].find(Boolean);
      if (checkError) throw checkError;
      setConnectionStatus('Connected');
      setDbStats({
        phonesCount: p.count || 0,
        salesCount: s.count || 0,
        expensesCount: e.count || 0,
        customersCount: c.count || 0,
        lastChecked: new Date().toLocaleTimeString('en-IN')
      });
    } catch (err) {
      console.error('Db check error:', err);
      setConnectionStatus('Unable to verify');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const savedShop = localStorage.getItem('rj_shop_details');
    if (savedShop) {
      try { setShopDetails(previous => ({ ...previous, ...JSON.parse(savedShop) })); } catch (error) { console.error('Saved shop settings could not be read:', error.message); }
    }

    const savedConfig = localStorage.getItem('rj_invoice_config');
    if (savedConfig) {
      try { setInvoiceConfig(previous => ({ ...previous, ...JSON.parse(savedConfig) })); } catch (error) { console.error('Saved invoice settings could not be read:', error.message); }
    }

    fetchSystemHealth();
    fetchBusinessSettings();
  }, []);

  const handleSaveShopDetails = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const rows = [
        ['business_name', shopDetails.shopName], ['owner_name', shopDetails.ownerName],
        ['business_phone', shopDetails.phone], ['business_address', shopDetails.address],
      ].map(([setting_key, value]) => ({ setting_key, setting_value: value, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from('business_settings').upsert(rows, { onConflict: 'setting_key' });
      if (error) throw error;
      localStorage.setItem('rj_shop_details', JSON.stringify(shopDetails));
      setStatusMsg({ type: 'success', text: 'Store details saved to business settings.' });
      window.dispatchEvent(new Event('rj-settings-updated'));
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || 'Store details could not be saved.' });
    } finally {
      setLoading(false);
    }
    setTimeout(() => setStatusMsg({ type: '', text: '' }), 3000);
  };

  const handleSaveInvoiceConfig = async (e) => {
    e.preventDefault();
    const warranty = Number(invoiceConfig.defaultWarranty);
    const deadDays = Number(invoiceConfig.deadStockDays);
    const normalizeList = value => [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))];
    const categories = normalizeList(invoiceConfig.expenseCategories);
    const conditions = normalizeList(invoiceConfig.phoneConditions);
    if (!Number.isInteger(warranty) || warranty < 0 || !Number.isInteger(deadDays) || deadDays < 1 || !invoiceConfig.prefix.trim()
      || !['Cash', 'UPI', 'Bank'].includes(invoiceConfig.defaultPaymentMode) || categories.length === 0 || conditions.length === 0) {
      setStatusMsg({ type: 'error', text: 'Enter valid warranty, dead-stock days, and invoice prefix values.' });
      return;
    }
    setLoading(true);
    try {
      const rows = [
        ['invoice_prefix', invoiceConfig.prefix.trim()],
        ['default_warranty_days', warranty],
        ['dead_stock_days', deadDays],
        ['currency', invoiceConfig.currency],
        ['default_payment_mode', invoiceConfig.defaultPaymentMode],
        ['expense_categories', categories],
        ['phone_conditions', conditions],
      ].map(([setting_key, setting_value]) => ({ setting_key, setting_value, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from('business_settings').upsert(rows, { onConflict: 'setting_key' });
      if (error) throw error;
      localStorage.setItem('rj_invoice_config', JSON.stringify(invoiceConfig));
      setStatusMsg({ type: 'success', text: 'Invoice and dead-stock settings saved.' });
      window.dispatchEvent(new Event('rj-settings-updated'));
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message || 'Settings could not be saved.' });
    } finally {
      setLoading(false);
    }
    setTimeout(() => setStatusMsg({ type: '', text: '' }), 3000);
  };

  const handleFullBackup = async () => {
    setLoading(true);
    try {
      const [phones, sales, expenses, customers, suppliers, money, repairs, movements, receivables, collections, payables, supplierPayments, transfers, returns, audit, settings, openingBalances] = await Promise.all([
        fetchAllRows(() => supabase.from('phones').select('id, stock_code, brand, model, variant, varient, storage, ram, imei_1, imei_2, condition, purchase_price, repair_cost, other_cost, expected_selling_price, purchase_date, status, supplier_id, seller_name, seller_phone, notes, created_at, updated_at, archived_at, archived_reason, purchase_payment_allocations', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sales').select('id, client_request_id, invoice_no, phone_id, customer_id, selling_price, discount, payment_mode, payment_allocations, sale_date, warranty_days, notes, purchase_cost_snapshot, repair_cost_snapshot, other_cost_snapshot, total_cost_snapshot, gross_profit_snapshot, returned_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('expenses').select('id, client_request_id, amount, category, description, payment_mode, expense_date, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('customers').select('id, name, phone, notes, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('suppliers').select('id, name, phone, address, notes, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('money_transactions').select('id, transaction_type, amount, category, payment_mode, reference_id, notes, transaction_date, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('repairs').select('id, client_request_id, phone_id, issue, technician, labour_cost, parts_cost, status, started_at, completed_at, notes, created_at, phone_status_before_repair', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('stock_movements').select('id, phone_id, movement_type, quantity, reference_id, movement_date, notes', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('customer_receivables').select('id, sale_id, customer_id, original_amount, balance, created_at, closed_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('customer_collections').select('id, client_request_id, receivable_id, customer_id, amount, payment_mode, collection_date, notes, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('supplier_payables').select('id, phone_id, supplier_id, payee_name, payee_phone, original_amount, balance, created_at, closed_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('supplier_payments').select('id, client_request_id, payable_id, supplier_id, amount, payment_mode, payment_date, notes, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('internal_transfers').select('id, client_request_id, from_account, to_account, amount, transfer_date, notes, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sale_returns').select('id, sale_id, phone_id, refund_amount, refund_allocations, return_date, notes, created_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('audit_log').select('id, action, entity, entity_id, old_data, new_data, user_id, occurred_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('business_settings').select('setting_key, setting_value, updated_at', { count: 'exact' }).order('setting_key', { ascending: true })),
        fetchAllRows(() => supabase.from('account_opening_balances').select('account, opening_amount, opening_date, updated_at', { count: 'exact' }).order('account', { ascending: true })),
      ]);

      const backupResults = [phones, sales, expenses, customers, suppliers, money, repairs, movements, receivables, collections, payables, supplierPayments, transfers, returns, audit, settings, openingBalances];
      const failed = backupResults.find(result => result.error);
      if (failed?.error) throw failed.error;
      if (!areBackupResultsComplete(backupResults)) {
        throw new Error('Backup was not created: at least one table result may be truncated or has no verifiable exact row count.');
      }
      const redactKycFields = value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        const safeValue = { ...value };
        delete safeValue.seller_photo_url;
        delete safeValue.id_proof_front_url;
        delete safeValue.id_proof_back_url;
        return safeValue;
      };

      const backupData = {
        exportDate: new Date().toISOString(),
        shop: shopDetails,
        phones: phones.data || [],
        sales: sales.data || [],
        expenses: expenses.data || [],
        customers: customers.data || [],
        suppliers: suppliers.data || [],
        moneyTransactions: money.data || [],
        repairs: repairs.data || [],
        stockMovements: movements.data || [],
        customerReceivables: receivables.data || [],
        customerCollections: collections.data || [],
        supplierPayables: payables.data || [],
        supplierPayments: supplierPayments.data || [],
        internalTransfers: transfers.data || [],
        saleReturns: returns.data || [],
        auditLog: (audit.data || []).map(row => ({
          ...row,
          old_data: redactKycFields(row.old_data),
          new_data: redactKycFields(row.new_data),
        })),
        businessSettings: settings.data || [],
        accountOpeningBalances: openingBalances.data || [],
      };

      const backupBlob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json;charset=utf-8' });
      const backupUrl = URL.createObjectURL(backupBlob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", backupUrl);
      downloadAnchor.setAttribute("download", `ReviveJunction_Backup_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(backupUrl), 1000);

      setStatusMsg({ type: 'success', text: '📥 Database backup downloaded; exact row counts matched for every included table.' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Backup failed: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = async (tableName) => {
    try {
      const exportColumns = {
        phones: 'id, stock_code, brand, model, variant, storage, ram, imei_1, imei_2, condition, purchase_price, repair_cost, other_cost, expected_selling_price, purchase_date, status, supplier_id, notes',
        sales: 'id, invoice_no, phone_id, customer_id, selling_price, discount, payment_mode, payment_allocations, sale_date, warranty_days, notes, total_cost_snapshot, gross_profit_snapshot, returned_at',
        expenses: 'id, amount, category, description, payment_mode, expense_date, created_at',
        customers: 'id, name, phone, notes, created_at',
      };
      if (!exportColumns[tableName]) throw new Error('This table is not available for export.');
      const { data } = await fetchAllRows(() => supabase
        .from(tableName)
        .select(exportColumns[tableName], { count: 'exact' })
        .order('id', { ascending: true }));
      if (data.length === 0) {
        alert('No data found in ' + tableName);
        return;
      }

      const headers = Object.keys(data[0]);
      const escapeCsv = value => {
        let text = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
        if (typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replaceAll('"', '""').replaceAll('\r', ' ').replaceAll('\n', ' ')}"`;
      };
      const rows = data.map(obj => headers.map(column => escapeCsv(obj[column])).join(','));
      const csvContent = [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
      const encodedUri = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `${tableName}_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(encodedUri);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  };

  return (
    <div style={{ padding: '8px', maxWidth: '1000px', margin: '0 auto' }}>
      
      {/* Header */}
      <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, color: '#0f172a', fontSize: '20px' }}>⚙️ System Settings & Data Control</h2>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>Store profile, bill options, and offline data backup.</p>
        </div>
        <span style={{ backgroundColor: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
          PRO Console
        </span>
      </div>

      {statusMsg.text && (
        <div style={{ padding: '10px 14px', borderRadius: '6px', marginBottom: '16px', backgroundColor: statusMsg.type === 'success' ? '#dcfce7' : '#fee2e2', color: statusMsg.type === 'success' ? '#15803d' : '#b91c1c', fontSize: '13px', fontWeight: 'bold' }}>
          {statusMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { id: 'shop', label: '🏬 Shop Profile' },
          { id: 'backup', label: '💾 Backup & Export' },
          { id: 'invoice', label: '📝 Invoice Rules' },
          { id: 'system', label: '⚡ Database Health' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
              backgroundColor: activeTab === tab.id ? '#0284c7' : '#fff',
              color: activeTab === tab.id ? '#ffffff' : '#475569',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* SHOP PROFILE */}
      {activeTab === 'shop' && (
        <form onSubmit={handleSaveShopDetails} style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'grid', gap: '14px' }}>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '16px' }}>Store Information (Prints on Invoices)</h3>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Owner Name</label>
            <input type="text" value={shopDetails.ownerName} onChange={e => setShopDetails({ ...shopDetails, ownerName: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }} />
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Shop Name</label>
              <input
                type="text"
                value={shopDetails.shopName}
                onChange={e => setShopDetails({ ...shopDetails, shopName: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}
                required
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Tagline</label>
              <input
                type="text"
                value={shopDetails.tagline}
                onChange={e => setShopDetails({ ...shopDetails, tagline: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Phone</label>
              <input
                type="text"
                value={shopDetails.phone}
                onChange={e => setShopDetails({ ...shopDetails, phone: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>GSTIN (Optional)</label>
              <input
                type="text"
                value={shopDetails.gstin}
                onChange={e => setShopDetails({ ...shopDetails, gstin: e.target.value })}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Address</label>
            <input
              type="text"
              value={shopDetails.address}
              onChange={e => setShopDetails({ ...shopDetails, address: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Terms & Conditions (Bill Footer)</label>
            <textarea
              rows="3"
              value={shopDetails.invoiceTerms}
              onChange={e => setShopDetails({ ...shopDetails, invoiceTerms: e.target.value })}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}
            ></textarea>
          </div>

          <button type="submit" disabled={loading} style={{ padding: '10px 18px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', width: 'fit-content' }}>
            💾 Save Profile
          </button>
        </form>
      )}

      {/* BACKUPS & EXPORT */}
      {activeTab === 'backup' && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderLeft: '4px solid #0284c7' }}>
            <h3 style={{ margin: '0 0 6px 0', color: '#0f172a', fontSize: '16px' }}>📦 Full Offline Backup (JSON)</h3>
            <p style={{ margin: '0 0 12px 0', color: '#64748b', fontSize: '12px' }}>Download all stock, sales, expenses, and customer records into a single backup file.</p>
            <p role="note" style={{ margin: '0 0 12px 0', padding: '10px 12px', color: '#9a3412', background: '#fff7ed', borderRadius: '6px', fontSize: '12px' }}>
              This unencrypted file contains sensitive personal and financial records. Store it only in a secure location and do not share it.
            </p>
            <button onClick={handleFullBackup} disabled={loading} style={{ padding: '10px 18px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
              {loading ? '⏳ Generating...' : '📥 Download JSON Backup'}
            </button>
          </div>

          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#0f172a', fontSize: '16px' }}>📊 Export Tables to Excel / CSV</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <button onClick={() => exportToCSV('phones')} style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>📱 Phones Stock CSV</button>
              <button onClick={() => exportToCSV('sales')} style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>💵 Sales CSV</button>
              <button onClick={() => exportToCSV('expenses')} style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>💸 Expenses CSV</button>
              <button onClick={() => exportToCSV('customers')} style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>👥 Customers CSV</button>
            </div>
          </div>
        </div>
      )}

      {/* INVOICE CONFIG */}
      {activeTab === 'invoice' && (
        <form onSubmit={handleSaveInvoiceConfig} style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'grid', gap: '14px' }}>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '16px' }}>Invoice Configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Invoice Prefix</label>
              <input type="text" value={invoiceConfig.prefix} onChange={e => setInvoiceConfig({ ...invoiceConfig, prefix: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Default Warranty (Days)</label>
              <input type="number" value={invoiceConfig.defaultWarranty} onChange={e => setInvoiceConfig({ ...invoiceConfig, defaultWarranty: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Dead Stock After (Days)</label>
              <input type="number" min="1" value={invoiceConfig.deadStockDays} onChange={e => setInvoiceConfig({ ...invoiceConfig, deadStockDays: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Currency</label>
              <select value={invoiceConfig.currency} onChange={e => setInvoiceConfig({ ...invoiceConfig, currency: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}>
                <option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="GBP">GBP — British Pound</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Default Payment Mode</label>
              <select value={invoiceConfig.defaultPaymentMode} onChange={e => setInvoiceConfig({ ...invoiceConfig, defaultPaymentMode: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }}>
                <option>Cash</option><option>UPI</option><option>Bank</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Expense Categories (one per line)</label>
              <textarea value={invoiceConfig.expenseCategories} onChange={e => setInvoiceConfig({ ...invoiceConfig, expenseCategories: e.target.value })} rows="5" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155' }}>Phone Conditions (one per line)</label>
              <textarea value={invoiceConfig.phoneConditions} onChange={e => setInvoiceConfig({ ...invoiceConfig, phoneConditions: e.target.value })} rows="5" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', marginTop: '4px' }} />
            </div>
          </div>
          <button type="submit" disabled={loading} style={{ padding: '10px 18px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', width: 'fit-content' }}>
            {loading ? 'Saving…' : 'Save Rules'}
          </button>
        </form>
      )}

      {/* SYSTEM HEALTH */}
      {activeTab === 'system' && (
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: '16px' }}>⚡ Database Health</h3>
            <button onClick={fetchSystemHealth} style={{ padding: '6px 12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
              🔄 Refresh Status
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
              <small style={{ color: '#166534' }}>Supabase Status</small>
              <h4 style={{ margin: '4px 0 0 0', color: connectionStatus === 'Connected' ? '#15803d' : '#b45309' }}>{connectionStatus}</h4>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <small style={{ color: '#64748b' }}>Phones in DB</small>
              <h4 style={{ margin: '4px 0 0 0', color: '#0f172a' }}>{dbStats.phonesCount} Records</h4>
            </div>
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <small style={{ color: '#64748b' }}>Sales Completed</small>
              <h4 style={{ margin: '4px 0 0 0', color: '#0f172a' }}>{dbStats.salesCount} Invoices</h4>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
