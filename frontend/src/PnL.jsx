import React, { useCallback, useState, useEffect } from 'react';
import { supabase } from './supabase';
import { buildSaleAccountingEvents, summarizeSaleAccountingEvents } from './pnlCalculations.js';
import { matchesPnlPeriod, pnlPeriodLabel } from './pnlDateFilters.js';
import { areCountedQueryResultsComplete } from './countedQueryCompleteness.js';
import { fetchAllRows } from './fetchAllRows.js';

export default function Pnl() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [timeFilter, setTimeFilter] = useState('current_month');
  
  const [stats, setStats] = useState({
    totalSales: 0,
    grossProfit: 0,
    totalExpenses: 0,
    netProfit: 0,
    totalPhones: 0,
    totalReturns: 0,
    estimatedCostSales: 0,
    missingCostSales: 0,
  });

  const [monthlyData, setMonthlyData] = useState([]);
  
  const [budgetData, setBudgetData] = useState({
    'Below ₹5,000': { revenue: 0, profit: 0 },
    '₹5,000 – ₹10,000': { revenue: 0, profit: 0 },
    '₹10,000 – ₹15,000': { revenue: 0, profit: 0 },
    '₹15,000 – ₹20,000': { revenue: 0, profit: 0 },
    '₹20,000 – ₹30,000': { revenue: 0, profit: 0 },
    'Above ₹30,000': { revenue: 0, profit: 0 }
  });

  const [brandData, setBrandData] = useState({
    'Apple': { revenue: 0, profit: 0 },
    'Vivo': { revenue: 0, profit: 0 },
    'Samsung': { revenue: 0, profit: 0 },
    'Realme': { revenue: 0, profit: 0 },
    'Oppo': { revenue: 0, profit: 0 },
    'Others': { revenue: 0, profit: 0 }
  });

  const fetchAndProcessData = useCallback(async () => {
    try {
      const [salesRes, returnsRes, phonesRes, expensesRes] = await Promise.all([
        fetchAllRows(() => supabase.from('sales').select('*', { count: 'exact' }).order('sale_date', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sale_returns').select('sale_id, phone_id, refund_amount, refund_allocations, return_date', { count: 'exact' }).order('sale_id', { ascending: true })),
        fetchAllRows(() => supabase.from('phones').select('*', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('expenses').select('amount, expense_date', { count: 'exact' }).order('id', { ascending: true })),
      ]);
      const queryError = salesRes.error || returnsRes.error || phonesRes.error || expensesRes.error;
      if (queryError) throw queryError;
      if (!areCountedQueryResultsComplete([salesRes, returnsRes, phonesRes, expensesRes])) {
        throw new Error('P&L source records are incomplete or their exact counts could not be verified. No partial financial totals are shown.');
      }
      setLoadError('');

      const rawSales = salesRes.data || [];
      const rawReturns = returnsRes.data || [];
      const phonesList = phonesRes.data || [];
      const rawExpenses = expensesRes.data || [];

      const phonesMap = new Map(phonesList.map(phone => [phone.id, phone]));
      
      // Time Normalization & Filtering
      const now = new Date();
      const matchesSelectedPeriod = date => matchesPnlPeriod(date, timeFilter, now);
      const events = buildSaleAccountingEvents(rawSales, rawReturns, phonesMap, matchesSelectedPeriod);
      const summary = summarizeSaleAccountingEvents(events);
      const returnsBySaleId = new Map(rawReturns.map(saleReturn => [saleReturn.sale_id, saleReturn]));
      const visibleSales = rawSales
        .filter(sale => matchesSelectedPeriod(sale.sale_date)
          || matchesSelectedPeriod(returnsBySaleId.get(sale.id)?.return_date))
        .map(sale => ({
          ...sale,
          return_date: returnsBySaleId.get(sale.id)?.return_date || null,
          returned_at: sale.returned_at || returnsBySaleId.get(sale.id)?.return_date || null,
          resolved_model: sale.phone_details || sale.model_name
            || phonesMap.get(sale.phone_id)?.model || phonesMap.get(sale.phone_id)?.name || 'Unknown Model',
        }));
      setSales(visibleSales);

      let tSales = summary.revenue;
      let tProfit = summary.grossProfit;
      const estimatedCostSales = summary.estimatedCostSales;
      const missingCostSales = summary.missingCostSales;
      let totalExpenses = 0;
      
      let bCounts = {
        'Below ₹5,000': { revenue: 0, profit: 0 },
        '₹5,000 – ₹10,000': { revenue: 0, profit: 0 },
        '₹10,000 – ₹15,000': { revenue: 0, profit: 0 },
        '₹15,000 – ₹20,000': { revenue: 0, profit: 0 },
        '₹20,000 – ₹30,000': { revenue: 0, profit: 0 },
        'Above ₹30,000': { revenue: 0, profit: 0 }
      };

      let brCounts = {
        'Apple': { revenue: 0, profit: 0 },
        'Vivo': { revenue: 0, profit: 0 },
        'Samsung': { revenue: 0, profit: 0 },
        'Realme': { revenue: 0, profit: 0 },
        'Oppo': { revenue: 0, profit: 0 },
        'Others': { revenue: 0, profit: 0 }
      };

      let monthMap = {};

      events.forEach(event => {
        const curr = event.sale;
        const revenue = event.revenueCents / 100;
        const profit = event.grossProfitCents === null ? null : event.grossProfitCents / 100;
        const price = event.priceCents / 100;
        const relatedItem = phonesMap.get(curr.phone_id) || {};
        const modelName = curr.phone_details || curr.model_name || relatedItem.model || relatedItem.name || 'Unknown Model';
        const brandName = (curr.brand || relatedItem.brand || modelName).toLowerCase();

        // Budget categorization based on selling price
        let bKey = 'Above ₹30,000';
        if (price < 5000) bKey = 'Below ₹5,000';
        else if (price <= 10000) bKey = '₹5,000 – ₹10,000';
        else if (price <= 15000) bKey = '₹10,000 – ₹15,000';
        else if (price <= 20000) bKey = '₹15,000 – ₹20,000';
        else if (price <= 30000) bKey = '₹20,000 – ₹30,000';

        bCounts[bKey].revenue += revenue;
        if (profit !== null) bCounts[bKey].profit += profit;

        // Brand categorization
        let brKey = 'Others';
        if (brandName.includes('apple') || brandName.includes('iphone')) brKey = 'Apple';
        else if (brandName.includes('vivo')) brKey = 'Vivo';
        else if (brandName.includes('samsung')) brKey = 'Samsung';
        else if (brandName.includes('realme')) brKey = 'Realme';
        else if (brandName.includes('oppo')) brKey = 'Oppo';

        brCounts[brKey].revenue += revenue;
        if (profit !== null) brCounts[brKey].profit += profit;

        const d = new Date(event.date);
        const mKey = d.toLocaleString('default', { month: 'long', year: 'numeric' });
        if (!monthMap[mKey]) monthMap[mKey] = { revenue: 0, profit: 0, returns: 0 };
        monthMap[mKey].revenue += revenue;
        if (profit !== null) monthMap[mKey].profit += profit;
        if (event.kind === 'return') monthMap[mKey].returns += 1;
      });

      rawExpenses.forEach(expense => {
        if (matchesPnlPeriod(expense.expense_date, timeFilter, now)
          && Number.isFinite(Number(expense.amount))) totalExpenses += Number(expense.amount);
      });

      setStats({
        totalSales: tSales,
        grossProfit: tProfit,
        totalExpenses,
        netProfit: tProfit - totalExpenses,
        totalPhones: summary.saleCount,
        totalReturns: summary.returnCount,
        estimatedCostSales,
        missingCostSales,
      });

      setBudgetData(bCounts);
      setBrandData(brCounts);

      const sortedMonths = Object.keys(monthMap).map(m => ({
        month: m,
        revenue: monthMap[m].revenue,
        profit: monthMap[m].profit
      }));
      setMonthlyData(sortedMonths);

    } catch (err) {
      console.error('Error processing P&L data:', err.message);
      setLoadError(err.message || 'P&L data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [timeFilter]);

  const refreshData = useCallback(() => {
    setLoading(true);
    fetchAndProcessData();
  }, [fetchAndProcessData]);

  useEffect(() => {
    fetchAndProcessData();
    window.addEventListener('rj-data-updated', refreshData);
    return () => window.removeEventListener('rj-data-updated', refreshData);
  }, [fetchAndProcessData, refreshData]);

  const maxRevenue = Math.max(...monthlyData.map(d => Math.abs(d.revenue)), 100000);
  const maxBudgetVal = Math.max(...Object.values(budgetData).map(b => Math.max(Math.abs(b.revenue), Math.abs(b.profit))), 10000);
  const maxBrandVal = Math.max(...Object.values(brandData).map(b => Math.max(Math.abs(b.revenue), Math.abs(b.profit))), 10000);

  if (loading) return <div role="status" style={{ padding: '40px', textAlign: 'center' }}>Loading P&amp;L data…</div>;
  if (loadError) {
    return (
      <div role="alert" style={{ margin: 24, padding: 16, background: '#fee2e2', color: '#991b1b', borderRadius: 8 }}>
        <p style={{ marginTop: 0 }}>P&amp;L data could not be loaded: {loadError}</p>
        <button type="button" onClick={refreshData}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1250px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      
      {/* Top Header & Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>📈 Profit & Loss Analytics HQ</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>Sales in period: <b>{stats.totalPhones}</b> · return adjustments: <b>{stats.totalReturns}</b></p>
        </div>

        <div style={{ display: 'flex', background: '#e2e8f0', padding: '4px', borderRadius: '8px', gap: '4px' }}>
          {[
            { id: 'current_month', label: 'Current Month' },
            { id: 'last_month', label: 'Last Month' },
            { id: 'last_3', label: 'Last 3 Months' },
            { id: 'last_6', label: 'Last 6 Months' },
            { id: 'full_year', label: 'Full Year' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                if (timeFilter === tab.id) return;
                setLoading(true);
                setTimeFilter(tab.id);
              }}
              style={{
                background: timeFilter === tab.id ? '#2563eb' : 'transparent',
                color: timeFilter === tab.id ? '#fff' : '#475569',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                fontWeight: '700',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {(stats.estimatedCostSales > 0 || stats.missingCostSales > 0) && (
        <div role="note" style={{ marginBottom: '16px', padding: '12px 16px', background: '#fff7ed', color: '#9a3412', borderRadius: '8px' }}>
          Gross profit is incomplete: {stats.estimatedCostSales > 0 && `${stats.estimatedCostSales} sale(s) use current phone costs because no sale-time snapshot or legacy sale cost is available.`}
          {stats.estimatedCostSales > 0 && stats.missingCostSales > 0 ? ' ' : ''}
          {stats.missingCostSales > 0 && `${stats.missingCostSales} sale(s) have no recorded cost and are excluded from gross profit.`}
          {' '}No historical cost has been inferred.
        </div>
      )}

      {/* Summary Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#fff', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #2563eb' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>Net Revenue (sales less returns)</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', marginTop: '6px' }}>₹{stats.totalSales.toLocaleString()}</div>
        </div>

        <div style={{ background: '#fff', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #059669' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>ग्रॉस मार्जिन (Gross Profit)</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#059669', marginTop: '6px' }}>₹{stats.grossProfit.toLocaleString()}</div>
        </div>

        <div style={{ background: '#fff', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>कुल खर्च (Total Expenses)</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#dc2626', marginTop: '6px' }}>₹{stats.totalExpenses.toLocaleString()}</div>
        </div>

        <div style={{ background: '#fff', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0', borderLeft: '4px solid #10b981' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>शुद्ध लाभ (Net Profit)</div>
          <div style={{ fontSize: '22px', fontWeight: '800', color: '#10b981', marginTop: '6px' }}>₹{stats.netProfit.toLocaleString()}</div>
        </div>
      </div>

      {/* Monthly Chart Section */}
      <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>📊 Dual Analysis: Monthly Revenue vs. Gross Profit</h3>
          <div style={{ display: 'flex', gap: '16px', fontSize: '12px', fontWeight: '700' }}>
            <span style={{ color: '#2563eb' }}>■ Revenue</span>
            <span style={{ color: '#059669' }}>■ Gross Profit</span>
          </div>
        </div>

        {monthlyData.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>Is time period ke liye koi data available nahi hai.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {monthlyData.map((item, idx) => (
              <div key={idx} style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '700', marginBottom: '8px', color: '#334155' }}>
                  <span>{item.month}</span>
                  <span>Rev: ₹{item.revenue.toLocaleString()} | Profit: <span style={{ color: '#059669' }}>₹{item.profit.toLocaleString()}</span></span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', width: '50px' }}>Revenue</span>
                    <div style={{ flex: 1, backgroundColor: '#e2e8f0', borderRadius: '4px', height: '12px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min((Math.abs(item.revenue) / maxRevenue) * 100, 100)}%`, backgroundColor: item.revenue < 0 ? '#dc2626' : '#2563eb', height: '100%', borderRadius: '4px' }}></div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b', width: '50px' }}>Profit</span>
                    <div style={{ flex: 1, backgroundColor: '#e2e8f0', borderRadius: '4px', height: '12px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min((Math.abs(item.profit) / maxRevenue) * 100, 100)}%`, backgroundColor: item.profit < 0 ? '#dc2626' : '#059669', height: '100%', borderRadius: '4px' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Budget & Brand Breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>📉 Budget-Wise Contribution</h3>
            <div style={{ display: 'flex', gap: '10px', fontSize: '11px', fontWeight: '700' }}>
              <span style={{ color: '#7c3aed' }}>■ Rev</span>
              <span style={{ color: '#059669' }}>■ Profit</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {Object.entries(budgetData).map(([range, data], idx) => (
              <div key={idx} style={{ padding: '10px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                  <span>{range}</span>
                  <span>Rev: ₹{data.revenue.toLocaleString()} | <span style={{ color: '#059669' }}>Prof: ₹{data.profit.toLocaleString()}</span></span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ backgroundColor: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min((Math.abs(data.revenue) / maxBudgetVal) * 100, 100)}%`, backgroundColor: data.revenue < 0 ? '#dc2626' : '#7c3aed', height: '100%', borderRadius: '4px' }}></div>
                  </div>
                  <div style={{ backgroundColor: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min((Math.abs(data.profit) / maxBudgetVal) * 100, 100)}%`, backgroundColor: data.profit < 0 ? '#dc2626' : '#059669', height: '100%', borderRadius: '4px' }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>📱 Brand-Wise Distribution</h3>
            <div style={{ display: 'flex', gap: '10px', fontSize: '11px', fontWeight: '700' }}>
              <span style={{ color: '#0284c7' }}>■ Rev</span>
              <span style={{ color: '#059669' }}>■ Profit</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {Object.entries(brandData).map(([brand, data], idx) => (
              <div key={idx} style={{ padding: '10px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                  <span>{brand}</span>
                  <span>Rev: ₹{data.revenue.toLocaleString()} | <span style={{ color: '#059669' }}>Prof: ₹{data.profit.toLocaleString()}</span></span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ backgroundColor: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min((Math.abs(data.revenue) / maxBrandVal) * 100, 100)}%`, backgroundColor: data.revenue < 0 ? '#dc2626' : '#0284c7', height: '100%', borderRadius: '4px' }}></div>
                  </div>
                  <div style={{ backgroundColor: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min((Math.abs(data.profit) / maxBrandVal) * 100, 100)}%`, backgroundColor: data.profit < 0 ? '#dc2626' : '#059669', height: '100%', borderRadius: '4px' }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sales Table */}
      <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>Recent Sales & Invoices ({pnlPeriodLabel(timeFilter)})</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b' }}>
                <th style={{ padding: '10px' }}>Invoice No</th>
                <th style={{ padding: '10px' }}>Customer Name</th>
                <th style={{ padding: '10px' }}>Phone Model / Brand</th>
                <th style={{ padding: '10px' }}>Selling Price</th>
                <th style={{ padding: '10px' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px', fontWeight: '700' }}>{s.invoice_no || 'N/A'}</td>
                  <td style={{ padding: '10px' }}>{s.customer_name || 'Walk-in'}</td>
                  <td style={{ padding: '10px', fontWeight: '600', color: '#2563eb' }}>{s.resolved_model}</td>
                  <td style={{ padding: '10px', color: '#059669', fontWeight: '700' }}>₹{s.selling_price || s.price || 0}{s.returned_at && <div style={{ color: '#b91c1c', fontSize: 11 }}>Returned {new Date(s.return_date || s.returned_at).toLocaleDateString()}</div>}</td>
                  <td style={{ padding: '10px', color: '#64748b' }}>{new Date(s.sale_date).toLocaleDateString() || 'N/A'}</td>
                </tr>
              ))}
              {sales.length === 0 && !loading && (
                <tr>
                  <td colSpan="5" style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                    Selected time filter ke liye koi sales record nahi mila.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}