import React, { useState, useEffect, Component } from 'react';
import { isSupabaseConfigured, supabase } from './supabase';
import { createAuthSessionSync } from './authSessionSync.js';
import Login from './Login';

import Dashboard from './Dashboard';
import Stock from './Stock';
import BuyPhone from './BuyPhone';
import SellPhone from './SellPhone';
import Repairs from './Repairs';
import Expenses from './Expenses';
import Cashbook from './Cashbook';
import Customers from './Customers';
import Suppliers from './Suppliers';
import Invoices from './Invoices';
import Pnl from './PnL';
import AnalyticsDashboard from './components/AnalyticsDashboard'; // New Analytics HQ Component
import Settings from './Settings';
import OctoberHistoricalImport from './OctoberHistoricalImport';

// Error Boundary to catch any crashing component and stop blank screen
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("UI Crash caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'Inter, sans-serif', maxWidth: '800px', margin: '40px auto', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px' }}>
          <h2 style={{ color: '#dc2626', margin: '0 0 12px 0' }}>⚠️ Component Render Error</h2>
          <p style={{ color: '#7f1d1d', fontSize: '14px', lineHeight: '1.6' }}>
            Koi component load hone me fail ho gaya hai. Error details neeche di gayi hai:
          </p>
          <pre style={{ background: '#fff', padding: '16px', borderRadius: '8px', color: '#b91c1c', overflowX: 'auto', fontSize: '12px' }}>
            {this.state.error && this.state.error.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{ marginTop: '16px', background: '#2563eb', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '6px', fontWeight: '700', cursor: 'pointer' }}
          >
            🔄 Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;

    const sessionSync = createAuthSessionSync(setSession, setLoading);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, authSession) => {
      sessionSync.applyAuthEvent(authSession);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      sessionSync.applyInitialSession(data.session);
    }).catch(err => {
      console.error('Auth session error:', err);
      sessionSync.finishInitialLoad();
    });

    return () => {
      sessionSync.dispose();
      subscription.unsubscribe();
    };
  }, []);

  if (!isSupabaseConfigured || !supabase) {
    return (
      <div role="alert" style={{ padding: '32px', maxWidth: '680px', margin: '60px auto', fontFamily: 'Inter, system-ui, sans-serif', background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa', borderRadius: '12px' }}>
        <h2 style={{ marginTop: 0 }}>Supabase configuration is missing or invalid</h2>
        <p style={{ marginBottom: 0 }}>Set the required Vite Supabase URL and publishable key in your local environment, then restart the development server. No credentials are displayed here.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', fontWeight: '700', color: '#2563eb', backgroundColor: '#f8fafc' }}>
        🚀 Loading Revive Junction HQ Command...
      </div>
    );
  }

  if (!session) {
    return <Login onLoginSuccess={(user) => setSession({ user })} />;
  }

  const menuItems = [
    { id: 'dashboard', label: '📊 Dashboard HQ' },
    { id: 'analytics', label: '🔥 ROI & Profit Analytics' },
    { id: 'inventory', label: '📦 Stock Inventory' },
    { id: 'buy', label: '📥 Buy / Inward Phone' },
    { id: 'sell', label: '⚡ POS & Sell Phone' },
    { id: 'repairs', label: '🔧 Repairs Tracking' },
    { id: 'expenses', label: '💡 Shop Expenses' },
    { id: 'cashbook', label: '💰 Cash Ledger' },
    { id: 'customers', label: '👥 Customers Directory' },
    { id: 'suppliers', label: '🤝 Suppliers & Vendors' },
    { id: 'invoices', label: '📄 Invoices Management' },
    { id: 'pnl', label: '📈 P&L Analytics Graph' },
    { id: 'settings', label: '⚙️ Store Settings' },
    { id: 'october-import', label: '🧾 October 2026 Historical Import' },
  ];

  const renderModule = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'analytics': return <AnalyticsDashboard />;
      case 'inventory': return <Stock />;
      case 'buy': return <BuyPhone />;
      case 'sell': return <SellPhone />;
      case 'repairs': return <Repairs />;
      case 'expenses': return <Expenses />;
      case 'cashbook': return <Cashbook />;
      case 'customers': return <Customers />;
      case 'suppliers': return <Suppliers />;
      case 'invoices': return <Invoices />;
      case 'pnl': return <Pnl />;
      case 'settings': return <Settings />;
      case 'october-import': return <OctoberHistoricalImport />;
      default: return <Dashboard />;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden' }}>
      
      {/* Left Sidebar */}
      <div style={{ width: '260px', backgroundColor: '#0f172a', color: '#fff', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e293b', flexShrink: 0 }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1e293b' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#f8fafc' }}>📱 REVIVE JUNCTION</h2>
          <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: '600' }}>HQ Command Portal</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: activeTab === item.id ? '#2563eb' : 'transparent',
                color: activeTab === item.id ? '#fff' : '#94a3b8',
                fontSize: '13px',
                fontWeight: '700',
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '16px 20px', borderTop: '1px solid #1e293b', backgroundColor: '#090d16' }}>
          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.user.email}
          </div>
          <button 
            onClick={() => supabase.auth.signOut()} 
            style={{ width: '100%', background: '#dc2626', color: '#fff', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}
          >
            🔒 Logout HQ
          </button>
        </div>
      </div>

      {/* Right Content Area with Error Boundary protection */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 32px', backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0f172a', textTransform: 'capitalize' }}>
            {activeTab.replace('_', ' ')} View
          </h3>
          <span style={{ fontSize: '12px', color: '#065f46', backgroundColor: '#dcfce7', padding: '4px 10px', borderRadius: '6px', fontWeight: '700' }}>
            Live System Active 🟢
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#f8fafc' }}>
          <ErrorBoundary>
            {renderModule()}
          </ErrorBoundary>
        </div>
      </div>

    </div>
  );
}
