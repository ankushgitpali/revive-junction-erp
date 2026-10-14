import React, { useRef, useState, useEffect } from 'react';
import { supabase } from './supabase';
import { clearRequestToken, getRequestToken } from './requestTokens';
import { fetchAllRows } from './fetchAllRows.js';

const fallbackCategories = ['Rent', 'Electricity', 'Tea & Snacks', 'Salary', 'Transport', 'Marketing', 'Maintenance', 'Other'];

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    category: 'Rent',
    amount: '',
    payment_mode: 'Cash',
    notes: '',
    expense_date: new Date().toISOString().split('T')[0],
  });
  const [message, setMessage] = useState('');
  const [categories, setCategories] = useState(fallbackCategories);
  const [defaultPaymentMode, setDefaultPaymentMode] = useState('Cash');
  const expenseRequest = useRef(null);

  // Fetch Expense Transactions
  const loadExpenses = async () => {
    setLoading(true);
    try {
      const [expenseResult, settingsResult] = await Promise.all([
        fetchAllRows(() => supabase.from('expenses')
          .select('id, amount, category, description, payment_mode, expense_date, created_at', { count: 'exact' })
          .order('expense_date', { ascending: false }).order('id', { ascending: true })),
        supabase.from('business_settings').select('setting_key, setting_value')
          .in('setting_key', ['expense_categories', 'default_payment_mode']),
      ]);

      if (expenseResult.error) throw expenseResult.error;
      const settings = Object.fromEntries((settingsResult.data || []).map(row => [row.setting_key, row.setting_value]));
      const configuredCategories = Array.isArray(settings.expense_categories)
        ? settings.expense_categories.map(value => String(value).trim()).filter(Boolean)
        : [];
      if (configuredCategories.length > 0) {
        setCategories(configuredCategories);
        setFormData(previous => ({ ...previous, category: configuredCategories.includes(previous.category) ? previous.category : configuredCategories[0] }));
      }
      if (['Cash', 'UPI', 'Bank'].includes(settings.default_payment_mode)) {
        setDefaultPaymentMode(settings.default_payment_mode);
        setFormData(previous => ({ ...previous, payment_mode: previous.payment_mode === 'Cash' ? settings.default_payment_mode : previous.payment_mode }));
      }
      setExpenses(expenseResult.data);
      setMessage('');
    } catch (err) {
      console.error('Error fetching expenses:', err);
      setMessage(`Error loading expenses: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
    const refresh = () => loadExpenses();
    window.addEventListener('rj-data-updated', refresh);
    window.addEventListener('rj-settings-updated', refresh);
    return () => {
      window.removeEventListener('rj-data-updated', refresh);
      window.removeEventListener('rj-settings-updated', refresh);
    };
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Submit Expense Entry
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.amount || !Number.isFinite(Number(formData.amount)) || Number(formData.amount) <= 0
      || Math.abs(Number(formData.amount) * 100 - Math.round(Number(formData.amount) * 100)) > 0.000001) {
      setMessage('Error: कृपया सही राशि (Amount) दर्ज करें।');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const expensePayload = {
        p_category: formData.category,
        p_amount: Number(formData.amount),
        p_payment_mode: formData.payment_mode,
        p_expense_date: formData.expense_date ? new Date(`${formData.expense_date}T12:00:00`).toISOString() : new Date().toISOString(),
        p_description: formData.notes.trim() || null,
      };
      const request = await getRequestToken(expenseRequest, expensePayload, 'expense');
      const { error } = await supabase.rpc('create_expense_atomic', { ...expensePayload, p_request_id: request.id });

      if (error) throw error;

      clearRequestToken(expenseRequest);
      setMessage('🎉 खर्चा सफलतापूर्वक दर्ज हो गया!');
      setFormData({
        category: categories[0] || fallbackCategories[0],
        amount: '',
        payment_mode: defaultPaymentMode,
        notes: '',
        expense_date: new Date().toISOString().split('T')[0],
      });

      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      console.error('Expense insert error:', err);
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const totalExpense = expenses.reduce((acc, exp) => acc + (Number(exp.amount) || 0), 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '20px' }}>
      
      {/* Form Section */}
      <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0, color: '#0f172a' }}>💸 Add Expense (खर्चा दर्ज करें)</h3>

        {message && (
          <div style={{ padding: '10px', marginBottom: '15px', borderRadius: '6px', backgroundColor: message.startsWith('Error') ? '#fee2e2' : '#dcfce7', color: message.startsWith('Error') ? '#991b1b' : '#166534', fontSize: '14px', fontWeight: 'bold' }}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '14px' }}>Category (खर्चे की श्रेणी)</label>
            <select name="category" value={formData.category} onChange={handleChange} style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
  {categories.map(category => <option key={category} value={category}>{category}</option>)}
</select>
          </div>

          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '14px' }}>Amount (राशि ₹) *</label>
            <input type="number" name="amount" value={formData.amount} onChange={handleChange} placeholder="e.g. 500" required style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
          </div>

          <div>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px', fontSize: '14px' }}>Payment Mode (भुगतान माध्यम)</label>
            <select name="payment_mode" value={formData.payment_mode} onChange={handleChange} style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI / GPay / PhonePe</option>
              <option value="Bank">Bank Transfer</option>
            </select>
          </div>

          <div>
            <label style={{ fontWeight: '500', display: 'block', marginBottom: '4px', fontSize: '14px' }}>Date (तारीख)</label>
            <input type="date" name="expense_date" value={formData.expense_date} onChange={handleChange} style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
          </div>

          <div>
            <label style={{ fontWeight: '500', display: 'block', marginBottom: '4px', fontSize: '14px' }}>Notes / Description</label>
            <input type="text" name="notes" value={formData.notes} onChange={handleChange} placeholder="e.g. चाय नाश्ता बिल" style={{ width: '100%', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
          </div>

          <button type="submit" disabled={loading} style={{ padding: '10px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>
            {loading ? 'सहेजा जा रहा है...' : 'Save Expense (खर्चा सहेजें)'}
          </button>
        </form>
      </div>

      {/* Expense List Section */}
      <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0, color: '#0f172a' }}>📊 Expense History</h3>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#dc2626', backgroundColor: '#fee2e2', padding: '6px 12px', borderRadius: '6px' }}>
            Total Expense: ₹{totalExpense.toLocaleString('en-IN')}
          </div>
        </div>

        {expenses.length === 0 ? (
          <p style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>अभी तक कोई खर्चा दर्ज नहीं किया गया है।</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '10px' }}>Date</th>
                  <th style={{ padding: '10px' }}>Category</th>
                  <th style={{ padding: '10px' }}>Mode</th>
                  <th style={{ padding: '10px' }}>Amount</th>
                  <th style={{ padding: '10px' }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => (
                  <tr key={exp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px', fontSize: '13px', color: '#64748b' }}>
                      {exp.expense_date ? new Date(exp.expense_date).toLocaleDateString('en-IN') : 'N/A'}
                    </td>
                    <td style={{ padding: '10px', fontWeight: '500' }}>{exp.category}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '10px', backgroundColor: exp.payment_mode === 'Cash' ? '#fef3c7' : '#e0f2fe', color: exp.payment_mode === 'Cash' ? '#b45309' : '#0369a1', fontWeight: 'bold' }}>
                        {exp.payment_mode}
                      </span>
                    </td>
                    <td style={{ padding: '10px', fontWeight: 'bold', color: '#dc2626' }}>
                      ₹{Number(exp.amount).toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '10px', fontSize: '13px', color: '#64748b' }}>{exp.description || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
