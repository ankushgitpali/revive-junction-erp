import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { clearRequestToken, getRequestToken } from './requestTokens';
import { fetchAllRows } from './fetchAllRows.js';

const initialForm = {
  phone_id: '',
  issue: '',
  technician: '',
  labour_cost: '0',
  parts_cost: '0',
  notes: '',
};

const repairStatuses = ['Pending', 'In Progress', 'Completed', 'Cancelled'];

export default function Repairs() {
  const [repairs, setRepairs] = useState([]);
  const [phones, setPhones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState(initialForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const repairRequest = useRef(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [repairResult, phoneResult] = await Promise.all([
        fetchAllRows(() => supabase.from('repairs')
          .select('id, phone_id, issue, technician, labour_cost, parts_cost, status, started_at, completed_at, notes, created_at, phones(stock_code, brand, model)', { count: 'exact' })
          .order('created_at', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('phones')
          .select('id, stock_code, brand, model, status, archived_at', { count: 'exact' })
          .order('purchase_date', { ascending: false }).order('id', { ascending: true })),
      ]);

      if (repairResult.error) throw repairResult.error;
      if (phoneResult.error) throw phoneResult.error;
      setRepairs(repairResult.data);
      setPhones(phoneResult.data);
      setError('');
    } catch (err) {
      console.error('Error loading repairs:', err);
      setRepairs([]);
      setPhones([]);
      setError(err.message || 'Repair data could not be loaded. Check the repairs and phones table permissions.');
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

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    const labourCost = Number(formData.labour_cost);
    const partsCost = Number(formData.parts_cost);
    if (!formData.phone_id || !formData.issue.trim() ||
        !Number.isFinite(labourCost) || labourCost < 0 ||
        !Number.isFinite(partsCost) || partsCost < 0 ||
        Math.abs(labourCost * 100 - Math.round(labourCost * 100)) > 0.000001 ||
        Math.abs(partsCost * 100 - Math.round(partsCost * 100)) > 0.000001) {
      setError('Choose a phone, enter the repair issue, and use non-negative labour and parts costs.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const repairPayload = {
        phone_id: formData.phone_id,
        issue: formData.issue.trim(),
        technician: formData.technician.trim() || null,
        labour_cost: labourCost,
        parts_cost: partsCost,
        status: 'Pending',
        completed_at: null,
        notes: formData.notes.trim() || null,
      };
      const request = await getRequestToken(repairRequest, repairPayload, 'repair');
      const { error: insertError } = await supabase.from('repairs').insert({
        ...repairPayload,
        client_request_id: request.id,
        started_at: request.createdAt,
      });
      if (insertError) {
        const { data: savedRepair, error: lookupError } = await supabase.from('repairs')
          .select('id').eq('client_request_id', request.id).maybeSingle();
        if (lookupError || !savedRepair) throw insertError;
      }

      clearRequestToken(repairRequest);
      setFormData(initialForm);
      setShowAddModal(false);
      setMessage('Repair job saved. The database marks available stock as Repair and tracks the cost once on completion.');
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      console.error('Error saving repair:', err);
      setError(err.message || 'Repair job could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (repair, newStatus) => {
    if (saving || ['Completed', 'Cancelled'].includes(repair.status) || !repairStatuses.includes(newStatus)) return;

    if (newStatus === 'Completed') {
      const cost = (Number(repair.labour_cost) || 0) + (Number(repair.parts_cost) || 0);
      const phoneName = `${repair.phones?.brand || ''} ${repair.phones?.model || ''}`.trim();
      const confirmed = window.confirm(
        `Complete this repair for ${phoneName || 'the linked phone'}? The database trigger will add ₹${cost.toLocaleString('en-IN')} to the phone's repair cost. This completed job cannot be reopened from this page.`
      );
      if (!confirmed) return;
    } else if (newStatus === 'Cancelled') {
      const confirmed = window.confirm('Cancel this repair job? It will remain in history and will not add repair cost to the phone.');
      if (!confirmed) return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data: updatedRepair, error: updateError } = await supabase.from('repairs')
        .update({
          status: newStatus,
          completed_at: newStatus === 'Completed' ? new Date().toISOString() : null,
        })
        .eq('id', repair.id)
        .neq('status', 'Completed')
        .neq('status', 'Cancelled')
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!updatedRepair) throw new Error('The repair status changed or is no longer available. Refresh the repair list before trying again.');
      setMessage(newStatus === 'Completed'
        ? 'Repair completed; the database trigger applied the cost once and returned the phone to its prior stock state.'
        : newStatus === 'Cancelled' ? 'Repair cancelled and retained in history.' : 'Repair status updated.');
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      console.error('Error updating repair status:', err);
      setError(err.message || 'Repair status could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: '16px 20px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div>
          <h3 style={{ margin: 0, color: '#0f172a' }}>Repair & Service Management</h3>
          <span style={{ fontSize: '13px', color: '#64748b' }}>Each repair is linked to a phone record in stock.</span>
        </div>
        <button onClick={() => { setError(''); setMessage(''); setShowAddModal(true); }} style={{ padding: '10px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
          New Repair Job
        </button>
      </div>

      {error && <div role="alert" style={{ padding: '12px 16px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px' }}>{error}</div>}
      {message && <div role="status" style={{ padding: '12px 16px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '8px' }}>{message}</div>}

      {showAddModal && (
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h4 style={{ margin: 0, color: '#0f172a' }}>New Repair Job</h4>
            <button type="button" onClick={() => setShowAddModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold', color: '#dc2626' }}>Cancel</button>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#92400e' }}>The current database requires a linked phone record. Customer-owned devices that are not in the phones table cannot be recorded in this repair workflow.</p>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <select value={formData.phone_id} onChange={e => setFormData({ ...formData, phone_id: e.target.value })} required style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
              <option value="">Choose phone *</option>
              {phones.filter(phone => !phone.archived_at && ['Available', 'Sold'].includes(phone.status)).map(phone => <option key={phone.id} value={phone.id}>{phone.stock_code} — {phone.brand} {phone.model} ({phone.status})</option>)}
            </select>
            <input type="text" placeholder="Repair issue *" value={formData.issue} onChange={e => setFormData({ ...formData, issue: e.target.value })} required style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
            <input type="text" placeholder="Technician" value={formData.technician} onChange={e => setFormData({ ...formData, technician: e.target.value })} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
            <input type="number" min="0" step="0.01" placeholder="Labour cost" value={formData.labour_cost} onChange={e => setFormData({ ...formData, labour_cost: e.target.value })} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
            <input type="number" min="0" step="0.01" placeholder="Parts cost" value={formData.parts_cost} onChange={e => setFormData({ ...formData, parts_cost: e.target.value })} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
            <textarea placeholder="Notes" value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', minHeight: '40px' }} />
            <button type="submit" disabled={saving || loading || !phones.some(phone => !phone.archived_at && ['Available', 'Sold'].includes(phone.status))} style={{ gridColumn: '1 / -1', padding: '10px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
              {saving ? 'Saving...' : 'Save Job Card'}
            </button>
          </form>
        </div>
      )}

      <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#64748b' }}>Loading repair jobs...</p>
        ) : repairs.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#64748b' }}>No repair jobs found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '10px' }}>Started</th>
                  <th style={{ padding: '10px' }}>Phone</th>
                  <th style={{ padding: '10px' }}>Issue</th>
                  <th style={{ padding: '10px' }}>Technician</th>
                  <th style={{ padding: '10px' }}>Repair Cost</th>
                  <th style={{ padding: '10px' }}>Status</th>
                  <th style={{ padding: '10px' }}>Update</th>
                </tr>
              </thead>
              <tbody>
                {repairs.map(repair => {
                  const statuses = [...new Set([repair.status, ...repairStatuses])];
                  const repairCost = (Number(repair.labour_cost) || 0) + (Number(repair.parts_cost) || 0);
                  return (
                    <tr key={repair.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px', color: '#64748b', fontSize: '12px' }}>{repair.started_at ? new Date(repair.started_at).toLocaleDateString('en-IN') : 'N/A'}</td>
                      <td style={{ padding: '10px' }}><strong>{repair.phones?.brand} {repair.phones?.model}</strong><div style={{ fontSize: '11px', color: '#64748b' }}>{repair.phones?.stock_code || 'Phone record unavailable'}</div></td>
                      <td style={{ padding: '10px' }}>{repair.issue}</td>
                      <td style={{ padding: '10px' }}>{repair.technician || '—'}</td>
                      <td style={{ padding: '10px', fontWeight: 'bold' }}>₹{repairCost.toLocaleString('en-IN')}</td>
                      <td style={{ padding: '10px' }}>{repair.status}</td>
                      <td style={{ padding: '10px' }}>
                        <select value={repair.status} disabled={saving || ['Completed', 'Cancelled'].includes(repair.status)} onChange={e => handleStatusChange(repair, e.target.value)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}>
                          {statuses.map(status => <option key={status} value={status}>{status}</option>)}
                        </select>
                        {repair.completed_at && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>{new Date(repair.completed_at).toLocaleDateString('en-IN')}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
