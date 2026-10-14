import React, { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { fetchAllRows } from './fetchAllRows.js';

export default function StockMovements() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const fetchMovements = async () => {
    setLoading(true);
    try {
      const result = await fetchAllRows(() => supabase
        .from('stock_movements')
        .select(`
          id,
          movement_date,
          movement_type,
          quantity,
          notes,
          phones ( brand, model, imei_1, status )
        `, { count: 'exact' })
        .order('movement_date', { ascending: false })
        .order('id', { ascending: true }));

      setMovements(result.data);
      setLoadError('');
    } catch (err) {
      console.error('Error fetching stock movements:', err);
      setLoadError(err.message || 'Stock movements could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMovements();
  }, []);

  const filteredMovements = movements.filter((item) => {
    if (filterType === 'ALL') return true;
    return String(item.movement_type || '').toLowerCase() === filterType.toLowerCase();
  });

  const getBadgeStyle = (type) => {
    switch (String(type || '').toUpperCase()) {
      case 'IN':
      case 'PURCHASE':
        return { backgroundColor: '#dcfce7', color: '#166534', label: '📥 IN / Purchase' };
      case 'OUT':
      case 'SALE':
        return { backgroundColor: '#fee2e2', color: '#991b1b', label: '📤 OUT / Sale' };
      case 'REPAIR':
        return { backgroundColor: '#fef3c7', color: '#92400e', label: '🛠️ Repair' };
      default:
        return { backgroundColor: '#f1f5f9', color: '#475569', label: type };
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>स्टॉक हिस्ट्री लोड हो रही है...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '100%' }}>
      
      {/* Header & Filter */}
      <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '18px' }}>🔄 Stock Movements (स्टॉक की हिस्ट्री)</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>स्टॉक में कब कौन सा फोन आया या गया, उसकी पूरी जानकारी</p>
        </div>

        {/* Filter Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {['ALL', 'Purchase', 'Sale', 'Repair'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: filterType === type ? '#0f172a' : '#fff',
                color: filterType === type ? '#fff' : '#334155',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {type === 'ALL' ? 'सभी' : type}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div role="alert" style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: '8px' }}>
          {loadError}
        </div>
      )}
      {!loadError && movements.length === 0 && (
        <div role="note" style={{ backgroundColor: '#fff7ed', color: '#9a3412', padding: '12px 16px', borderRadius: '8px', fontSize: '12px' }}>
          No rows were returned. The supplied policy check showed an INSERT policy but did not confirm SELECT access, so verify stock_movements SELECT RLS before treating this as an empty ledger.
        </div>
      )}

      {/* Movements Table */}
      <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
              <th style={{ padding: '10px' }}>तारीख & समय</th>
              <th style={{ padding: '10px' }}>मूवमेंट टाइप</th>
              <th style={{ padding: '10px' }}>फोन विवरण</th>
              <th style={{ padding: '10px' }}>IMEI / SN</th>
              <th style={{ padding: '10px' }}>विवरण / नोट्स</th>
            </tr>
          </thead>
          <tbody>
            {filteredMovements.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                  कोई स्टॉक मूवमेंट रिकॉर्ड नहीं मिला।
                </td>
              </tr>
            ) : (
              filteredMovements.map((item) => {
                const badge = getBadgeStyle(item.movement_type);
                return (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {item.movement_date ? new Date(item.movement_date).toLocaleString('hi-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }) : 'N/A'}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        backgroundColor: badge.backgroundColor,
                        color: badge.color
                      }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px', fontWeight: 'bold', color: '#0f172a' }}>
                      {item.phones ? `${item.phones.brand} ${item.phones.model}` : 'N/A'}
                    </td>
                    <td style={{ padding: '10px', color: '#334155', fontFamily: 'monospace' }}>
                      {item.phones?.imei_1 || 'N/A'}
                    </td>
                    <td style={{ padding: '10px', color: '#64748b' }}>
                      {item.notes || '-'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
