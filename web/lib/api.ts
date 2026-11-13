/**
 * Typed API client — thin wrapper around fetch that:
 * - Points at the FastAPI backend (env: NEXT_PUBLIC_API_URL)
 * - Attaches the JWT access token from localStorage / cookie
 * - Auto-refreshes the token on 401 responses
 */

// Versioned API through the Next.js rewrite (same-origin: HTTPS on the tunnel, HTTP locally).
// Set NEXT_PUBLIC_API_URL to override (e.g. a phone app or a separate API host).
export const BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

// ── Generated types (web/lib/api-types.ts, from the backend's OpenAPI) ──────────
// Regenerate after any API change: `python scripts/export_openapi.py && npm run gen:api`.
import type { components, paths } from "./api-types";
export type Schemas = components["schemas"];
/** JSON body of a 200 GET response, e.g. `V1Get<"/api/v1/catalyst/{symbol}">`. */
export type V1Get<P extends keyof paths> =
  paths[P] extends { get: { responses: { 200: { content: { "application/json": infer R } } } } } ? R : never;

// ── tokens (client-side only) ────────────────────────────────────────────────
// The access token (15 min) lives only in this tab's memory. The refresh token never reaches page
// scripts at all: the API keeps it in an HttpOnly, SameSite=Strict cookie scoped to /api/v1/auth, so
// nothing running in the page (an injected script, a bad extension, a copied localStorage) can steal a
// long-lived login. A reload gets a new access token from that cookie. Logins end after 7 days.

let _access: string | null = null;
const LEGACY_KEYS = ["of_access", "of_refresh"];   // where tokens used to live; migrated once, then deleted
/** Tells the API to keep the refresh token in the cookie and leave it out of the JSON body. */
export const COOKIE_MODE = { "X-Token-Transport": "cookie" } as const;

export function getTokens(): { access: string | null } {
  return { access: _access };
}

export function setAccessToken(access: string | null) {
  _access = access;
}

function dropLegacyTokens() {
  try { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* storage off */ }
}

export function clearTokens() {
  _access = null;
  dropLegacyTokens();
}

/** Access-token claims (no verification: only for showing who is signed in and when it expires). */
export function tokenClaims(access: string | null): { sub?: string; username?: string; role?: string; exp?: number } | null {
  if (!access) return null;
  try { return JSON.parse(atob(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}

// ── session refresh ──────────────────────────────────────────────────────────

let _refreshing: Promise<AuthTokens | null> | null = null;

async function _refreshOnce(): Promise<AuthTokens | null> {
  // A device signed in before the cookie change still has its token in localStorage: send it once so
  // the API moves it into the cookie, then delete it from storage.
  let legacy: string | null = null;
  try { legacy = typeof window !== "undefined" ? localStorage.getItem("of_refresh") : null; } catch { /* storage off */ }
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...COOKIE_MODE },
      body: JSON.stringify(legacy ? { refresh_token: legacy } : {}),
    });
    dropLegacyTokens();
    if (!res.ok) { _access = null; return null; }
    const data: AuthTokens = await res.json();
    _access = data.access_token;
    return data;
  } catch { return null; }
}

/**
 * Get a new access token from the refresh cookie. Concurrent calls share one request, and tabs take
 * turns (Web Locks) so two tabs never present the same refresh token: the API treats a replayed
 * token as theft and signs that login out.
 */
export function refreshSession(): Promise<AuthTokens | null> {
  if (!_refreshing) {
    const run: Promise<AuthTokens | null> = typeof navigator !== "undefined" && navigator.locks?.request
      // The DOM typings say Promise<Promise<…>>; the lock's promise resolves with the callback's result.
      ? (navigator.locks.request("of-refresh", () => _refreshOnce()) as unknown as Promise<AuthTokens | null>)
      : _refreshOnce();
    _refreshing = run.finally(() => { _refreshing = null; });
  }
  return _refreshing;
}

