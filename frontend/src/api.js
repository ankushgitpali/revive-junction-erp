import { isSupabaseConfigured, supabase } from "./supabase";
import { fetchAllRows } from "./fetchAllRows.js";

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured. Live business data is unavailable.");
  }
  return supabase;
}

export async function fetchDashboardOverview() {
  const client = requireSupabase();
  const result = await fetchAllRows(() => client
    .from("phones")
    .select("id, purchase_price", { count: "exact" })
    .order("id", { ascending: true }));

  return {
    totalPhones: result.count,
    stockInvestment: result.data.reduce(
      (sum, phone) => sum + Number(phone.purchase_price || 0),
      0,
    ),
    todaySales: null,
    todayProfit: null,
    cashInHand: null,
    upiBank: null,
    connected: true,
  };
}

export async function fetchTable(tableName, select = "*", filters = {}) {
  const client = requireSupabase();
  const result = await fetchAllRows(() => {
    let query = client.from(tableName).select(select, { count: "exact" });
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null) query = query.eq(key, value);
    });
    return query.order("id", { ascending: true });
  });
  return result.data;
}
