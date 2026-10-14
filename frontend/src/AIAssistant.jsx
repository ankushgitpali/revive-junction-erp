import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { summarizeAiSales } from './aiSalesAnalytics.js';
import { fetchAllRows } from './fetchAllRows.js';

export default function AIAssistant() {
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: 'नमस्ते अंकुश! 👋 मैं Revive Junction का AI बिज़नेस असिस्टेंट हूँ। आप मुझसे दुकान के लाइव स्टॉक, बिक्री, खर्चों या प्रॉफ़िट के बारे में कोई भी सवाल पूछ सकते हैं।',
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [businessContext, setBusinessContext] = useState(null);
  const [contextError, setContextError] = useState('');
  const chatEndRef = useRef(null);

  const fetchBusinessData = useCallback(async () => {
    setLoading(true);
    setContextError('');
    try {
      const [phonesResult, salesResult, returnsResult, expensesResult, receivablesResult, payablesResult, moneyResult, settingsResult] = await Promise.all([
        fetchAllRows(() => supabase.from('phones').select('id, brand, model, status, purchase_price, repair_cost, other_cost, expected_selling_price, purchase_date, archived_at', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sales').select('id, phone_id, selling_price, discount, sale_date, returned_at, total_cost_snapshot, gross_profit_snapshot, phones(brand, purchase_price, repair_cost, other_cost)', { count: 'exact' }).order('sale_date', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('sale_returns').select('sale_id, return_date', { count: 'exact' }).order('return_date', { ascending: false }).order('sale_id', { ascending: true })),
        fetchAllRows(() => supabase.from('expenses').select('amount, category, expense_date', { count: 'exact' }).order('expense_date', { ascending: false }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('customer_receivables').select('balance', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('supplier_payables').select('balance', { count: 'exact' }).order('id', { ascending: true })),
        fetchAllRows(() => supabase.from('money_transactions').select('transaction_type, amount, payment_mode', { count: 'exact' }).order('id', { ascending: true })),
        supabase.from('business_settings').select('setting_value').eq('setting_key', 'dead_stock_days').maybeSingle(),
      ]);
      const failed = [phonesResult, salesResult, returnsResult, expensesResult, receivablesResult, payablesResult, moneyResult, settingsResult].find(result => result.error);
      if (failed) throw failed.error;

      const phones = phonesResult.data || [];
      const sales = salesResult.data || [];
      const expenses = expensesResult.data || [];
      const available = phones.filter(phone => phone.status === 'Available' && !phone.archived_at);
      const stockValue = available.reduce((sum, phone) => sum + Number(phone.purchase_price || 0) + Number(phone.repair_cost || 0) + Number(phone.other_cost || 0), 0);
      const deadStockDays = Number(settingsResult.data?.setting_value) || 60;
      const deadStock = available.filter(phone => {
        const purchasedAt = new Date(phone.purchase_date).getTime();
        return Number.isFinite(purchasedAt) && Date.now() - purchasedAt >= deadStockDays * 86400000;
      });
      const now = new Date();
      const monthMatches = value => {
        const date = new Date(value);
        return !Number.isNaN(date.getTime())
          && date.getFullYear() === now.getFullYear()
          && date.getMonth() === now.getMonth();
      };
      const phonesById = new Map(phones.map(phone => [phone.id, phone]));
      const { totals, monthTotals, activeSaleCount, brandProfit } = summarizeAiSales(
        sales, returnsResult.data || [], phonesById, monthMatches,
      );

      const ledgerMovement = { Cash: 0, UPI: 0, Bank: 0 };
      for (const transaction of moneyResult.data || []) {
        if (!Object.hasOwn(ledgerMovement, transaction.payment_mode)) continue;
        const amount = Number(transaction.amount || 0);
        ledgerMovement[transaction.payment_mode] += transaction.transaction_type === 'Income'
          ? amount : transaction.transaction_type === 'Expense' ? -amount : 0;
      }
      const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      setBusinessContext({
        totalPhonesCount: phones.filter(phone => !phone.archived_at).length,
        availablePhonesCount: available.length,
        totalStockValue: stockValue,
        totalSalesCount: activeSaleCount,
        totalSalesAmt: totals.revenue,
        totalGrossProfit: totals.grossProfit,
        totalExpensesAmt: totalExpenses,
        netProfit: totals.grossProfit - totalExpenses,
        monthRevenue: monthTotals.revenue,
        monthProfit: monthTotals.grossProfit,
        customerDue: (receivablesResult.data || []).reduce((sum, row) => sum + Number(row.balance || 0), 0),
        supplierPayable: (payablesResult.data || []).reduce((sum, row) => sum + Number(row.balance || 0), 0),
        ledgerMovement,
        deadStockCount: deadStock.length,
        deadStockModels: deadStock.slice(0, 50).map(phone => phone.brand + ' ' + phone.model).join('\n'),
        leadingBrand: [...brandProfit.entries()].sort((left, right) => right[1] - left[1])[0] || null,
        availableModels: available.slice(0, 50).map(phone => phone.brand + ' ' + phone.model + ' (INR ' + (phone.expected_selling_price || phone.purchase_price) + ')').join('\n'),
      });
    } catch (error) {
      console.error('Business analytics could not be loaded:', error);
      setBusinessContext(null);
      setContextError('Business analytics could not be loaded. Check the connection, migration status, and access policies, then sync again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinessData();
  }, [fetchBusinessData]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSendMessage = (textToSend) => {
    const userText = typeof textToSend === 'string' ? textToSend : inputQuery;
    if (!userText.trim() || loading) return;
    setMessages(previous => [...previous, { sender: 'user', text: userText }]);
    setInputQuery('');
    setLoading(true);

    window.setTimeout(() => {
      const q = userText.toLowerCase();
      let aiResponse = '';
      if (!businessContext) {
        aiResponse = contextError || 'Business data is still loading. Please sync and try again.';
      } else if (q.includes('customer due') || q.includes('receivable') || q.includes('udhaar') || q.includes('उधार')) {
        aiResponse = 'Outstanding customer due: INR ' + businessContext.customerDue.toLocaleString('en-IN') + '.';
      } else if (q.includes('supplier') || q.includes('payable')) {
        aiResponse = 'Outstanding supplier payable: INR ' + businessContext.supplierPayable.toLocaleString('en-IN') + '.';
      } else if (q.includes('cash') || q.includes('upi') || q.includes('bank')) {
        const account = q.includes('upi') ? 'UPI' : q.includes('bank') ? 'Bank' : 'Cash';
        aiResponse = account + ' net ledger movement is INR ' + businessContext.ledgerMovement[account].toLocaleString('en-IN') + '. Opening balance is not configured, so this is not a verified current account balance.';
      } else if (q.includes('dead stock') || q.includes('sitting too long') || q.includes('पुराना स्टॉक')) {
        aiResponse = 'Dead stock: ' + businessContext.deadStockCount + ' available phones meet the configured age threshold.\n' + (businessContext.deadStockModels || 'No phones currently meet the threshold.');
      } else if (q.includes('brand') && (q.includes('profit') || q.includes('most'))) {
        aiResponse = businessContext.leadingBrand
          ? 'Leading brand by recorded gross profit is ' + businessContext.leadingBrand[0] + ' at INR ' + businessContext.leadingBrand[1].toLocaleString('en-IN') + '.'
          : 'There are no completed sales to compare by brand.';
      } else if (q.includes('this month') || q.includes('month') || q.includes('इस महीने')) {
        aiResponse = 'This month: revenue INR ' + businessContext.monthRevenue.toLocaleString('en-IN') + '; gross profit INR ' + businessContext.monthProfit.toLocaleString('en-IN') + '.';
      } else if (q.includes('stock') || q.includes('स्टॉक') || q.includes('फोन')) {
        aiResponse = 'Available phones: ' + businessContext.availablePhonesCount + '\nStock cost: INR ' + businessContext.totalStockValue.toLocaleString('en-IN') + '\n' + (businessContext.availableModels || 'No phones available.');
      } else if (q.includes('sale') || q.includes('बिक्री')) {
        aiResponse = 'Recorded sales: ' + businessContext.totalSalesCount + '\nRevenue after discounts: INR ' + businessContext.totalSalesAmt.toLocaleString('en-IN');
      } else if (q.includes('expense') || q.includes('खर्च')) {
        aiResponse = 'Recorded operating expenses: INR ' + businessContext.totalExpensesAmt.toLocaleString('en-IN');
      } else if (q.includes('profit') || q.includes('p&l') || q.includes('मुनाफा')) {
        aiResponse = 'Gross profit: INR ' + businessContext.totalGrossProfit.toLocaleString('en-IN') + '\nOperating expenses: INR ' + businessContext.totalExpensesAmt.toLocaleString('en-IN') + '\nNet profit: INR ' + businessContext.netProfit.toLocaleString('en-IN');
      } else {
        aiResponse = 'Business snapshot\nAvailable stock: ' + businessContext.availablePhonesCount + ' phones\nRevenue: INR ' + businessContext.totalSalesAmt.toLocaleString('en-IN') + '\nNet profit: INR ' + businessContext.netProfit.toLocaleString('en-IN');
      }
      setMessages(previous => [...previous, { sender: 'ai', text: aiResponse }]);
      setLoading(false);
    }, 350);
  };
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
      
      {/* Header */}
      <div style={{ padding: '16px 20px', backgroundColor: '#0f172a', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
            🤖
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', color: '#38bdf8' }}>Revive AI Assistant</h3>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>Live business analytics fallback (no external AI service configured)</span>
          </div>
        </div>
        <button onClick={fetchBusinessData} style={{ padding: '6px 12px', backgroundColor: '#1e293b', color: '#38bdf8', border: '1px solid #334155', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
          🔄 Sync DB
        </button>
      </div>

      {/* Chat Messages Body */}
      <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px', backgroundColor: '#f8fafc' }}>
        {messages.map((m, idx) => (
          <div
            key={idx}
            style={{
              alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              backgroundColor: m.sender === 'user' ? '#0284c7' : '#ffffff',
              color: m.sender === 'user' ? '#fff' : '#0f172a',
              padding: '12px 16px',
              borderRadius: m.sender === 'user' ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              border: m.sender === 'ai' ? '1px solid #e2e8f0' : 'none',
              fontSize: '14px',
              lineHeight: '1.5',
              whiteSpace: 'pre-line',
            }}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', backgroundColor: '#fff', padding: '10px 14px', borderRadius: '16px 16px 16px 2px', border: '1px solid #e2e8f0', fontSize: '13px', color: '#64748b' }}>
            ⚡ AI डेटाबेस एनालिसिस कर रहा है...
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Quick Questions & Input Bar */}
      <div style={{ borderTop: '1px solid #e2e8f0', padding: '12px 16px', backgroundColor: '#fff' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
          {[
            '📦 उपलब्ध स्टॉक कितना है?',
            '💰 कुल बिक्री कितनी हुई?',
            '📈 कुल प्रॉफिट कितना हुआ?',
            '💸 कुल खर्च कितना हुआ?'
          ].map((btnText, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(btnText)}
              style={{
                padding: '6px 12px',
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '20px',
                fontSize: '12px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                color: '#334155',
                fontWeight: '500'
              }}
            >
              {btnText}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            placeholder="AI से सवाल पूछें (जैसे: स्टॉक रिपोर्ट दिखाओ)..."
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            style={{ flex: 1, padding: '12px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ padding: '12px 20px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
          >
            भेजें 🚀
          </button>
        </form>
      </div>

    </div>
  );
}