/** Plain message from an error body: v1 `{error:{message}}`, legacy `{detail}`, or the raw text. */
function errorMessage(text: string): string {
  try {
    const body = JSON.parse(text);
    const msg = body?.error?.message ?? body?.detail;
    if (typeof msg === "string") return msg;
    if (Array.isArray(msg)) return msg.map((m) => m?.msg ?? String(m)).join("; ");   // 422 validation list
  } catch { /* not JSON */ }
  return text;
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
    if (await refreshSession()) return apiFetch<T>(path, init, false);
    clearTokens();
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(errorMessage(text) || `HTTP ${res.status}`);
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
  refresh_token?: string | null;   // null for the web: it's in the HttpOnly cookie
  user_id: number;
  username: string;
  role?: string;
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...COOKIE_MODE },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail ?? "Login failed");
  }
  const data: AuthTokens = await res.json();
  _access = data.access_token;
  dropLegacyTokens();
  return data;
}

export async function logout() {
  // The API revokes this device's refresh token (read from the cookie) and clears the cookie.
  try { await apiFetch("/auth/logout", { method: "POST", headers: COOKIE_MODE }, false); } catch { /* best effort */ }
  clearTokens();
}

export async function signup(username: string, password: string): Promise<AuthTokens> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...COOKIE_MODE },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Signup failed" }));
    throw new Error(err.detail ?? "Signup failed");
  }
  const data: AuthTokens = await res.json();
  _access = data.access_token;
  dropLegacyTokens();
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

/** Generated from the backend schema (GexOut), including the VEX grid. */
export type GexResult = Schemas["GexOut"];

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

/** `prepost`: ask for pre- and after-market bars too. Servers that don't support it yet ignore the flag and send
 *  regular-session bars only (the Pulse chart says so). */
export const fetchStockHistory = (symbol: string, period = "1d", interval = "1m", prepost = false) =>
  api.get<StockHistory>(`/stocks/${encodeURIComponent(symbol.toUpperCase())}/history?period=${period}&interval=${interval}${prepost ? "&prepost=true" : ""}`);

// ── Insight: drawdown / spike series and the LEAPS score ─────────────────────
export type Swings = Schemas["SwingsOut"];
export type SwingPeriod = "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";
export type LeapsScore = Schemas["LeapsScoreOut"];
export const fetchSwings = (symbol: string, period: SwingPeriod = "1y") =>
  api.get<Swings>(`/insight/${encodeURIComponent(symbol.toUpperCase())}/swings?period=${period}`);
export const fetchLeapsScore = (symbol: string) =>
  api.get<LeapsScore>(`/insight/${encodeURIComponent(symbol.toUpperCase())}/leaps-score`);
export type LeapsScoreBrief = Schemas["LeapsScoreBrief"];
export type LeapsScores = Schemas["LeapsScoresOut"];
/** Many symbols in one request (up to 60): scores and entry, no factors. */
export const fetchLeapsScores = (symbols: string[]) =>
  api.get<LeapsScores>(`/insight/leaps-scores?symbols=${symbols.map((s) => encodeURIComponent(s.toUpperCase())).join(",")}`);

// ── Net flow history ──────────────────────────────────────────────────────────
export interface FlowSnapshot {
  ts: string;
  price: number;
  call_prem: number;
  put_prem: number;
  net_flow: number;
  total_prem: number;
  volume: number;
  /** Premium traded today so far (Δvolume × mid per contract, cumulative since the ET open). Null outside the
   *  session and on rows before 2026-11-13. */
  call_traded?: number | null;
  put_traded?: number | null;
  net_traded?: number | null;
  /** The part of the traded premium filed by side: filled at or near the ask (bought) or the bid (sold). Mid fills
   *  and volume from before the first refresh have no side. Null on rows before 2026-11-13 ~noon ET. */
  call_bought?: number | null;
  call_sold?: number | null;
  put_bought?: number | null;
  put_sold?: number | null;
  /** Net call premium (calls bought − sold) and net put premium (puts bought − sold). */
  ncp?: number | null;
  npp?: number | null;
}

export const fetchNetFlowHistory = (symbol: string, days = 1) =>
  api.get<FlowSnapshot[]>(`/options/net-flow-history/${symbol.toUpperCase()}?days=${days}`);

