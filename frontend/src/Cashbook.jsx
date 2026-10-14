import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import { clearRequestToken, getRequestToken } from './requestTokens';
import { dateWindow, localDateString } from './cashbookDates.js';

const today = () => localDateString(new Date());
const formatMoney = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function Cashbook() {
  const [transactions, setTransactions] = useState([]);
  const [transferRows, setTransferRows] = useState([]);
  const [accountSummaryRows, setAccountSummaryRows] = useState([]);
  const [openingBalances, setOpeningBalances] = useState([]);
  const [openingDrafts, setOpeningDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [transfersTruncated, setTransfersTruncated] = useState(false);
  const [filterType, setFilterType] = useState('ALL');
  const [filterMode, setFilterMode] = useState('ALL');
  const [filterPeriod, setFilterPeriod] = useState('current_month');
  const [customStart, setCustomStart] = useState(today());
  const [customEnd, setCustomEnd] = useState(today());
  const [search, setSearch] = useState('');
  const [transfer, setTransfer] = useState({ from: 'Cash', to: 'Bank', amount: '', date: today(), notes: '' });
  const transferRequest = useRef(null);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const range = dateWindow(filterPeriod, customStart, customEnd);
      if (!range) throw new Error('Choose a start and end date for the custom range.');
      if (new Date(range.start) > new Date(range.end)) throw new Error('Start date must be before end date.');
      let transactionQuery = supabase.from('money_transactions')
        .select('id, transaction_type, amount, category, payment_mode, reference_id, notes, transaction_date', { count: 'exact' })
        .gte('transaction_date', range.start).lt('transaction_date', range.end)
        .order('transaction_date', { ascending: false }).range(0, 999);
      let transferQuery = supabase.from('internal_transfers')
        .select('id, from_account, to_account, amount, transfer_date, notes', { count: 'exact' })
        .gte('transfer_date', range.start).lt('transfer_date', range.end)
        .order('transfer_date', { ascending: false }).limit(500);
      const [ledgerResult, transfersResult, summaryResult, openingResult] = await Promise.all([
        transactionQuery,
        transferQuery,
        supabase.rpc('cashbook_account_summary', { p_start: range.start, p_end: range.end }),
        supabase.from('account_opening_balances').select('account, opening_amount, opening_date'),
      ]);
      if (ledgerResult.error) throw ledgerResult.error;
      if (transfersResult.error) throw transfersResult.error;
      if (summaryResult.error) throw summaryResult.error;
      if (openingResult.error) throw openingResult.error;
      setTransactions(ledgerResult.data || []);
      setTransferRows(transfersResult.data || []);
      setAccountSummaryRows(summaryResult.data || []);
      setOpeningBalances(openingResult.data || []);
      setOpeningDrafts(Object.fromEntries((openingResult.data || []).map(row => [row.account, {
        amount: String(row.opening_amount),
        opening_date: new Date(row.opening_date).toLocaleDateString('en-CA'),
      }])));
      setTruncated((ledgerResult.count || 0) > 1000);
      setTransfersTruncated((transfersResult.count || 0) > 500);
    } catch (err) {
      setTransactions([]);
      setTransferRows([]);
      setAccountSummaryRows([]);
      setOpeningBalances([]);
      setTransfersTruncated(false);
      setLoadError(err.message || 'Cashbook could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filterPeriod, customStart, customEnd]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);
  useEffect(() => {
    const refresh = () => loadTransactions();
    window.addEventListener('rj-data-updated', refresh);
    return () => window.removeEventListener('rj-data-updated', refresh);
  }, [loadTransactions]);

  const filteredTransactions = useMemo(() => transactions.filter(tx => {
    const typeMatches = filterType === 'ALL' || tx.transaction_type?.toLowerCase() === filterType.toLowerCase();
    const modeMatches = filterMode === 'ALL' || tx.payment_mode?.toLowerCase() === filterMode.toLowerCase();
    const searchMatches = `${tx.category || ''} ${tx.notes || ''} ${tx.payment_mode || ''}`.toLowerCase().includes(search.toLowerCase());
    return typeMatches && modeMatches && searchMatches;
  }), [transactions, filterType, filterMode, search]);

  const accountSummary = useMemo(() => ['Cash', 'UPI', 'Bank'].map(account => {
    const row = accountSummaryRows.find(item => item.account === account);
    return {
      account,
      openingBalance: row?.opening_balance == null ? null : Number(row.opening_balance),
      openingBalanceDate: row?.opening_balance_date || null,
      inflow: Number(row?.cash_in || 0),
      outflow: Number(row?.cash_out || 0),
      movement: Number(row?.net_movement || 0),
      closingBalance: row?.closing_balance == null ? null : Number(row.closing_balance),
    };
  }), [accountSummaryRows]);

  const handleOpeningBalanceSave = async account => {
    const draft = openingDrafts[account] || {};
    const amount = Number(draft.amount);
    const openingAt = draft.opening_date ? new Date(`${draft.opening_date}T00:00:00`) : null;
    if (saving || !Number.isFinite(amount) || (account !== 'Bank' && amount < 0)
      || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001
      || !openingAt || !Number.isFinite(openingAt.getTime())) {
      setLoadError('Enter a valid opening amount and effective date. Cash and UPI opening amounts cannot be negative.');
      return;
    }
    setSaving(true);
    setLoadError('');
    setMessage('');
    try {
      const { error } = await supabase.from('account_opening_balances').upsert({
        account,
        opening_amount: amount,
        opening_date: openingAt.toISOString(),
      }, { onConflict: 'account' });
      if (error) throw error;
      setMessage(`${account} opening balance saved. Review the selected date range for the calculated closing balance.`);
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      setLoadError(err.message || 'Opening balance could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleTransfer = async event => {
    event.preventDefault();
    const amount = Number(transfer.amount);
    if (saving || !Number.isFinite(amount) || amount <= 0 || transfer.from === transfer.to
      || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
      setLoadError('Choose different accounts and enter a positive transfer amount.');
      return;
    }
    setSaving(true);
    setLoadError('');
    setMessage('');
    try {
      const transferPayload = {
        p_from_account: transfer.from,
        p_to_account: transfer.to,
        p_amount: amount,
        p_transfer_date: transfer.date ? new Date(`${transfer.date}T12:00:00`).toISOString() : new Date().toISOString(),
        p_notes: transfer.notes.trim() || null,
      };
      const request = await getRequestToken(transferRequest, transferPayload, 'internal-transfer');
      const { error } = await supabase.rpc('record_internal_transfer', { ...transferPayload, p_request_id: request.id });
      if (error) throw error;
      clearRequestToken(transferRequest);
      setTransfer({ from: 'Cash', to: 'Bank', amount: '', date: today(), notes: '' });
      setMessage('Transfer recorded between accounts; it is not treated as revenue or operating expense.');
      window.dispatchEvent(new Event('rj-data-updated'));
    } catch (err) {
      setLoadError(err.message || 'Transfer could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  const totals = accountSummary.reduce((summary, account) => ({
    inflow: summary.inflow + account.inflow,
    outflow: summary.outflow + account.outflow,
    movement: summary.movement + account.movement,
  }), { inflow: 0, outflow: 0, movement: 0 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
        {accountSummary.map(account => <div key={account.account} style={{ background: '#fff', padding: '16px', borderRadius: '10px', borderLeft: '4px solid #0284c7', boxShadow: '0 1px 3px #0000000d' }}>
          <strong>{account.account} — selected period</strong>
          <div style={{ marginTop: '8px', fontSize: '13px' }}>Opening balance: {account.openingBalance == null
            ? openingBalances.some(row => row.account === account.account) ? 'Not available before opening date' : 'Not configured'
            : formatMoney(account.openingBalance)}</div>
          <div style={{ fontSize: '13px' }}>In: {formatMoney(account.inflow)}</div>
          <div style={{ fontSize: '13px' }}>Out: {formatMoney(account.outflow)}</div>
          <div style={{ fontWeight: 700, marginTop: '5px' }}>Net movement: {formatMoney(account.movement)}</div>
          <div style={{ fontWeight: 700, marginTop: '5px' }}>Closing balance: {account.closingBalance == null ? 'Not verified' : formatMoney(account.closingBalance)}</div>
        </div>)}
        <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', borderLeft: '4px solid #16a34a', boxShadow: '0 1px 3px #0000000d' }}>
          <strong>All selected accounts</strong>
          <div style={{ marginTop: '8px', fontSize: '13px' }}>Cash in: {formatMoney(totals.inflow)}</div>
          <div style={{ fontSize: '13px' }}>Cash out: {formatMoney(totals.outflow)}</div>
          <div style={{ fontWeight: 700, marginTop: '5px' }}>Net movement: {formatMoney(totals.movement)}</div>
        </div>
      </div>

      <div style={{ background: '#fff', padding: '16px 18px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 6px' }}>Reconciled opening balances</h3>
        <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#64748b' }}>Enter balances verified from your cash count and bank/UPI records. Each amount applies immediately before ledger transactions on its effective date. No opening value is assumed.</p>
        <div style={{ display: 'grid', gap: '10px' }}>
          {['Cash', 'UPI', 'Bank'].map(account => {
            const draft = openingDrafts[account] || { amount: '', opening_date: today() };
            return <div key={account} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <strong style={{ minWidth: '55px' }}>{account}</strong>
              <input type="number" step="0.01" placeholder="Verified opening amount" value={draft.amount}
                onChange={event => setOpeningDrafts(previous => ({ ...previous, [account]: { ...draft, amount: event.target.value } }))} />
              <input type="date" value={draft.opening_date || today()}
                onChange={event => setOpeningDrafts(previous => ({ ...previous, [account]: { ...draft, opening_date: event.target.value } }))} />
              <button type="button" disabled={saving} onClick={() => handleOpeningBalanceSave(account)}>{saving ? 'Saving…' : 'Save opening balance'}</button>
            </div>;
          })}
        </div>
      </div>

      <div style={{ background: '#fff', padding: '16px 18px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 10px' }}>Internal transfer</h3>
        <form onSubmit={handleTransfer} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <select value={transfer.from} onChange={e => setTransfer({ ...transfer, from: e.target.value })}><option>Cash</option><option>UPI</option><option>Bank</option></select>
          <span>to</span>
          <select value={transfer.to} onChange={e => setTransfer({ ...transfer, to: e.target.value })}><option>Cash</option><option>UPI</option><option>Bank</option></select>
          <input type="number" min="0.01" step="0.01" placeholder="Amount" value={transfer.amount} onChange={e => setTransfer({ ...transfer, amount: e.target.value })} required />
          <input type="date" value={transfer.date} onChange={e => setTransfer({ ...transfer, date: e.target.value })} required />
          <input placeholder="Notes (optional)" value={transfer.notes} onChange={e => setTransfer({ ...transfer, notes: e.target.value })} />
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Record Transfer'}</button>
        </form>
      </div>

      <div style={{ background: '#fff', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <h3 style={{ margin: 0 }}>Money ledger</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">Current week</option><option value="current_month">Current month</option><option value="custom">Custom range</option></select>
            {filterPeriod === 'custom' && <><input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} /><input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></>}
            <select value={filterType} onChange={e => setFilterType(e.target.value)}><option value="ALL">All types</option><option value="Income">Inflow</option><option value="Expense">Outflow</option></select>
            <select value={filterMode} onChange={e => setFilterMode(e.target.value)}><option value="ALL">All accounts</option><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Bank">Bank</option></select>
            <input type="search" placeholder="Search category / note" value={search} onChange={e => setSearch(e.target.value)} />
            <button type="button" onClick={loadTransactions} disabled={loading}>Refresh</button>
          </div>
        </div>
        {loadError && <div role="alert" style={{ padding: '10px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', marginBottom: '12px' }}>{loadError}</div>}
        {message && <div role="status" style={{ padding: '10px 12px', background: '#dcfce7', color: '#166534', borderRadius: '6px', marginBottom: '12px' }}>{message}</div>}
        {truncated && <div role="note" style={{ padding: '10px 12px', background: '#fff7ed', color: '#9a3412', borderRadius: '6px', marginBottom: '12px' }}>Only the latest 1,000 transactions in this date range are loaded. The transaction list is incomplete; account summaries come from the database summary RPC.</div>}
        <p style={{ fontSize: '12px', color: '#92400e' }}>Opening and closing balances are shown only after you enter reconciled opening values. Collections and supplier payments affect accounts but are not P&amp;L revenue or expenses; transfers net to zero overall.</p>
        {loading ? <p>Loading ledger…</p> : filteredTransactions.length === 0 ? <p style={{ color: '#64748b' }}>No transactions in this date range.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead><tr style={{ background: '#f8fafc', color: '#64748b' }}><th style={{ padding: '10px' }}>Date</th><th style={{ padding: '10px' }}>Flow</th><th style={{ padding: '10px' }}>Category</th><th style={{ padding: '10px' }}>Account</th><th style={{ padding: '10px' }}>Amount</th><th style={{ padding: '10px' }}>Notes</th></tr></thead>
              <tbody>{filteredTransactions.map(tx => {
                const income = tx.transaction_type === 'Income';
                const transferRow = String(tx.category || '').startsWith('Internal Transfer');
                return <tr key={tx.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{new Date(tx.transaction_date).toLocaleString('en-IN')}</td>
                  <td style={{ padding: '10px' }}>{transferRow ? (income ? 'Transfer in' : 'Transfer out') : income ? 'Inflow' : 'Outflow'}</td>
                  <td style={{ padding: '10px' }}>{tx.category}</td><td style={{ padding: '10px' }}>{tx.payment_mode}</td>
                  <td style={{ padding: '10px', color: income ? '#15803d' : '#b91c1c', fontWeight: 700 }}>{income ? '+' : '−'}{formatMoney(tx.amount)}</td>
                  <td style={{ padding: '10px', color: '#64748b' }}>{tx.notes || '—'}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      {transferRows.length > 0 && <div style={{ background: '#fff', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}><h3>Transfers in selected period</h3>{transfersTruncated && <div role="note" style={{ marginBottom: 8, color: '#9a3412' }}>Only the latest 500 transfers are shown; the list is incomplete.</div>}{transferRows.map(row => <div key={row.id} style={{ padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>{row.from_account} → {row.to_account} · {formatMoney(row.amount)} · {new Date(row.transfer_date).toLocaleDateString('en-IN')}</div>)}</div>}
    </div>
  );
}
