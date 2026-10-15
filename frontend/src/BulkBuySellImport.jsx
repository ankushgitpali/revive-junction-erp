import React, { useState } from "react";
import { supabase } from "./supabase";

export default function BulkBuySellImport() {
  const [rows, setRows] = useState([
    {
      imei: "",
      brandName: "",
      modelName: "",
      purchasePrice: "",
      supplierName: "",
      purchaseDate: new Date().toISOString().split("T")[0],
      sellingPrice: "",
      customerName: "",
      customerPhone: "",
      saleDate: "",
      status: "In Stock",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const addRow = () => {
    setRows([
      ...rows,
      {
        imei: "",
        brandName: "",
        modelName: "",
        purchasePrice: "",
        supplierName: "",
        purchaseDate: new Date().toISOString().split("T")[0],
        sellingPrice: "",
        customerName: "",
        customerPhone: "",
        saleDate: "",
        status: "In Stock",
      },
    ]);
  };

  const removeRow = (index) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const handleChange = (index, field, value) => {
    const updated = [...rows];
    updated[index][field] = value;
    if (field === "sellingPrice" && value.trim() !== "") {
      updated[index].status = "Sold";
      if (!updated[index].saleDate) {
        updated[index].saleDate = new Date().toISOString().split("T")[0];
      }
    } else if (field === "sellingPrice" && value.trim() === "") {
      updated[index].status = "In Stock";
    }
    setRows(updated);
  };

  const handleSystemImport = async () => {
    setLoading(true);
    setMessage("");
    try {
      const validRows = rows.filter((r) => r.imei.trim() !== "" && r.modelName.trim() !== "");
      if (validRows.length === 0) {
        setMessage("?? Kripya IMEI aur Model fill karein!");
        setLoading(false);
        return;
      }
      const stockPayload = validRows.map((r) => ({
        imei: r.imei.trim(),
        brand_name: r.brandName.trim() || "Generic",
        model_name: r.modelName.trim(),
        purchase_price: parseFloat(r.purchasePrice) || 0,
        supplier_name: r.supplierName.trim() || "Direct Counter",
        purchase_date: r.purchaseDate,
        selling_price: r.sellingPrice ? parseFloat(r.sellingPrice) : null,
        customer_name: r.customerName.trim() || null,
        customer_phone: r.customerPhone.trim() || null,
        sale_date: r.saleDate || null,
        status: r.status,
      }));

      const { error } = await supabase.from("stock").insert(stockPayload);
      if (error) throw error;
      setMessage(`? ${validRows.length} Phones System Mein Successfully Import Ho Gaye!`);
      setRows([{ imei: "", brandName: "", modelName: "", purchasePrice: "", supplierName: "", purchaseDate: new Date().toISOString().split("T")[0], sellingPrice: "", customerName: "", customerPhone: "", saleDate: "", status: "In Stock" }]);
    } catch (err) {
      setMessage(`? Import Error: ${err.message || "Database connection issue"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h2>?? Bulk Phone Buy & Sell Entry / Import Form</h2>
      {message && <div style={{ padding: "10px", marginBottom: "15px", borderRadius: "6px", backgroundColor: message.startsWith("?") ? "#e6fffa" : "#fff5f5", border: `1px solid ${message.startsWith("?") ? "#38b2ac" : "#feb2b2"}` }}>{message}</div>}
      <div style={{ overflowX: "auto" }}>
        <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse", borderColor: "#ddd", textAlign: "left", fontSize: "14px" }}>
          <thead>
            <tr style={{ background: "#f4f4f4" }}>
              <th>#</th><th>IMEI No. *</th><th>Brand & Model *</th><th>Buy Price (?)</th><th>Supplier</th><th>Buy Date</th><th>Sell Price (?)</th><th>Customer Name</th><th>Customer Mobile</th><th>Status</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td><input type="text" placeholder="IMEI" value={row.imei} onChange={(e) => handleChange(index, "imei", e.target.value)} style={{ width: "130px" }} /></td>
                <td>
                  <input type="text" placeholder="Brand" value={row.brandName} onChange={(e) => handleChange(index, "brandName", e.target.value)} style={{ width: "80px", marginRight: "4px" }} />
                  <input type="text" placeholder="Model" value={row.modelName} onChange={(e) => handleChange(index, "modelName", e.target.value)} style={{ width: "100px" }} />
                </td>
                <td><input type="number" placeholder="Buy ?" value={row.purchasePrice} onChange={(e) => handleChange(index, "purchasePrice", e.target.value)} style={{ width: "70px" }} /></td>
                <td><input type="text" placeholder="Supplier" value={row.supplierName} onChange={(e) => handleChange(index, "supplierName", e.target.value)} style={{ width: "90px" }} /></td>
                <td><input type="date" value={row.purchaseDate} onChange={(e) => handleChange(index, "purchaseDate", e.target.value)} /></td>
                <td><input type="number" placeholder="Sell ?" value={row.sellingPrice} onChange={(e) => handleChange(index, "sellingPrice", e.target.value)} style={{ width: "70px" }} /></td>
                <td><input type="text" placeholder="Customer" value={row.customerName} onChange={(e) => handleChange(index, "customerName", e.target.value)} style={{ width: "90px" }} /></td>
                <td><input type="text" placeholder="Mobile" value={row.customerPhone} onChange={(e) => handleChange(index, "customerPhone", e.target.value)} style={{ width: "90px" }} /></td>
                <td><b>{row.status}</b></td>
                <td>{rows.length > 1 && <button onClick={() => removeRow(index)} style={{ background: "red", color: "white", border: "none" }}>?</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
        <button onClick={addRow} style={{ padding: "8px 16px", background: "#3182ce", color: "white", border: "none", borderRadius: "4px" }}>? Add Row</button>
        <button onClick={handleSystemImport} disabled={loading} style={{ padding: "8px 20px", background: "#38a169", color: "white", border: "none", borderRadius: "4px" }}>{loading ? "Importing..." : "?? Direct Import to System"}</button>
      </div>
    </div>
  );
}
