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
  role?: string;
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

// ── Weekly Options Portfolio ──────────────────────────────────────────────────

export interface WeeklySnapshot {
  id: number;
  week_start: string;
  week_end: string;
  account_value: number | null;
  is_complete: boolean;
  completed_at: string | null;
  notes: string | null;
  label: string;
}

export type PositionStatus = "ACTIVE" | "CLOSED" | "EXPIRED" | "ASSIGNED" | "ROLLED";

export interface OptionPosition {
  id: number;
  week_id: number;
  symbol: string;
  contracts: number;
  strike: number;
  option_type: "CALL" | "PUT";
  sold_date: string | null;
  buy_date: string | null;
  expiry_date: string | null;
  premium_in: number | null;
  premium_out: number | null;
  spot_price: number | null;
  is_roll: boolean;
  status: PositionStatus;
  rolled_to_id: number | null;
  carried_from_id: number | null;
  holding_id: number | null;
  margin: number | null;
  notes: string | null;
  // computed
  net_premium: number;
  total_premium: number;
  // moneyness (computed from spot_price when available)
  intrinsic_value: number | null;
  extrinsic_value: number | null;
  moneyness: "ITM" | "ATM" | "OTM" | null;
  // carry-forward: set when this position is ACTIVE from a prior week
  carried?: boolean;
  origin_week_label?: string | null;
}

export interface StockAssignment {
  id: number;
  position_id: number;
  symbol: string;
  shares_acquired: number;
  acquisition_price: number;
  additional_buys: { shares: number; price: number }[];
  covered_calls: { contracts: number; strike: number; premium: number; sold_date: string; status: string }[];
  net_option_premium: number;
  notes: string | null;
  // computed cost basis
  total_shares: number;
  total_cost: number;
  weighted_avg_cost: number;
  downside_basis: number;
  upside_basis: number;
  downside_breakeven: number;
  upside_breakeven: number;
}

export interface WeekBreakdown {
  id: number;
  week_start: string;
  week_end: string;
  is_complete: boolean;
  account_value: number | null;
  premium: number;
  realized_pnl: number;
  position_count: number;
}

export interface PortfolioSummary {
  total_premium_collected: number;
  realized_pnl: number;
  active_positions: number;
  assigned_positions: number;
  estimated_tax: number;
  cap_gains_tax_rate: number;
  monthly_account_values: Record<string, number>;
  monthly_premium: Record<string, number>;
  total_weeks: number;
  complete_weeks: number;
  win_rate: number;
  best_week: WeekBreakdown | null;
  worst_week: WeekBreakdown | null;
  weeks_breakdown: WeekBreakdown[];
}

export interface SymbolSummary {
  symbol: string;
  total_premium: number;
  realized_pnl: number;
  active: number;
  closed: number;
  expired: number;
  assigned: number;
}

// Weeks
export const fetchWeeks = () => api.get<WeeklySnapshot[]>("/portfolio/weeks");
export const getOrCreateWeek = (for_date?: string) =>
  api.post<WeeklySnapshot>("/portfolio/weeks", { for_date: for_date ?? null });
export const fetchWeek = (id: number) => api.get<WeeklySnapshot>(`/portfolio/weeks/${id}`);
export const updateWeek = (id: number, body: { account_value?: number; notes?: string }) =>
  api.patch<WeeklySnapshot>(`/portfolio/weeks/${id}`, body);
export const completeWeek = (id: number, account_value?: number) =>
  api.post<WeeklySnapshot>(`/portfolio/weeks/${id}/complete`, { account_value: account_value ?? null });
export const reopenWeek = (id: number) =>
  api.post<WeeklySnapshot>(`/portfolio/weeks/${id}/reopen`, {});

// Positions
export const fetchPositions = (week_id: number) =>
  api.get<OptionPosition[]>(`/portfolio/weeks/${week_id}/positions`);
export const createPosition = (week_id: number, body: Partial<OptionPosition>) =>
  api.post<OptionPosition>(`/portfolio/weeks/${week_id}/positions`, body);
