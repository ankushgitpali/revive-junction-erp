import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { fetchAllRows } from './fetchAllRows.js';

export default function Stock() {
  const [phones, setPhones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCondition, setFilterCondition] = useState('All');
  const [statusFilter, setStatusFilter] = useState('Available');
  const [showArchived, setShowArchived] = useState(false);
  const [editingPhone, setEditingPhone] = useState(null);

  const fetchStock = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchAllRows(() => {
        let query = supabase.from('phones')
          .select('id, stock_code, brand, model, imei_1, ram, storage, condition, purchase_price, expected_selling_price, repair_cost, other_cost, status, purchase_date, archived_at, archived_reason', { count: 'exact' })
          .order('purchase_date', { ascending: false }).order('id', { ascending: true });
        query = showArchived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
        if (!showArchived && statusFilter !== 'All') query = query.eq('status', statusFilter);
        return query;
      });

      setPhones(result.data);
      setLoadError('');
    } catch (err) {
      setPhones([]);
      setLoadError(err.message || 'Stock could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [showArchived, statusFilter]);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  const handleArchive = async (id, model) => {
    if (window.confirm(`क्या आप ${model} को स्टॉक से हटाना चाहते हैं?`)) {
      try {
        const { error } = await supabase.rpc('archive_phone_atomic', { p_phone_id: id, p_reason: 'Archived from stock screen' });

        if (error) throw error;
        alert('फोन सफलता से हटा दिया गया!');
        window.dispatchEvent(new Event('rj-data-updated'));
        fetchStock();
      } catch (err) {
        alert('डिलीट करने में त्रुटि: ' + err.message);
      }
    }
  };

  const handleRestore = async (id) => {
    try {
      const { error } = await supabase.rpc('restore_phone_atomic', { p_phone_id: id });
      if (error) throw error;
      await fetchStock();
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      setLoadError(err.message || 'Phone could not be restored.');
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      const { data: updatedPhone, error } = await supabase
        .from('phones')
        .update({
          brand: editingPhone.brand,
          model: editingPhone.model,
          expected_selling_price: Number(editingPhone.expected_selling_price),
          condition: editingPhone.condition,
        })
        .eq('id', editingPhone.id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!updatedPhone) throw new Error('The phone could not be updated. It may have changed or is no longer available; refresh the stock list.');
      alert('स्टॉक सफलता से अपडेट हो गया!');
      setEditingPhone(null);
      fetchStock();
    } catch (err) {
      alert('अपडेट में त्रुटि: ' + err.message);
    }
  };

  const filteredPhones = phones.filter((p) => {
    const matchesSearch = `${p.brand} ${p.model} ${p.stock_code} ${p.imei_1 || ''}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesCond = filterCondition === 'All' || p.condition === filterCondition;
    return matchesSearch && matchesCond;
  });

  return (
    <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      {/* Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#0f172a' }}>📱 Available Stock Management</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>वर्तमान में उपलब्ध सभी सेकंड-हैंड फोन्स</p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { setShowArchived(value => !value); setStatusFilter('Available'); }} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            {showArchived ? 'Show active stock' : 'Show archived'}
          </button>
          {!showArchived && <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
            <option value="Available">Available</option><option value="All">All active statuses</option><option value="Sold">Sold</option><option value="Repair">Repair</option><option value="Reserved">Reserved</option>
          </select>}
          <input
            type="text"
            placeholder="🔍 Brand, Model, IMEI, Code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '220px' }}
          />

          <select
            value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            <option value="All">All Conditions</option>
            <option value="Flawless">Flawless</option>
            <option value="Superb">Superb</option>
            <option value="Good">Good</option>
            <option value="Fair">Fair</option>
            <option value="Damaged">Damaged</option>
          </select>
        </div>
      </div>

      {/* Edit Modal */}
      {editingPhone && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <form onSubmit={handleUpdate} style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '10px', width: '400px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ margin: 0 }}>✏️ Edit Phone Details</h3>
            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Brand</label>
            <input type="text" value={editingPhone.brand} onChange={(e) => setEditingPhone({ ...editingPhone, brand: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            
            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Model</label>
            <input type="text" value={editingPhone.model} onChange={(e) => setEditingPhone({ ...editingPhone, model: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />

            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Purchase Price (₹)</label>
            <input type="number" value={editingPhone.purchase_price} readOnly style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', background: '#f1f5f9' }} />

            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Expected Selling Price (₹)</label>
            <input type="number" value={editingPhone.expected_selling_price} onChange={(e) => setEditingPhone({ ...editingPhone, expected_selling_price: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
              <button type="button" onClick={() => setEditingPhone(null)} style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}>Cancel</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '4px', backgroundColor: '#0284c7', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* Stock Table */}
      {loadError && <div role="alert" style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px' }}>{loadError}</div>}
      {loading ? (
        <p>लोड हो रहा है...</p>
      ) : filteredPhones.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>कोई स्टॉक नहीं मिला।</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '12px' }}>Code</th>
              <th style={{ padding: '12px' }}>Device</th>
              <th style={{ padding: '12px' }}>Specs</th>
              <th style={{ padding: '12px' }}>Condition</th>
              <th style={{ padding: '12px' }}>Buy Price</th>
              <th style={{ padding: '12px' }}>Exp. Sale</th>
              <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPhones.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px', fontWeight: 'bold', color: '#0284c7' }}>{p.stock_code}</td>
                <td style={{ padding: '12px' }}>
                  <strong>{p.brand} {p.model}</strong>
                  {p.imei_1 && <div style={{ fontSize: '11px', color: '#94a3b8' }}>IMEI: {p.imei_1}</div>}
                </td>
                <td style={{ padding: '12px', color: '#475569' }}>{p.ram || '-'} / {p.storage || '-'}</td>
                <td style={{ padding: '12px' }}>
                  <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', backgroundColor: p.condition === 'Flawless' ? '#dcfce7' : p.condition === 'Good' ? '#e0f2fe' : '#fef3c7', color: p.condition === 'Flawless' ? '#15803d' : p.condition === 'Good' ? '#0369a1' : '#b45309' }}>
                    {p.condition}
                  </span>
                </td>
                <td style={{ padding: '12px', fontWeight: 'bold' }}>₹{Number(p.purchase_price).toLocaleString('en-IN')}</td>
                <td style={{ padding: '12px', color: '#16a34a', fontWeight: 'bold' }}>₹{Number(p.expected_selling_price).toLocaleString('en-IN')}</td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  <button onClick={() => setEditingPhone(p)} style={{ padding: '4px 8px', marginRight: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>✏️ Edit</button>
                  {showArchived ? (
                    <button onClick={() => handleRestore(p.id)} style={{ padding: '4px 8px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Restore</button>
                  ) : p.status === 'Available' ? (
                    <button onClick={() => handleArchive(p.id, `${p.brand} ${p.model}`)} style={{ padding: '4px 8px', backgroundColor: '#b45309', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Archive</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
