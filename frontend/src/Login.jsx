import React, { useState } from 'react';
import { supabase } from './supabase';
import { withLoadingState } from './authLoading.js';

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const { data, error } = await withLoadingState(setLoading, () => (
        supabase.auth.signInWithPassword({ email, password })
      ));
      if (error) {
        setAuthError(`Login failed: ${error.message}`);
      } else if (data?.user) {
        alert('Welcome back!');
        onLoginSuccess(data.user);
      } else {
        setAuthError('Login did not return an authenticated user. Please try again.');
      }
    } catch (error) {
      console.error('Authentication request failed:', error);
      setAuthError('Login could not be completed. Check your email, password, and connection, then try again.');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ backgroundColor: '#ffffff', padding: '36px', borderRadius: '16px', border: '1px solid #e2e8f0', width: '380px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: '0 0 6px 0', fontSize: '22px', fontWeight: '800', color: '#0f172a' }}>📱 REVIVE JUNCTION</h2>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>HQ Command Portal Login</p>
        </div>

        <form onSubmit={handleAuth}>
          {authError && <div role="alert" style={{ marginBottom: '16px', padding: '10px 12px', borderRadius: '8px', background: '#fee2e2', color: '#991b1b', fontSize: '13px' }}>{authError}</div>}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '6px' }}>Gmail / Email Address</label>
            <input 
              type="email" 
              placeholder="ankush@gmail.com" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }} 
              required 
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '12px', fontWeight: '700', color: '#475569', display: 'block', marginBottom: '6px' }}>Password</label>
            <input 
              type="password" 
              placeholder="••••••••" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }} 
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading} 
            style={{ width: '100%', padding: '11px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(37,99,235,0.2)' }}
          >
            {loading ? 'Processing...' : 'Secure Login'}
          </button>
        </form>

        <div role="note" style={{ textAlign: 'center', marginTop: '16px', color: '#64748b', fontSize: '12px' }}>
          Access is provisioned by the shop administrator.
        </div>

      </div>
    </div>
  );
}
