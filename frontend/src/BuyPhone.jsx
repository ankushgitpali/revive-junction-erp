import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { clearRequestToken, getRequestToken } from './requestTokens';

const createInitialFormData = (condition = 'Good', paymentMode = 'Cash') => ({
  brand: '', model: '', variant: '', imei1: '', imei2: '',
  storage: '128GB', ram: '', condition,
  purchasePrice: '', repairCost: '0', otherCost: '0', expectedSellingPrice: '',
  purchaseDate: new Date().toISOString().slice(0, 16),
  sellerName: '', sellerPhone: '', sellerPhotoUrl: '', idFrontUrl: '', idBackUrl: '',
  supplierId: '', purchasePaymentMode: paymentMode,
  purchaseAllocations: { Cash: '', UPI: '', Bank: '', Due: '' },
  notes: '', isVerifiedLegal: false,
});

export default function BuyPhone() {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierError, setSupplierError] = useState('');
  const [formData, setFormData] = useState(createInitialFormData);
  const purchaseRequest = useRef(null);
  const [phoneConditions, setPhoneConditions] = useState(['Flawless', 'Superb', 'Good', 'Fair', 'Damaged']);
  const [defaultPaymentMode, setDefaultPaymentMode] = useState('Cash');

  useEffect(() => {
    const loadSuppliers = async () => {
      const [supplierResult, settingsResult] = await Promise.all([
        supabase.from('suppliers').select('id, name').order('name'),
        supabase.from('business_settings').select('setting_key, setting_value')
          .in('setting_key', ['phone_conditions', 'default_payment_mode']),
      ]);
      if (supplierResult.error) {
        setSupplierError('Supplier list could not be loaded. You can still record an individual seller.');
      } else {
        setSuppliers(supplierResult.data || []);
      }
      if (settingsResult.error) return;
      const settings = Object.fromEntries((settingsResult.data || []).map(row => [row.setting_key, row.setting_value]));
      if (Array.isArray(settings.phone_conditions)) {
        const conditions = settings.phone_conditions.map(value => String(value).trim()).filter(Boolean);
        if (conditions.length > 0) {
          setPhoneConditions(conditions);
          setFormData(previous => ({ ...previous, condition: conditions.includes(previous.condition) ? previous.condition : conditions[0] }));
        }
      }
      if (['Cash', 'UPI', 'Bank'].includes(settings.default_payment_mode)) {
        setDefaultPaymentMode(settings.default_payment_mode);
        setFormData(previous => ({ ...previous, purchasePaymentMode: previous.purchasePaymentMode === 'Cash' ? settings.default_payment_mode : previous.purchasePaymentMode }));
      }
    };
    loadSuppliers();
    const refreshSettings = () => loadSuppliers();
    window.addEventListener('rj-settings-updated', refreshSettings);
    return () => window.removeEventListener('rj-settings-updated', refreshSettings);
  }, []);

  // Helper for Uploading Files to Supabase Storage
  const handleFileUpload = async (file, fieldName) => {
    if (!file) return;
    const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!allowedTypes[file.type]) {
      alert('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      alert('Image must be non-empty and 10 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const fileExt = allowedTypes[file.type];
      const fileId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const fileName = `${fileId}.${fileExt}`;
      const filePath = `kyc/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('kyc-documents')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Store only the object path so the frontend does not expose a public KYC URL.
      setFormData(prev => ({ ...prev, [fieldName]: filePath }));
      alert("✅ Document uploaded successfully!");
    } catch (err) {
      alert("Upload Error: " + err.message + " (Make sure 'kyc-documents' bucket exists in Supabase Storage)");
    } finally {
      setUploading(false);
    }
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();

    const purchasePrice = Number(formData.purchasePrice);
    const repairCost = Number(formData.repairCost);
    const otherCost = Number(formData.otherCost);
    const expectedSellingPrice = formData.expectedSellingPrice === '' ? null : Number(formData.expectedSellingPrice);

    if (!formData.brand.trim() || !formData.model.trim() || !formData.purchasePrice) {
      alert("⚠️ Kripya Brand, Model aur Purchase Price zaroor bharein.");
      return;
    }

    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0 ||
        !Number.isFinite(repairCost) || repairCost < 0 ||
        !Number.isFinite(otherCost) || otherCost < 0 ||
        (expectedSellingPrice !== null && (!Number.isFinite(expectedSellingPrice) || expectedSellingPrice < 0))) {
      alert('Enter a valid purchase price and non-negative costs/prices.');
      return;
    }

    const totalCost = purchasePrice + repairCost + otherCost;
    const paymentAllocations = formData.purchasePaymentMode === 'Mixed'
      ? Object.entries(formData.purchaseAllocations)
        .filter(([, value]) => Number(value) > 0)
        .map(([account, value]) => ({ account, amount: Number(value) }))
      : totalCost > 0 ? [{ account: formData.purchasePaymentMode, amount: totalCost }] : [];
    const allocatedTotal = paymentAllocations.reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isFinite(allocatedTotal) || Math.abs(allocatedTotal - totalCost) > 0.00001) {
      alert(`Payment allocations must total ₹${totalCost.toLocaleString('en-IN')}.`);
      return;
    }
    if ([formData.imei1, formData.imei2].some(value => value.trim() && !/^\d{15}$/.test(value.trim()))) {
      alert('IMEI must contain exactly 15 digits.');
      return;
    }
    if (paymentAllocations.some(item => item.account === 'Due') && !formData.supplierId && !formData.sellerName.trim()) {
      alert('Select a supplier or enter seller name when recording a purchase due.');
      return;
    }

    if (!Number.isFinite(new Date(formData.purchaseDate).getTime())) {
      alert('Enter a valid purchase date.');
      return;
    }

    if (!formData.isVerifiedLegal) {
      alert("⚠️ Kripya Legal Ownership Verification box par tick karein.");
      return;
    }

    setLoading(true);

    try {
      const request = await getRequestToken(purchaseRequest, {
        ...formData,
        purchasePrice,
        repairCost,
        otherCost,
        expectedSellingPrice,
        purchasePaymentAllocations: paymentAllocations,
      }, 'phone-purchase');

      const payload = {
        client_request_id: request.id,
        stock_code: `RJ-${request.id.slice(0, 8).toUpperCase()}`,
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        variant: formData.variant.trim() || null,
        imei_1: formData.imei1.trim() || null,
        imei_2: formData.imei2.trim() || null,
        storage: formData.storage || null,
        ram: formData.ram.trim() || null,
        condition: formData.condition,
        purchase_price: purchasePrice,
        repair_cost: repairCost,
        other_cost: otherCost,
        expected_selling_price: expectedSellingPrice,
        purchase_date: new Date(formData.purchaseDate).toISOString(),
        supplier_id: formData.supplierId || null,
        purchase_payment_allocations: paymentAllocations,
        seller_name: formData.sellerName.trim() || null,
        seller_phone: formData.sellerPhone.trim() || null,
        seller_photo_url: formData.sellerPhotoUrl || null,
        id_proof_front_url: formData.idFrontUrl || null,
        id_proof_back_url: formData.idBackUrl || null,
        notes: formData.notes.trim() || null,
      };

      const { error } = await supabase.rpc('create_phone_purchase_atomic', { p_payload: payload });
      if (error) throw error;

      alert("🎉 Phone Purchase Entry Successful!");
      clearRequestToken(purchaseRequest);
      window.dispatchEvent(new Event('rj-data-updated'));
      
      // Reset Form
      setFormData(createInitialFormData(phoneConditions[0] || 'Good', defaultPaymentMode));

    } catch (err) {
      alert("Error saving phone: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const totalEffectiveCost = (Number(formData.purchasePrice) || 0) + (Number(formData.repairCost) || 0) + (Number(formData.otherCost) || 0);

  return (
    <div style={{ padding: '12px', maxWidth: '850px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      
      {/* Header */}
      <div style={{ backgroundColor: '#fff', padding: '16px 20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: '#0f172a', fontSize: '20px' }}>📱 Buy Phone & e-KYC Entry Station</h2>
        <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>Legally Verified Device Intake & Historical Backdated Procurement</p>
      </div>

      <div role="note" style={{ marginBottom: '16px', padding: '12px 16px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1d4ed8', fontSize: '13px' }}>
        Payment allocations are recorded with the purchase and posted by the database automation. Apply the Supabase migration before using this workflow.
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '20px' }}>
        
        {/* Section 1: Purchase Date & Time (Backdate Entry Supported) */}
        <div style={{ backgroundColor: '#fff', padding: '18px', borderRadius: '12px', borderLeft: '5px solid #0284c7', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#0284c7' }}>📅 1. Purchase Timestamp (Backdated Purchase Support)</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Date & Time of Purchase:</label>
              <input
                type="datetime-local"
                value={formData.purchaseDate}
                onChange={e => setFormData({ ...formData, purchaseDate: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', fontWeight: 'bold', color: '#0f172a' }}
                required
              />
              <small style={{ color: '#94a3b8', fontSize: '11px' }}>* Purani 2 saal tak ki date chunein agar backdated entry hai.</small>
            </div>
          </div>
        </div>

        {/* Section 2: Device Technical Details */}
        <div style={{ backgroundColor: '#fff', padding: '18px', borderRadius: '12px', borderLeft: '5px solid #16a34a', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#16a34a' }}>📲 2. Device Specifications</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Brand Name *</label>
              <input
                type="text"
                placeholder="e.g. Samsung, Apple, Vivo"
                value={formData.brand}
                onChange={e => setFormData({ ...formData, brand: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Model Name *</label>
              <input
                type="text"
                placeholder="e.g. Galaxy S22 Ultra, iPhone 13"
                value={formData.model}
                onChange={e => setFormData({ ...formData, model: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Variant</label>
              <input type="text" value={formData.variant} onChange={e => setFormData({ ...formData, variant: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>IMEI Number</label>
              <input
                type="text"
                placeholder="15-digit IMEI"
                value={formData.imei1}
                onChange={e => setFormData({ ...formData, imei1: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>IMEI 2</label>
              <input type="text" value={formData.imei2} onChange={e => setFormData({ ...formData, imei2: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Storage RAM/ROM</label>
              <select
                value={formData.storage}
                onChange={e => setFormData({ ...formData, storage: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              >
                <option value="64GB">64 GB</option>
                <option value="128GB">128 GB</option>
                <option value="256GB">256 GB</option>
                <option value="512GB">512 GB / 1TB</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>RAM</label>
              <input type="text" value={formData.ram} onChange={e => setFormData({ ...formData, ram: e.target.value })} placeholder="e.g. 8GB" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Condition</label>
              <select value={formData.condition} onChange={e => setFormData({ ...formData, condition: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}>
                {phoneConditions.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Financial & Cost Split Breakdown */}
        <div style={{ backgroundColor: '#fff', padding: '18px', borderRadius: '12px', borderLeft: '5px solid #eab308', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#ca8a04' }}>💰 3. Financial Cost Breakdown</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Base Purchase Price (₹) *</label>
              <input
                type="number"
                placeholder="0"
                value={formData.purchasePrice}
                onChange={e => setFormData({ ...formData, purchasePrice: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', fontWeight: 'bold', color: '#16a34a' }}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Repair/Part Cost (₹)</label>
              <input
                type="number"
                placeholder="0"
                value={formData.repairCost}
                onChange={e => setFormData({ ...formData, repairCost: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Other Expenses (₹)</label>
              <input
                type="number"
                placeholder="0"
                value={formData.otherCost}
                onChange={e => setFormData({ ...formData, otherCost: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Expected Selling Price (₹)</label>
              <input type="number" min="0" step="0.01" value={formData.expectedSellingPrice} onChange={e => setFormData({ ...formData, expectedSellingPrice: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Supplier (optional)</label>
              <select value={formData.supplierId} onChange={e => setFormData({ ...formData, supplierId: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                <option value="">Individual seller / no supplier</option>
                {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
              {supplierError && <small role="status" style={{ color: '#92400e' }}>{supplierError}</small>}
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Purchase Payment</label>
              <select value={formData.purchasePaymentMode} onChange={e => setFormData({ ...formData, purchasePaymentMode: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                {['Cash', 'UPI', 'Bank', 'Due', 'Mixed'].map(mode => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </div>
          </div>
          {formData.purchasePaymentMode === 'Mixed' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '14px' }}>
              {['Cash', 'UPI', 'Bank', 'Due'].map(account => (
                <label key={account} style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>
                  {account} allocation
                  <input type="number" min="0" step="0.01" value={formData.purchaseAllocations[account]} onChange={e => setFormData({ ...formData, purchaseAllocations: { ...formData.purchaseAllocations, [account]: e.target.value } })} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: '8px', marginTop: '4px', borderRadius: '6px', border: '1px solid #cbd5e1' }} />
                </label>
              ))}
              <small style={{ gridColumn: '1 / -1', color: '#64748b' }}>
                Allocated: ₹{Object.values(formData.purchaseAllocations).reduce((sum, value) => sum + (Number(value) || 0), 0).toLocaleString('en-IN')} / ₹{totalEffectiveCost.toLocaleString('en-IN')}
              </small>
            </div>
          )}

          <div style={{ background: '#fefce8', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fef08a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#854d0e' }}>TOTAL EFFECTIVE LANDED COST:</span>
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#a16207' }}>₹{totalEffectiveCost.toLocaleString('en-IN')}</span>
          </div>
        </div>

        {/* Section 4: Customer / Seller e-KYC Document Vault */}
        <div style={{ backgroundColor: '#fff', padding: '18px', borderRadius: '12px', borderLeft: '5px solid #8b5cf6', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#7c3aed' }}>📸 4. Seller Identification & e-KYC Vault</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Seller Full Name</label>
              <input
                type="text"
                placeholder="Customer Name"
                value={formData.sellerName}
                onChange={e => setFormData({ ...formData, sellerName: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569', display: 'block', marginBottom: '4px' }}>Seller Mobile Number</label>
              <input
                type="text"
                placeholder="10-digit mobile"
                value={formData.sellerPhone}
                onChange={e => setFormData({ ...formData, sellerPhone: e.target.value })}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Photos Upload Controls */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '4px' }}>Seller Photo / Live Snap</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={e => handleFileUpload(e.target.files[0], 'sellerPhotoUrl')}
                style={{ fontSize: '12px' }}
              />
              {formData.sellerPhotoUrl && <span style={{ color: '#16a34a', fontSize: '11px', display: 'block', marginTop: '4px' }}>✓ Photo Attached</span>}
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '4px' }}>Aadhar / ID Front Photo</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={e => handleFileUpload(e.target.files[0], 'idFrontUrl')}
                style={{ fontSize: '12px' }}
              />
              {formData.idFrontUrl && <span style={{ color: '#16a34a', fontSize: '11px', display: 'block', marginTop: '4px' }}>✓ Front ID Attached</span>}
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b', display: 'block', marginBottom: '4px' }}>Aadhar / ID Back Photo</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={e => handleFileUpload(e.target.files[0], 'idBackUrl')}
                style={{ fontSize: '12px' }}
              />
              {formData.idBackUrl && <span style={{ color: '#16a34a', fontSize: '11px', display: 'block', marginTop: '4px' }}>✓ Back ID Attached</span>}
            </div>
          </div>
        </div>

        {/* Verification Check & Submit Button */}
        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', color: '#0f172a' }}>
            <input
              type="checkbox"
              checked={formData.isVerifiedLegal}
              onChange={e => setFormData({ ...formData, isVerifiedLegal: e.target.checked })}
              style={{ width: '18px', height: '18px' }}
            />
            🛡️ I verify that this phone is legitimately sourced and ID details have been verified.
          </label>

          <button
            type="submit"
            disabled={loading || uploading}
            style={{ width: '100%', marginTop: '16px', padding: '12px', backgroundColor: loading ? '#94a3b8' : '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '15px', cursor: 'pointer' }}
          >
            {loading ? '⏳ Saving Entry...' : '🚀 Save Phone Entry to Inventory'}
          </button>
        </div>

      </form>
    </div>
  );
}