// ── Weekly Options Portfolio ──────────────────────────────────────────────────

export interface WeeklySnapshot {
  id: number;
  week_start: string;
  week_end: string;
  account_value: number | null;
  acct_label_1: string | null;
  acct_val_1: number | null;
  acct_label_2: string | null;
  acct_val_2: number | null;
  acct_label_3: string | null;
  acct_val_3: number | null;
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
  acct_label_1: string | null;
  acct_val_1: number | null;
  acct_label_2: string | null;
  acct_val_2: number | null;
  acct_label_3: string | null;
  acct_val_3: number | null;
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

// ── Broker Accounts ───────────────────────────────────────────────────────────

export interface BrokerAccount {
  id: number;
  name: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface AccountBalance {
  account_id: number;
  week_date: string;  // "YYYY-MM-DD"
  balance: number;
}

export const fetchBrokerAccounts = () =>
  api.get<BrokerAccount[]>("/portfolio/broker-accounts");

export const createBrokerAccount = (body: { name: string; color?: string; sort_order?: number }) =>
  api.post<BrokerAccount>("/portfolio/broker-accounts", body);

export const updateBrokerAccount = (id: number, body: Partial<{ name: string; color: string; sort_order: number; is_active: boolean }>) =>
  api.patch<BrokerAccount>(`/portfolio/broker-accounts/${id}`, body);

export const deleteBrokerAccount = (id: number) =>
  api.del<{ status: string }>(`/portfolio/broker-accounts/${id}`);

export const fetchAccountBalances = (year: number) =>
  api.get<AccountBalance[]>(`/portfolio/account-balances?year=${year}`);

export const fetchAllAccountBalances = () =>
  api.get<AccountBalance[]>("/portfolio/account-balances/all");

export const fetchAccountBalanceYears = () =>
  api.get<number[]>("/portfolio/account-balances/years");

export const upsertAccountBalance = (body: { account_id: number; week_date: string; balance: number }) =>
  api.put<AccountBalance>("/portfolio/account-balances", body);

export const deleteAccountBalance = (account_id: number, week_date: string) =>
  api.del<{ status: string }>(`/portfolio/account-balances/${account_id}/${week_date}`);

// Cash Deposits
export interface CashDeposit {
  id: number;
  week_date: string;  // "YYYY-MM-DD" Friday
  amount: number;     // positive = deposit, negative = withdrawal
  note: string | null;
  created_at: string;
}

export const fetchCashDeposits = () =>
  api.get<CashDeposit[]>("/portfolio/cash-deposits");

export const upsertCashDeposit = (body: { week_date: string; amount: number; note?: string; id?: number }) =>
  api.put<CashDeposit>("/portfolio/cash-deposits", body);

export const deleteCashDeposit = (id: number) =>
  api.del<{ status: string }>(`/portfolio/cash-deposits/${id}`);

// Weeks
export const fetchWeeks = () => api.get<WeeklySnapshot[]>("/portfolio/weeks");
export const getOrCreateWeek = (for_date?: string) =>
  api.post<WeeklySnapshot>("/portfolio/weeks", { for_date: for_date ?? null });
export const fetchWeek = (id: number) => api.get<WeeklySnapshot>(`/portfolio/weeks/${id}`);
export interface SubAccountPayload {
  acct_label_1?: string; acct_val_1?: number;
  acct_label_2?: string; acct_val_2?: number;
  acct_label_3?: string; acct_val_3?: number;
}
export const updateWeek = (id: number, body: { account_value?: number; notes?: string } & SubAccountPayload) =>
  api.patch<WeeklySnapshot>(`/portfolio/weeks/${id}`, body);
export const completeWeek = (id: number, payload?: { account_value?: number } & SubAccountPayload) =>
  api.post<WeeklySnapshot>(`/portfolio/weeks/${id}/complete`, payload ?? {});
export const reopenWeek = (id: number) =>
  api.post<WeeklySnapshot>(`/portfolio/weeks/${id}/reopen`, {});

// Positions
export const fetchPositions = (week_id: number) =>
  api.get<OptionPosition[]>(`/portfolio/weeks/${week_id}/positions`);
export const fetchAllPositions = () =>
  api.get<OptionPosition[]>(`/portfolio/positions`);
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
  // assignment tracking
  called_away: boolean;                              // true when CLOSED via CC assignment
  last_assignment_type: HoldingEventType | null;     // most recent CC_ASSIGNED / CSP_ASSIGNED
  last_assignment_date: string | null;               // ISO datetime of that event
  // realized P&L for closed/called-away holdings (null for active)
  realized_gain: number | null;
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
  adj_at_exit: number;
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
// Changing the password signs out every other device and this access token; the reply carries the new
// access token (and the API sets a new refresh cookie), so this device stays signed in.
export const changePassword = async (currentPassword: string, newPassword: string) => {
  const data = await apiFetch<AuthTokens>("/auth/change-password", {
    method: "POST", headers: COOKIE_MODE,
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  _access = data.access_token;
  return data;
};
export const logoutAll = () => api.post("/auth/logout-all");

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

export const adminPatchUser = (user_id: number, patch: { role?: string; is_active?: boolean; password?: string }) =>
  api.patch<AdminUser>(`/admin/users/${user_id}`, patch);

export const adminDeleteUser = async (user_id: number): Promise<void> => {
  await apiFetch<void>(`/admin/users/${user_id}`, { method: "DELETE" });
};

export interface MarketQuote {
  symbol: string;
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
}

export const fetchMarketQuotes = (symbols: string[]) =>
  api.get<MarketQuote[]>(`/market/quotes?symbols=${symbols.map(s => s.toUpperCase()).join(",")}`);

// ── Watchlist rich quotes ─────────────────────────────────────────────────────

export interface WatchlistQuote {
  symbol:            string;
  name:              string | null;
  price:             number | null;
  prev_close:        number | null;
  change:            number | null;
  change_pct:        number | null;
  volume:            number | null;
  avg_volume:        number | null;
  rel_volume:        number | null;
  market_cap:        number | null;
  market_cap_fmt:    string | null;
  pe_ratio:          number | null;
  forward_pe:        number | null;
  eps_ttm:           number | null;
  eps_growth:        number | null;
  div_yield:         number | null;
  sector:            string | null;
  industry:          string | null;
  analyst_rating:    string | null;
  beta:              number | null;
  week_52_high:      number | null;
  week_52_low:       number | null;
  day_high:          number | null;
  day_low:           number | null;
  fifty_day_avg:     number | null;
  two_hundred_day_avg: number | null;
  error:             string | null;
}

/** Fetch rich watchlist quotes (price, P/E, EPS, market cap, sector, analyst rating, etc.) */
export const fetchWatchlistQuotes = (symbols: string[]) =>
  api.get<WatchlistQuote[]>(`/market/watchlist-quotes?symbols=${symbols.map(s => s.toUpperCase()).join(",")}`);


// ── Watchlist ─────────────────────────────────────────────────────────────────

export interface WatchlistSymbol {
  id:           number;
  symbol:       string;
  company_name: string | null;
  /** "manual" | "position" | "holding" */
  source:       string;
  notes:        string | null;
  is_active:    boolean;
  added_at:     string;
  updated_at:   string;
}

/** Fetch all active watchlist symbols for the current user. */
export const fetchWatchlist = () =>
  api.get<WatchlistSymbol[]>("/watchlist");

/**
 * Add or reactivate a symbol in the watchlist (manual source).
 * company_name and notes are optional.
 */
export const upsertWatchlistSymbol = (
  symbol: string,
  opts: { company_name?: string; notes?: string } = {},
) =>
  api.put<WatchlistSymbol>(`/watchlist/${symbol.toUpperCase()}`, {
    symbol: symbol.toUpperCase(),
    ...opts,
  });

/** Soft-delete a symbol from the watchlist. */
export const deleteWatchlistSymbol = (symbol: string) =>
  api.del<void>(`/watchlist/${symbol.toUpperCase()}`);

/**
 * Trigger a full sync: scans all existing positions + holdings
 * and registers any symbols not yet in the watchlist.
 */
export const syncWatchlist = () =>
  api.post<{ positions_synced: number; holdings_synced: number; total_added: number }>(
    "/watchlist/sync",
  );

// ── Watchlists (named lists, up to 20; seeded one per sector) ─────────────────
export type WatchlistGroup = Schemas["WatchlistGroupOut"];
export type WatchlistGroups = Schemas["WatchlistGroupsOut"];
const wl = (id: number) => `/watchlists/${id}`;
const sym = (s: string) => encodeURIComponent(s.trim().toUpperCase());
/** Every list in display order. The first call creates "My watchlist" plus one list per sector. */
export const fetchWatchlistGroups = () => api.get<WatchlistGroups>("/watchlists");
export const createWatchlistGroup = (name: string, symbols: string[] = []) => api.post<WatchlistGroup>("/watchlists", { name, symbols });
export const updateWatchlistGroup = (id: number, body: { name?: string; symbols?: string[]; columns?: string[] }) => api.patch<WatchlistGroup>(wl(id), body);
export type OptionMetrics = Schemas["OptionMetricsOut"];
/** ATM IV, IV change today, HV20, IV/HV, weekly expected move and ATM deltas (up to 40 symbols per call). */
export const fetchOptionMetrics = (symbols: string[]) =>
  api.get<OptionMetrics[]>(`/watchlists/option-metrics?symbols=${symbols.map((s) => encodeURIComponent(s)).join(",")}`);
export const deleteWatchlistGroup = (id: number) => api.del<void>(wl(id));
/** Cboe's extended-hours options list (pre-market 7:30–9:25, post-market 4:00–4:15 ET), read from Cboe and refreshed every 12 h. */
export type ExtendedHours = Schemas["ExtendedHoursOut"];
export const fetchExtendedHours = () => api.get<ExtendedHours>("/watchlists/extended-hours");
export const addToWatchlistGroup = (id: number, symbol: string) => api.put<WatchlistGroup>(`${wl(id)}/symbols/${sym(symbol)}`);
export const removeFromWatchlistGroup = (id: number, symbol: string) => api.del<WatchlistGroup>(`${wl(id)}/symbols/${sym(symbol)}`);
export const restoreSectorWatchlists = () => api.post<WatchlistGroups>("/watchlists/restore-sectors");

// ── Catalyst ──────────────────────────────────────────────────────────────────
export interface CatalystSignal { label: string; tone: "good" | "bad" | "warn" | "neutral" }
// Hand-written until CatalystsOut types its nested sections (coordination C-8).
export interface Catalysts {
  symbol: string; name: string; price: number | null; change_pct: number | null;
  earnings: { date: string | null; days_until: number | null; timing: string | null;
    eps_avg: number | null; eps_low: number | null; eps_high: number | null;
    revenue_avg: number | null; revenue_low: number | null; revenue_high: number | null };
  dividend: { ex_date: string | null; ex_days_until: number | null; pay_date: string | null; rate: number | null; yield_pct: number | null };
  expected_move: { dollars: number; pct: number; low: number; high: number; expiry: string; strike: number; covers_earnings: boolean } | null;
  earnings_history: { date: string; estimate: number | null; reported: number; surprise_pct: number | null }[];
  analysts: {
    rating: string | null;
    consensus: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
    targets: { low: number | null; mean: number | null; median: number | null; high: number | null };
    upside_pct: number | null;
    actions: { date: string; firm: string; action: string; from: string | null; to: string | null; target: number | null; prior_target: number | null }[];
  };
  volume: { today: number | null; average: number | null; relative: number | null; short_pct_float: number | null; short_ratio: number | null; beta: number | null };
  range: { high: number | null; low: number | null; position_pct: number | null };
  news: { title: string; publisher: string | null; url: string | null; published: string | number | null }[];
  signals: CatalystSignal[];
  as_of: string; source: string;
}
export const fetchCatalysts = (symbol: string) => api.get<Catalysts>(`/catalyst/${encodeURIComponent(symbol)}`);

// ── Unusual options activity ─────────────────────────────────────────────────
export interface UnusualRow {
  symbol: string; type: "call" | "put"; strike: number; expiry: string; dte: number;
  spot: number | null; otm_pct: number | null; last: number | null; bid: number | null; ask: number | null;
  side: "ask" | "bid" | "mid" | "unknown"; volume: number; open_interest: number; vol_oi: number | null;
  iv_pct: number | null; premium: number; score: number;
}
export interface UnusualScan { rows: UnusualRow[]; count: number; symbols: string[]; call_premium: number; put_premium: number; as_of: string; source: string }
export const fetchUnusual = (opts: { symbols?: string[]; minPremium?: number; type?: "all" | "call" | "put" } = {}) => {
  const q = new URLSearchParams();
  if (opts.symbols?.length) q.set("symbols", opts.symbols.join(","));
  if (opts.minPremium) q.set("min_premium", String(opts.minPremium));
  if (opts.type && opts.type !== "all") q.set("type", opts.type);
  const qs = q.toString();
  return api.get<UnusualScan>(`/unusual${qs ? `?${qs}` : ""}`);
};

// ── Money flow leaders (net premium since the open, across the watched universe) ─
export type FlowLeaders = Schemas["FlowLeadersOut"];
export const fetchFlowLeaders = (limit = 5) => api.get<FlowLeaders>(`/flow/leaders?limit=${limit}`);

// ── By-strike flow: bought / sold premium and customer delta $ per strike today ─
export type StrikeFlow = Schemas["StrikeFlowOut"];
export const fetchStrikeFlow = (symbol: string, expiry?: string | null) =>
  api.get<StrikeFlow>(`/flow/${encodeURIComponent(symbol.toUpperCase())}/strikes${expiry ? `?expiry=${expiry}` : ""}`);

// ── Scenario / payoff matrix (risk.scenario) ─────────────────────────────────
export type ScenarioIn = Schemas["ScenarioIn"];
export type ScenarioLegIn = Schemas["ScenarioLegIn"];
export type Scenario = Schemas["ScenarioOut"];
export const postScenario = (body: ScenarioIn) => api.post<Scenario>("/risk/scenario", body);

// ── Hedge desk (delta-neutral indicator for held positions) ──────────────────
export type HedgeBooks = Schemas["BooksOut"];
export type HedgeBook = Schemas["BookOut"];
export type HedgeLeg = Schemas["LegOut"];
export type HedgeSuggestion = Schemas["SuggestionOut"];
export type BrokerPosition = Schemas["BrokerPositionOut"];

export const fetchHedgeBooks = () => api.get<HedgeBooks>("/hedge/books");
export type VolTarget = Schemas["VolTargetOut"];
export type VolTargetHolding = Schemas["VolTargetHolding"];
/** Volatility targeting on the synced book: target and cap are decimals (0.15 = 15%, 1 = never more than all-in). */
export const fetchVolTarget = (target: number, cap: number, capital?: number | null) =>
  api.get<VolTarget>(`/risk/vol-target?target=${target}&cap=${cap}${capital ? `&capital=${capital}` : ""}`);
export type Factors = Schemas["FactorsOut"];
export type FactorHolding = Schemas["FactorHolding"];
export type BookFactor = Schemas["BookFactor"];
/** Factor exposure of the synced book (APT): betas to market, tech, size and rates; risk split by factor. */
export const fetchFactors = (capital?: number | null) => api.get<Factors>(`/risk/factors${capital ? `?capital=${capital}` : ""}`);

// ── Strategy (drives the desk's actions) ─────────────────────────────────────
export type StrategyState = Schemas["StrategyOut"];
export type StrategyInfo = Schemas["StrategyInfo"];
export type StrategyUpdate = Schemas["StrategyUpdate"];
export const fetchStrategy = () => api.get<StrategyState>("/strategy");
export const saveStrategy = (body: StrategyUpdate) => api.put<Schemas["StrategySettingsOut"]>("/strategy", body);
export const fetchBrokerPositions = () => api.get<BrokerPosition[]>("/hedge/positions");

// ── Portfolio, all from the Robinhood sync ───────────────────────────────────
export type BrokerPortfolio = Schemas["BrokerPortfolioOut"];
export type BrokerHolding = Schemas["BrokerHoldingOut"];
export type BrokerOption = Schemas["BrokerOptionOut"];
export type BrokerHistoryPoint = Schemas["BrokerHistoryPoint"];
export type BrokerIncome = Schemas["BrokerIncomeOut"];
export type BrokerActivity = Schemas["BrokerActivityOut"];

const acctQ = (account?: string | null, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra);
  if (account) q.set("account", account);
  const s = q.toString();
  return s ? `?${s}` : "";
};
export const fetchBrokerPortfolio = (account?: string | null) => api.get<BrokerPortfolio>(`/broker/portfolio${acctQ(account)}`);
export const fetchBrokerHistory = (account?: string | null, days = 365) =>
  api.get<BrokerHistoryPoint[]>(`/broker/history${acctQ(account, { days: String(days) })}`);
export const fetchBrokerIncome = (account?: string | null) => api.get<BrokerIncome>(`/broker/income${acctQ(account)}`);
export const fetchBrokerActivity = (account?: string | null, limit = 300) =>
  api.get<BrokerActivity[]>(`/broker/activity${acctQ(account, { limit: String(limit) })}`);

// ── Phone notifications (Web Push) ───────────────────────────────────────────
export type PushConfig = Schemas["PushConfigOut"];
export type PushDevice = Schemas["DeviceOut"];
export type PushTest = Schemas["TestOut"];
export const fetchPushConfig = () => api.get<PushConfig>("/notify/config");
export const fetchPushDevices = () => api.get<PushDevice[]>("/notify/devices");
export const savePushSubscription = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
  api.post<PushDevice[]>("/notify/subscriptions", sub);
export const removePushSubscription = (endpoint: string) => api.post<PushDevice[]>("/notify/unsubscribe", { endpoint });
export const sendTestPush = () => api.post<PushTest>("/notify/test");
export type NotifyPrefs = Schemas["NotifyPrefs"];
export const fetchNotifyPrefs = () => api.get<NotifyPrefs>("/notify/prefs");
export const saveNotifyPrefs = (p: NotifyPrefs) => api.put<NotifyPrefs>("/notify/prefs", p);

// ── Daily report pages (morning / evening / weekend) ─────────────────────────
export type ReportMeta = Schemas["ReportSummary"];
export type ReportPage = Schemas["ReportOut"];
/** Each report's latest page plus the days it has a page for. */
export const fetchReports = () => api.get<ReportMeta[]>("/reports");
/** One day's page (YYYY-MM-DD); without a day, the latest. */
export const fetchReport = (slug: string, day?: string | null) =>
  api.get<ReportPage>(`/reports/${encodeURIComponent(slug)}${day ? `?day=${encodeURIComponent(day)}` : ""}`);

// ── Political influence (modules/politics) ───────────────────────────────────
export type PoliticalProfile = Schemas["PoliticalProfile"];
export type PoliticalSummary = Schemas["PoliticalSummary"];
export type PoliticalFeed = Schemas["PoliticalFeed"];
export type CongressTrade = Schemas["CongressTrade"];

export const fetchPolitics = (symbol: string) =>
  api.get<PoliticalProfile>(`/politics/${encodeURIComponent(symbol.toUpperCase())}`);
export const fetchPoliticsSummary = (symbols: string[]) =>
  api.get<PoliticalSummary>(`/politics/summary?symbols=${encodeURIComponent(symbols.join(","))}`);
export const fetchPoliticsFeed = (symbols: string[] = [], days = 30) => {
  const q = new URLSearchParams({ days: String(days) });
  if (symbols.length) q.set("symbols", symbols.join(","));
  return api.get<PoliticalFeed>(`/politics/feed?${q}`);
};
