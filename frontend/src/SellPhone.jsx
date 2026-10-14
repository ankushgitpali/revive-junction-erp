import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { clearRequestToken, getRequestToken } from "./requestTokens";

function SellPhone() {
  const [phones, setPhones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultWarrantyDays, setDefaultWarrantyDays] = useState(0);
  const [defaultPaymentMode, setDefaultPaymentMode] = useState('Cash');
  const saleRequest = useRef(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    phone_id: "",
    customer_name: "",
    customer_phone: "",
    selling_price: "",
    discount: "0",
    payment_mode: "Cash",
    payment_allocations: { Cash: "", UPI: "", Bank: "", Due: "" },
    warranty_days: "0",
    notes: "",
  });

  useEffect(() => {
    loadPhones();
    loadDefaultWarranty();
    const refreshSettings = () => loadDefaultWarranty();
    window.addEventListener('rj-settings-updated', refreshSettings);
    return () => window.removeEventListener('rj-settings-updated', refreshSettings);
  }, []);

  async function loadDefaultWarranty() {
    const { data, error } = await supabase.from('business_settings')
      .select('setting_key, setting_value').in('setting_key', ['default_warranty_days', 'default_payment_mode']);
    if (error) {
      console.error('Default warranty setting could not be loaded:', error.message);
      return;
    }
    const settings = Object.fromEntries((data || []).map(row => [row.setting_key, row.setting_value]));
    const configuredDays = Number(settings.default_warranty_days);
    if (Number.isInteger(configuredDays) && configuredDays >= 0) {
      setDefaultWarrantyDays(configuredDays);
      setForm(previous => ({ ...previous, warranty_days: String(configuredDays) }));
    }
    if (['Cash', 'UPI', 'Bank'].includes(settings.default_payment_mode)) {
      setDefaultPaymentMode(settings.default_payment_mode);
      setForm(previous => ({ ...previous, payment_mode: previous.payment_mode === 'Cash' ? settings.default_payment_mode : previous.payment_mode }));
    }
  }

  async function loadPhones() {
    setLoading(true);
    setError("");
    try {
      const { data, error } = await supabase
        .from("phones")
        .select("id, stock_code, brand, model, storage, condition, imei_1, purchase_price, repair_cost, other_cost, expected_selling_price, status, purchase_date")
        .eq("status", "Available")
        .order("purchase_date", { ascending: false });

      if (error) throw error;
      setPhones(data || []);
    } catch (err) {
      console.error(err);
      setPhones([]);
      setError("Phones load karne me dikkat aayi: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const selectedPhone = phones.find(
    (phone) => String(phone.id) === String(form.phone_id)
  );

  const saleAmount =
    Number(form.selling_price || 0) - Number(form.discount || 0);

  const totalCost = selectedPhone
    ? Number(selectedPhone.purchase_price || 0) +
      Number(selectedPhone.repair_cost || 0) +
      Number(selectedPhone.other_cost || 0)
    : 0;

  const estimatedProfit = saleAmount - totalCost;

  function updateField(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function handlePhoneChange(value) {
    const phone = phones.find((item) => String(item.id) === String(value));

    setForm((prev) => ({
      ...prev,
      phone_id: value,
      selling_price: phone?.expected_selling_price
        ? String(phone.expected_selling_price)
        : "",
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setMessage("");
    setError("");

    if (!form.phone_id) {
      setError("Kripya ek phone select karein.");
      return;
    }

    if (!form.selling_price || Number(form.selling_price) <= 0) {
      setError("Sahi selling price enter karein.");
      return;
    }

    if (!Number.isFinite(Number(form.discount || 0)) || Number(form.discount || 0) < 0 || Number(form.discount || 0) > Number(form.selling_price)) {
      setError("Discount must be non-negative and cannot exceed the selling price.");
      return;
    }

    if (saleAmount <= 0) {
      setError("Sale amount ₹0 se zyada hona chahiye.");
      return;
    }

    if (!Number.isFinite(Number(form.warranty_days || 0)) || Number(form.warranty_days || 0) < 0) {
      setError('Warranty days must be a non-negative number.');
      return;
    }

    const allocations = form.payment_mode === 'Mixed'
      ? Object.entries(form.payment_allocations)
        .filter(([, value]) => Number(value) > 0)
        .map(([account, value]) => ({ account, amount: Number(value) }))
      : [{ account: form.payment_mode, amount: saleAmount }];
    const allocatedTotal = allocations.reduce((sum, item) => sum + item.amount, 0);
    if (allocations.some(item => !Number.isFinite(item.amount) || item.amount <= 0) || Math.abs(allocatedTotal - saleAmount) > 0.00001) {
      setError(`Payment allocations must equal the net sale amount of ₹${saleAmount.toLocaleString('en-IN')}.`);
      return;
    }
    if (allocations.some(item => item.account === 'Due') && !form.customer_name.trim()) {
      setError('Enter the customer name before recording an amount as due.');
      return;
    }

    setSaving(true);

    try {
      const salePayload = {
        p_phone_id: form.phone_id,
        p_customer_id: null,
        p_customer_name: form.customer_name.trim() || null,
        p_customer_phone: form.customer_phone.trim() || null,
        p_selling_price: Number(form.selling_price),
        p_discount: Number(form.discount || 0),
        p_payment_allocations: allocations,
        p_warranty_days: Number(form.warranty_days || 0),
        p_notes: form.notes.trim() || null,
      };
      const request = await getRequestToken(saleRequest, salePayload, 'sale');
      const { data, error: saleError } = await supabase.rpc('create_sale_atomic', {
        ...salePayload,
        p_sale_date: request.createdAt,
        p_request_id: request.id,
      });

      if (saleError) throw saleError;

      setMessage(`Sale recorded. Invoice ${data.invoice_no} was generated by the database.`);
      clearRequestToken(saleRequest);

      setForm({
        phone_id: "",
        customer_name: "",
        customer_phone: "",
        selling_price: "",
        discount: "0",
        payment_mode: defaultPaymentMode,
        payment_allocations: { Cash: "", UPI: "", Bank: "", Due: "" },
        warranty_days: String(defaultWarrantyDays),
        notes: "",
      });

      await loadPhones();

      // Trigger dashboard reload event
      window.dispatchEvent(new Event("rj-data-updated"));
    } catch (err) {
      console.error(err);
      setError(err.message || "Sale save karne me problem aayi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "16px" }}>
      {/* Header */}
      <div style={styles.card}>
        <h2 style={{ margin: 0, fontSize: "22px", color: "#111827" }}>
          📱 Sell Phone
        </h2>
        <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "14px" }}>
          Available stock se phone select karein aur sale enter karein.
        </p>
      </div>

      {/* Notifications */}
      {loading && <div style={styles.infoBox}>Available stock load ho raha hai...</div>}
      {error && <div style={styles.errorBox}>❌ {error}</div>}
      {message && <div style={styles.successBox}>{message}</div>}

      <form onSubmit={handleSubmit}>
        {/* Step 1: Select Phone */}
        <div style={styles.card}>
          <h3 style={styles.sectionHeading}>📦 1. Select Phone</h3>

          <label style={styles.label}>Available Stock *</label>
          <select
            value={form.phone_id}
            onChange={(e) => handlePhoneChange(e.target.value)}
            style={styles.input}
          >
            <option value="">-- Phone Select Karein --</option>
            {phones.map((phone) => (
              <option key={phone.id} value={phone.id}>
                {phone.stock_code} — {phone.brand} {phone.model}{" "}
                {phone.storage ? `(${phone.storage})` : ""}
              </option>
            ))}
          </select>

          {/* Selected Phone Details Card */}
          {selectedPhone && (
            <div style={styles.phonePreview}>
              <div style={{ fontWeight: "bold", fontSize: "16px", marginBottom: "8px" }}>
                {selectedPhone.brand} {selectedPhone.model} {selectedPhone.storage ? `(${selectedPhone.storage})` : ""}
              </div>
              <div style={styles.grid2}>
                <div>Stock Code: <strong>{selectedPhone.stock_code}</strong></div>
                <div>Condition: <strong>{selectedPhone.condition || "N/A"}</strong></div>
                <div>IMEI: <strong>{selectedPhone.imei_1 || "N/A"}</strong></div>
                <div>
                  Total Cost: <strong>₹{totalCost.toLocaleString("en-IN")}</strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Customer Details */}
        <div style={styles.card}>
          <h3 style={styles.sectionHeading}>👤 2. Customer Details</h3>
          <div style={styles.grid2}>
            <div>
              <label style={styles.label}>Customer Name</label>
              <input
                type="text"
                placeholder="Naam likhein"
                value={form.customer_name}
                onChange={(e) => updateField("customer_name", e.target.value)}
                style={styles.input}
              />
            </div>
            <div>
              <label style={styles.label}>Mobile Number</label>
              <input
                type="tel"
                placeholder="Phone number"
                value={form.customer_phone}
                onChange={(e) => updateField("customer_phone", e.target.value)}
                style={styles.input}
              />
            </div>
          </div>
        </div>

        {/* Step 3: Payment & Invoice */}
        <div style={styles.card}>
          <h3 style={styles.sectionHeading}>💰 3. Sale & Billing Details</h3>

          <div style={styles.grid2}>
            <div>
              <label style={styles.label}>Selling Price (₹) *</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={form.selling_price}
                onChange={(e) => updateField("selling_price", e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Discount (₹)</label>
              <input
                type="number"
                min="0"
                value={form.discount}
                onChange={(e) => updateField("discount", e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Payment Mode</label>
              <select
                value={form.payment_mode}
                onChange={(e) => updateField("payment_mode", e.target.value)}
                style={styles.input}
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank">Bank Transfer</option>
                <option value="Due">Customer Due</option>
                <option value="Mixed">Mixed / partial payment</option>
              </select>
              {form.payment_mode === 'Mixed' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginBottom: '14px' }}>
                  {['Cash', 'UPI', 'Bank', 'Due'].map(account => (
                    <label key={account} style={styles.label}>
                      {account} allocation
                      <input type="number" min="0" step="0.01" value={form.payment_allocations[account]} onChange={e => setForm(prev => ({ ...prev, payment_allocations: { ...prev.payment_allocations, [account]: e.target.value } }))} style={{ ...styles.input, marginBottom: 0 }} />
                    </label>
                  ))}
                  <small style={{ gridColumn: '1 / -1', color: '#64748b' }}>
                    Allocated: ₹{Object.values(form.payment_allocations).reduce((sum, value) => sum + (Number(value) || 0), 0).toLocaleString('en-IN')} / ₹{saleAmount.toLocaleString('en-IN')}
                  </small>
                </div>
              )}
            </div>

            <div>
              <label style={styles.label}>Warranty (Days)</label>
              <input
                type="number"
                min="0"
                value={form.warranty_days}
                onChange={(e) => updateField("warranty_days", e.target.value)}
                style={styles.input}
              />
            </div>
          </div>

          <p style={{ color: '#64748b', fontSize: '12px', margin: '0 0 14px' }}>Invoice number is generated transactionally by the database. Apply the Supabase migration before recording sales.</p>

          <label style={styles.label}>Notes / Remarks</label>
          <textarea
            placeholder="Koi extra note ho to yahan likhein..."
            value={form.notes}
            onChange={(e) => updateField("notes", e.target.value)}
            style={styles.textarea}
          />
        </div>

        {/* Calculation Summary Bar */}
        <div style={styles.summaryBar}>
          <div>
            <div style={styles.summaryLabel}>Final Sale</div>
            <div style={styles.summaryValue}>₹{saleAmount.toLocaleString("en-IN")}</div>
          </div>
          <div>
            <div style={styles.summaryLabel}>Total Cost</div>
            <div style={styles.summaryValue}>₹{totalCost.toLocaleString("en-IN")}</div>
          </div>
          <div>
            <div style={styles.summaryLabel}>Est. Profit</div>
            <div
              style={{
                ...styles.summaryValue,
                color: estimatedProfit >= 0 ? "#4ade80" : "#f87171",
              }}
            >
              ₹{estimatedProfit.toLocaleString("en-IN")}
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={saving || loading}
          style={{
            ...styles.btnPrimary,
            opacity: saving || loading ? 0.6 : 1,
          }}
        >
          {saving ? "Saving Sale..." : "Complete & Save Sale"}
        </button>
      </form>
    </div>
  );
}

const styles = {
  card: {
    background: "#ffffff",
    borderRadius: "12px",
    padding: "20px",
    marginBottom: "16px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    border: "1px solid #e5e7eb",
  },
  sectionHeading: {
    margin: "0 0 16px 0",
    fontSize: "16px",
    fontWeight: "600",
    color: "#1f2937",
  },
  label: {
    display: "block",
    marginBottom: "6px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#374151",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    marginBottom: "14px",
    outline: "none",
    background: "#fff",
  },
  textarea: {
    width: "100%",
    minHeight: "70px",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    resize: "vertical",
    outline: "none",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "12px",
  },
  phonePreview: {
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    padding: "14px",
    marginTop: "4px",
    fontSize: "13px",
    color: "#4b5563",
  },
  summaryBar: {
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "12px",
    padding: "18px",
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    textAlign: "center",
    marginBottom: "16px",
  },
  summaryLabel: {
    fontSize: "12px",
    color: "#94a3b8",
    marginBottom: "4px",
  },
  summaryValue: {
    fontSize: "18px",
    fontWeight: "bold",
  },
  btnPrimary: {
    width: "100%",
    background: "#2563eb",
    color: "#ffffff",
    padding: "14px",
    border: "none",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: "600",
    cursor: "pointer",
  },
  btnSecondary: {
    background: "#1e293b",
    color: "#ffffff",
    padding: "0 16px",
    border: "none",
    borderRadius: "8px",
    fontWeight: "600",
    cursor: "pointer",
    fontSize: "13px",
  },
  infoBox: {
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
  },
  successBox: {
    background: "#f0fdf4",
    color: "#15803d",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
    border: "1px solid #bbf7d0",
  },
  errorBox: {
    background: "#fef2f2",
    color: "#b91c1c",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
    border: "1px solid #fecaca",
  },
};

export default SellPhone;
