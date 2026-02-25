/**
 * Typed API client — thin wrapper around fetch that:
 * - Points at the FastAPI backend (env: NEXT_PUBLIC_API_URL)
 * - Attaches the JWT access token from localStorage / cookie
 * - Auto-refreshes the token on 401 responses
 */

// Use the Next.js /api rewrite proxy so requests stay same-origin (HTTPS on tunnel, HTTP locally).
// Set NEXT_PUBLIC_API_URL to override (e.g. for production deployment).
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

// ── token storage (client-side only) ────────────────────────────────────────

export function getTokens(): { access: string | null; refresh: string | null } {
  if (typeof window === "undefined") return { access: null, refresh: null };
  return {
    access: localStorage.getItem("of_access"),
    refresh: localStorage.getItem("of_refresh"),
  };
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("of_access", access);
  localStorage.setItem("of_refresh", refresh);
}

export function clearTokens() {
  localStorage.removeItem("of_access");
  localStorage.removeItem("of_refresh");
}

// ── core fetch ───────────────────────────────────────────────────────────────

let _refreshing: Promise<boolean> | null = null;

async function _doRefresh(): Promise<boolean> {
  const { refresh } = getTokens();
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) { clearTokens(); return false; }
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch { clearTokens(); return false; }
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const { access } = getTokens();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (access) headers["Authorization"] = `Bearer ${access}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers });

  if (res.status === 401 && retry) {
    // coalesce concurrent refresh attempts
    if (!_refreshing) _refreshing = _doRefresh().finally(() => { _refreshing = null; });
    const ok = await _refreshing;
    if (ok) return apiFetch<T>(path, init, false);
    clearTokens();
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── convenience helpers ───────────────────────────────────────────────────────

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  user_id: number;
  username: string;
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail ?? "Login failed");
  }
  const data: AuthTokens = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data;
}

export async function logout() {
  try { await api.post("/auth/logout"); } catch { /* best effort */ }
  clearTokens();
}

export async function signup(username: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Signup failed" }));
    throw new Error(err.detail ?? "Signup failed");
  }
  const data: AuthTokens = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return data;
}

// ── GEX ──────────────────────────────────────────────────────────────────────

export interface FlowByExpiry {
  expiry: string;
  call_prem: number;
  put_prem: number;
  net: number;
}

export interface TopFlowStrike {
  strike: number;
  call_prem: number;
  put_prem: number;
  net: number;
  bias: "call" | "put";
}

export interface GexResult {
  symbol: string;
  spot: number;
  expiries: string[];
  strikes: number[];
  gex_by_strike: Record<string, number>;
  call_gex_by_strike: Record<string, number>;
  put_gex_by_strike: Record<string, number>;
  heatmap_expiries: string[];
  heatmap_strikes: number[];
  heatmap_values: number[][];
  zero_gamma: number | null;
  max_call_wall: number | null;
  max_put_wall: number | null;
  max_gex_strike: number | null;
  net_gex: number | null;
  // net flow
  call_premium: number;
  put_premium: number;
  net_flow: number;
  total_volume: number;
  flow_by_expiry: FlowByExpiry[];
  top_flow_strikes: TopFlowStrike[];
  data_source: "tradier" | "yfinance";
  error: string | null;
}

export const fetchGex = (symbol: string) =>
  api.get<GexResult>(`/options/gamma-exposure/${symbol.toUpperCase()}`);

/** Register watched symbols so the server-side background poller fetches them continuously. */
export const watchSymbols = (symbols: string[]) =>
  api.post<void>("/options/watch", { symbols });

// ── Ticker search ─────────────────────────────────────────────────────────────
export interface TickerSuggestion {
  symbol:   string;
  name:     string;
  type:     string;
  exchange: string;
}

export const searchTickers = (q: string, limit = 8) =>
  api.get<TickerSuggestion[]>(`/search/tickers?q=${encodeURIComponent(q)}&limit=${limit}`);

// ── Stock info (fundamentals) ─────────────────────────────────────────────────
export interface StockInfo {
  symbol: string;
  name?: string;
  sector?: string;
  industry?: string;
  description?: string;
  website?: string;
  exchange?: string;
  currency?: string;
  quote_type?: string;
  country?: string;
  employees?: number;
  // Market data
  market_cap?: number;
  enterprise_value?: number;
  shares_outstanding?: number;
  float_shares?: number;
  avg_volume?: number;
  avg_volume_10d?: number;
  // Price range
  week_52_high?: number;
  week_52_low?: number;
  day_high?: number;
  day_low?: number;
  fifty_day_avg?: number;
  two_hundred_day_avg?: number;
  // Valuation
  pe_ratio?: number;
  forward_pe?: number;
  pb_ratio?: number;
  ps_ratio?: number;
  peg_ratio?: number;
  ev_ebitda?: number;
  // Earnings
  eps_ttm?: number;
  eps_forward?: number;
  revenue_ttm?: number;
  gross_margin?: number;
  profit_margin?: number;
  operating_margin?: number;
  return_on_equity?: number;
  return_on_assets?: number;
  debt_to_equity?: number;
  free_cash_flow?: number;
  // Dividends
  dividend_yield?: number;
  dividend_rate?: number;
  payout_ratio?: number;
  ex_dividend_date?: number;
  // Risk
  beta?: number;
  short_ratio?: number;
  short_pct_float?: number;
  // Earnings date
  earnings_date?: number;
  error?: string | null;
}

export const fetchStockInfo = (symbol: string) =>
  api.get<StockInfo>(`/stocks/${symbol.toUpperCase()}/info`);

// ── Stock history ─────────────────────────────────────────────────────────────
export interface QuoteBar {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
}

export interface StockHistory {
  symbol: string;
  name?: string;
  bars: QuoteBar[];
  current_price?: number;
  error?: string;
}

export const fetchStockHistory = (symbol: string, period = "1d", interval = "1m") =>
  api.get<StockHistory>(`/stocks/${symbol.toUpperCase()}/history?period=${period}&interval=${interval}`);

// ── Net flow history ──────────────────────────────────────────────────────────
export interface FlowSnapshot {
  ts: string;
  price: number;
  call_prem: number;
  put_prem: number;
  net_flow: number;
  total_prem: number;
  volume: number;
}

export const fetchNetFlowHistory = (symbol: string, days = 1) =>
  api.get<FlowSnapshot[]>(`/options/net-flow-history/${symbol.toUpperCase()}?days=${days}`);

// ── Trades ───────────────────────────────────────────────────────────────────

export interface Trade {
  id: number;
  symbol: string;
  instrument: string;
  strategy: string;
  action: string;
  qty: number;
  price: number;
  date: string;
  exit_price?: number;
  exit_date?: string;
  pnl?: number;
}

export const fetchTrades = () => api.get<Trade[]>("/trades");
export const createTrade = (body: Omit<Trade, "id">) => api.post("/trades", body);
export const updateTrade = (id: number, body: Partial<Trade>) => api.put(`/trades/${id}`, body);
export const deleteTrade = (id: number) => api.del(`/trades/${id}`);

// ── Orders ───────────────────────────────────────────────────────────────────

export interface Order {
  id: number;
  symbol: string;
  instrument: string;
  action: string;
  strategy?: string;
  quantity: number;
  limit_price?: number;
  status: string;
  created_at: string;
  filled_at?: string;
  filled_price?: number;
}

export const fetchOrders = () => api.get<Order[]>("/orders");

// ── Accounts ─────────────────────────────────────────────────────────────────

export interface Account {
  id: number;
  name: string;
  broker?: string;
  currency: string;
  created_at?: string;
}

export const fetchAccounts = () => api.get<Account[]>("/accounts");
export const fetchCashBalance = (currency = "USD") =>
  api.get<{ currency: string; balance: number }>(`/cash/balance?currency=${currency}`);

// ── Budget ────────────────────────────────────────────────────────────────────

export interface BudgetEntry {
  id?: number;
  category: string;
  type: "EXPENSE" | "INCOME" | "ASSET" | string;
  amount: number;
  date: string;
  description?: string;
}

export const fetchBudget = () => api.get<BudgetEntry[]>("/budget");
export const saveBudget = (body: Omit<BudgetEntry, "id">) => api.post("/budget", body);

// ── Auth: sessions + events + change-password ─────────────────────────────────

export interface AuthSession {
  id: number;
  created_at: string;
  last_used_at?: string;
  user_agent?: string;
  ip_address?: string;
  is_current?: boolean;
}

export interface AuthEvent {
  id: number;
  event_type: string;
  success: boolean;
  created_at: string;
  ip_address?: string;
  user_agent?: string;
}

export const fetchAuthSessions = () => api.get<AuthSession[]>("/auth/sessions");
export const revokeSession = (id: number) => api.post(`/auth/sessions/${id}/revoke`);
export const fetchAuthEvents = () => api.get<AuthEvent[]>("/auth/events");
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post("/auth/change-password", { current_password: currentPassword, new_password: newPassword });

// ── Cash ─────────────────────────────────────────────────────────────────────

export const addCash = (amount: number, direction: "deposit" | "withdrawal", note?: string) =>
  api.post("/cash", { amount, direction, note });

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface AdminUser {
  user_id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at?: string;
}

export const adminListUsers = () => api.get<AdminUser[]>("/admin/users");

export const adminCreateUser = (username: string, password: string, role: "admin" | "user") =>
  api.post<AdminUser>("/admin/users", { username, password, role });

export const adminPatchUser = (user_id: number, patch: { role?: string; is_active?: boolean }) =>
  api.patch<AdminUser>(`/admin/users/${user_id}`, patch);