export const updatePosition = (id: number, body: Partial<OptionPosition> & { status?: PositionStatus }) =>
  api.patch<OptionPosition>(`/portfolio/positions/${id}`, body);
export const deletePosition = (id: number) => api.del(`/portfolio/positions/${id}`);

// Assignments
export const createAssignment = (position_id: number, body: Partial<StockAssignment>) =>
  api.post<StockAssignment>(`/portfolio/positions/${position_id}/assign`, body);
export const fetchAssignment = (position_id: number) =>
  api.get<StockAssignment>(`/portfolio/positions/${position_id}/assignment`);
export const updateAssignment = (id: number, body: Partial<StockAssignment>) =>
  api.patch<StockAssignment>(`/portfolio/assignments/${id}`, body);

// Summary
export const fetchPortfolioSummary = () => api.get<PortfolioSummary>("/portfolio/summary");
export const fetchSymbolSummary = () => api.get<SymbolSummary[]>("/portfolio/symbols");

// ── Stock Holdings ────────────────────────────────────────────────────────────

export interface PremiumLedgerRow {
  id: number;
  holding_id: number;
  position_id: number;
  symbol: string;
  week_id: number | null;
  option_type: "CALL" | "PUT";
  strike: number;
  contracts: number;
  expiry_date: string | null;
  premium_sold: number;       // total credit when opened
  realized_premium: number;   // locked-in (position closed/expired)
  unrealized_premium: number; // in-flight (position still active)
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PremiumSummary {
  holding_id: number;
  realized_premium: number;
  unrealized_premium: number;
  total_premium_sold: number;
  rows: PremiumLedgerRow[];
}

export interface StockHolding {
  id: number;
  symbol: string;
  company_name: string | null;
  shares: number;
  cost_basis: number;
  adjusted_cost_basis: number;   // stored: cost_basis − realized_premium/share (locked-in)
  live_adj_basis: number;        // live: adj_basis − unrealized_premium/share (in-flight)
  upside_basis: number | null;   // lowest active CC strike (ceiling if called away)
  downside_basis: number;        // live_adj_basis = true breakeven
  // Premium breakdown
  realized_premium: number;      // total $ locked in from closed/expired options
  unrealized_premium: number;    // total $ still in-flight (active options)
  total_premium_sold: number;    // gross premium ever sold against this holding
  acquired_date: string | null;
  status: "ACTIVE" | "CLOSED";
  notes: string | null;
  created_at: string;
  updated_at: string;
  // computed
  total_original_cost: number;
  total_adjusted_cost: number;
  basis_reduction: number;
  basis_reduction_stored: number;
}

export type HoldingEventType = "CC_EXPIRED" | "CC_ASSIGNED" | "CSP_ASSIGNED" | "MANUAL";

export interface HoldingEvent {
  id: number;
  holding_id: number;
  position_id: number | null;
  event_type: HoldingEventType;
  shares_delta: number | null;
  basis_delta: number | null;
  realized_gain: number | null;
  description: string | null;
  created_at: string;
}

export const fetchHoldings = () => api.get<StockHolding[]>("/portfolio/holdings");
export const createHolding = (body: {
  symbol: string; shares: number; cost_basis: number;
  company_name?: string; acquired_date?: string; notes?: string;
}) => api.post<StockHolding>("/portfolio/holdings", body);
export const updateHolding = (id: number, body: Partial<StockHolding>) =>
  api.patch<StockHolding>(`/portfolio/holdings/${id}`, body);
export const deleteHolding = (id: number) => api.del(`/portfolio/holdings/${id}`);
export const fetchHoldingEvents = (holding_id: number) =>
  api.get<HoldingEvent[]>(`/portfolio/holdings/${holding_id}/events`);
export const seedHoldingsFromPositions = () =>
  api.post<{ created: StockHolding[]; linked: number }>("/portfolio/holdings/seed-from-positions", {});
export const recalculateHoldings = () =>
  api.post<{ updated: number; holdings: { symbol: string; cost_basis: number; old_adj: number; new_adj: number; corrected: boolean }[] }>("/portfolio/holdings/recalculate", {});
export const syncPremiumLedger = () =>
  api.post<{ synced_rows: number; updated_holdings: number }>("/portfolio/holdings/sync-ledger", {});
export const fetchHoldingPremiumLedger = (holding_id: number) =>
  api.get<PremiumSummary>(`/portfolio/holdings/${holding_id}/premium-ledger`);

// ── Premium Dashboard ─────────────────────────────────────────────────────────

export interface PremiumSymbolRow {
  symbol: string;
  holding_id: number;
  cost_basis: number;
  shares: number;
  realized_premium: number;
  unrealized_premium: number;
  total_premium_sold: number;
  positions: number;
  realized_per_share: number;
  unrealized_per_share: number;
  live_adj_basis: number;
  adj_basis_stored: number;
  rows: PremiumLedgerRow[];
}

export interface PremiumWeekSymbol {
  symbol: string;
  realized: number;
  unrealized: number;
  sold: number;
}

export interface PremiumWeekRow {
  week_id: number;
  week_label: string;
  realized_premium: number;
  unrealized_premium: number;
  total_premium_sold: number;
  symbols: PremiumWeekSymbol[];
}

export interface PremiumDashboard {
  by_symbol: PremiumSymbolRow[];
  by_week: PremiumWeekRow[];
  grand_total: {
    realized_premium: number;
    unrealized_premium: number;
    total_premium_sold: number;
  };
}

export const fetchPremiumDashboard = () =>
  api.get<PremiumDashboard>("/portfolio/premium-dashboard");

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

export type BudgetEntryType = "FLOATING" | "RECURRING";
export type BudgetRecurrence = "MONTHLY" | "SEMI_ANNUAL" | "ANNUAL";

export interface BudgetEntry {
  id?: number;
  category: string;
  type: "EXPENSE" | "INCOME" | "ASSET" | string;
  entry_type?: BudgetEntryType;
  recurrence?: BudgetRecurrence;
  amount: number;
  date: string;
  description?: string;
  merchant?: string;
  active_until?: string;  // YYYY-MM
}

export const fetchBudget  = () => api.get<BudgetEntry[]>("/budget");
export const saveBudget   = (body: Omit<BudgetEntry, "id">) => api.post("/budget", body);
export const updateBudget = (id: number, body: Partial<Omit<BudgetEntry, "id">>) =>
  api.patch<BudgetEntry>(`/budget/${id}`, body);
export const deleteBudget = (id: number) => api.del<void>(`/budget/${id}`);

// ── Budget Overrides ──────────────────────────────────────────────────────────

export interface BudgetOverride {
  id?: number;
  budget_id: number;
  month_key: string;   // 'YYYY-MM'
  amount: number;
  description?: string | null;
}

export const fetchBudgetOverrides = () => api.get<BudgetOverride[]>("/budget-overrides");
export const saveBudgetOverride   = (body: Omit<BudgetOverride, "id">) =>
  api.post<{ id: number }>("/budget-overrides", body);
export const deleteBudgetOverride = (id: number) => api.del<void>(`/budget-overrides/${id}`);

// ── Credit Card Weeks ─────────────────────────────────────────────────────────

export interface CreditCardWeek {
  id?: number;
  week_start: string;   // ISO date string — Monday of the week
  card_name?: string | null;
  balance: number;
  squared_off: boolean;
  paid_amount?: number | null;
  note?: string | null;
}

export const fetchCCWeeks  = () => api.get<CreditCardWeek[]>("/credit-card/weeks");
export const saveCCWeek    = (body: Omit<CreditCardWeek, "id">) => api.post<{ id: number }>("/credit-card/weeks", body);
export const updateCCWeek  = (id: number, body: Omit<CreditCardWeek, "id">) =>
  api.patch<void>(`/credit-card/weeks/${id}`, body);
export const deleteCCWeek  = (id: number) => api.del<void>(`/credit-card/weeks/${id}`);

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

export const adminDeleteUser = async (user_id: number): Promise<void> => {
  await apiFetch<void>(`/admin/users/${user_id}`, { method: "DELETE" });
};

