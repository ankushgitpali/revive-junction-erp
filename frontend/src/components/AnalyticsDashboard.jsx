import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export default function AnalyticsDashboard() {
  const [analyticsData, setAnalyticsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ revenue: 0, profit: 0, roi: 0, units: 0 });

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      // 1. Try fetching from the SQL view first
      let { data, error } = await supabase
        .from('v_inventory_roi_analytics')
        .select('*')
        .order('total_profit', { ascending: false });

      // 2. Fallback if view is missing or errors out
      if (error || !data || data.length === 0) {
        const { data: salesData, error: salesError } = await supabase
          .from('sales')
          .select(`
            selling_price,
            phones (brand, model, purchase_price, repair_cost)
          `);

        if (salesError) throw salesError;

        const map = {};
        (salesData || []).forEach(s => {
          if (!s.phones) return;
          const key = `${s.phones.brand}_${s.phones.model}`;
          if (!map[key]) {
            map[key] = {
              brand: s.phones.brand,
              model: s.phones.model,
              total_units_sold: 0,
              total_revenue: 0,
              total_cost: 0,
              total_profit: 0
            };
          }
          const rev = Number(s.selling_price) || 0;
          const cost = (Number(s.phones.purchase_price) || 0) + (Number(s.phones.repair_cost) || 0);
          map[key].total_units_sold += 1;
          map[key].total_revenue += rev;
          map[key].total_cost += cost;
          map[key].total_profit += (rev - cost);
        });

        data = Object.values(map).map(item => ({
          ...item,
          roi_percentage: item.total_cost > 0 ? Number(((item.total_profit / item.total_cost) * 100).toFixed(1)) : 0
        })).sort((a, b) => b.total_profit - a.total_profit);
      }

      if (data && data.length > 0) {
        setAnalyticsData(data);
        const totalRev = data.reduce((acc, curr) => acc + (Number(curr.total_revenue) || 0), 0);
        const totalProf = data.reduce((acc, curr) => acc + (Number(curr.total_profit) || 0), 0);
        const totalCost = data.reduce((acc, curr) => acc + (Number(curr.total_cost) || 0), 0);
        const avgRoi = totalCost > 0 ? ((totalProf / totalCost) * 100).toFixed(1) : 0;
        const totalUnits = data.reduce((acc, curr) => acc + (Number(curr.total_units_sold) || 0), 0);

        setSummary({ revenue: totalRev, profit: totalProf, roi: avgRoi, units: totalUnits });
      }
    } catch (err) {
      console.error('Error fetching analytics:', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '32px', backgroundColor: '#090d16', minHeight: '100vh', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', borderBottom: '1px solid #1e293b', paddingBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#34d399' }}>📊 REVIVE JUNCTION HQ // ROI & PROFIT INTEL</h1>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>Real-time inventory turnover, brand margins, and capital growth analytics.</p>
        </div>
        <button onClick={fetchAnalytics} style={{ backgroundColor: '#059669', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
          {loading ? 'Refreshing...' : '🔄 Refresh Intel'}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '20px', borderRadius: '12px' }}>
          <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600', marginBottom: '8px' }}>Total Revenue</div>
          <div style={{ fontSize: '26px', fontWeight: '800', color: '#ffffff' }}>₹{summary.revenue.toLocaleString('en-IN')}</div>
        </div>
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '20px', borderRadius: '12px' }}>
          <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600', marginBottom: '8px' }}>Net Gross Profit</div>
          <div style={{ fontSize: '26px', fontWeight: '800', color: '#38bdf8' }}>₹{summary.profit.toLocaleString('en-IN')}</div>
        </div>
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '20px', borderRadius: '12px' }}>
          <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600', marginBottom: '8px' }}>Average ROI %</div>
          <div style={{ fontSize: '26px', fontWeight: '800', color: '#fbbf24' }}>{summary.roi}%</div>
        </div>
        <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', padding: '20px', borderRadius: '12px' }}>
          <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600', marginBottom: '8px' }}>Total Units Liquidated</div>
          <div style={{ fontSize: '26px', fontWeight: '800', color: '#c084fc' }}>{summary.units} Phones</div>
        </div>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #1e293b' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#ffffff' }}>Brand & Model Margin Breakdown</h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e293b', backgroundColor: '#050811', color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase' }}>
              <th style={{ padding: '14px 20px' }}>Brand / Model</th>
              <th style={{ padding: '14px 20px' }}>Units Sold</th>
              <th style={{ padding: '14px 20px' }}>Total Revenue</th>
              <th style={{ padding: '14px 20px' }}>Total Cost</th>
              <th style={{ padding: '14px 20px' }}>Net Profit</th>
              <th style={{ padding: '14px 20px' }}>ROI %</th>
            </tr>
          </thead>
          <tbody style={{ fontSize: '13px' }}>
            {analyticsData.length === 0 ? (
              <tr><td colSpan="6" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>No sales recorded yet. Complete a sale to view data.</td></tr>
            ) : (
              analyticsData.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '14px 20px', fontWeight: '700', color: '#ffffff' }}>{row.brand} ({row.model})</td>
                  <td style={{ padding: '14px 20px', color: '#cbd5e1' }}>{row.total_units_sold}</td>
                  <td style={{ padding: '14px 20px', color: '#cbd5e1' }}>₹{Number(row.total_revenue).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '14px 20px', color: '#94a3b8' }}>₹{Number(row.total_cost).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '14px 20px', fontWeight: '800', color: '#34d399' }}>₹{Number(row.total_profit).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '14px 20px'}}><span style={{ backgroundColor: '#064e3b', color: '#34d399', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>{row.roi_percentage}%</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}