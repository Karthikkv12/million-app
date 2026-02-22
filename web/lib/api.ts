/**
 * Typed API client — thin wrapper around fetch that:
 * - Points at the FastAPI backend (env: NEXT_PUBLIC_API_URL)
 * - Attaches the JWT access token from localStorage / cookie
 * - Auto-refreshes the token on 401 responses
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

// ── GEX ──────────────────────────────────────────────────────────────────────

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
  error: string | null;
}

export const fetchGex = (symbol: string) =>
  api.get<GexResult>(`/options/gamma-exposure/${symbol.toUpperCase()}`);

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
