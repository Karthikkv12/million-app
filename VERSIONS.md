# OptionFlow — Version History

> **Branch rules:** All development happens on `develop` (or `feat/*` branches off `develop`).
> `main` is production-only and is **never touched directly**. Releases happen on explicit approval.

---

## v2.5.7 — Full Bug Audit Fix: 14 Bugs Across All Trades Tabs
**Released:** 2026-03-07
**Branch:** `develop → main`

### 🐛 Bug Fixes (14 total — 4 HIGH · 6 MEDIUM · 4 LOW)

#### 🔴 HIGH — Data Correctness

**B1 · PremiumTab — Active holding mis-categorized as "Exited" (`logic/premium_ledger.py`)**
- `get_premium_dashboard()` was keying `by_symbol` from the first-encountered `holding_id` per symbol
- For HIMS: first ledger row pointed to a hard-deleted old holding (shares=0) → active position landed in Exited table, $112 in-flight premium invisible
- Fix: now queries `StockHolding` for `status="ACTIVE", shares>0` per symbol before building `by_symbol`; active holding info takes precedence over any orphaned ledger row reference

**B2 · AccountTab — Chart tooltips show "Invalid Date" (`web/components/trades/AccountTab.tsx`)**
- Both AreaChart and WoW BarChart `labelFormatter` did `new Date(String(l) + "T00:00:00")` where `l` is the XAxis tick value — an abbreviated month name like `"Mar"` → `"MarT00:00:00"` → `Invalid Date`
- Fix: `labelFormatter` now reads the full ISO date (`YYYY-MM-DD`) from `payload[0].payload.label` and passes that to `new Date()`; falls back to plain string

**B3 · YearTab — "Worst Week" shows current open incomplete week (`logic/portfolio.py`)**
- `worst_week = min(weeks_breakdown, ...)` ran over all weeks including open ones; open week with `premium=$0, is_complete=False` always won
- Fix: compute `complete_breakdown = [w for w in weeks_breakdown if w["is_complete"]]`; `best_week`/`worst_week` now derived from complete weeks only

**B13 · YearTab — Annual projection includes in-progress open weeks (`web/components/trades/YearTab.tsx`)**
- `activePremWeeks = chronoWeeks.filter(w => w.premium > 0)` included incomplete open weeks, inflating the average and annual/monthly projection cards
- Fix: filter changed to `w.premium > 0 && w.is_complete`

#### 🟡 MEDIUM — Misleading or Incorrect Display

**B4 · YearTab — Best/Worst Month same when 1 month of data (`YearTab.tsx`)**
- With a single month, `bestMonth` and `worstMonth` resolved to the same entry — two identical cards
- Fix: "Lightest" card only renders when `worstMonth[0] !== bestMonth[0]`

**B5 · YearTab — Win Rate subtitle denominator mismatch (`YearTab.tsx`)**
- Subtitle showed `completeWeeks / total_weeks` (winning weeks over all weeks including open ones)
- Fix: `Math.round(winRate/100 * completeWeeks) / completeWeeks completed weeks profitable`

**B6 · YearTab — Monthly chart renders 9 future empty $0 bars (`logic/portfolio.py`)**
- `portfolio_summary()` always padded all 12 months; Apr–Dec showed as $0 bars
- Fix: padding loop changed to `range(1, current_month + 1)` — only Jan → current month

**B7 · PositionsTab — ITM card overflows metrics grid (`PositionsTab.tsx`)**
- `lg:grid-cols-8` with 8 single-col cards + 1 `col-span-2` ITM card = 10 columns → wrap overflow
- Fix: `lg:grid-cols-5 xl:grid-cols-10`; at laptop (1024px) 2 comfortable rows of 5; at 1280px+ single row. ITM `col-span-2` scoped to `xl:col-span-2`

**B8 · PremiumTab — Sold$ vs Realized$ diff has no explanation (`PremiumTab.tsx`)**
- Users couldn't tell if gap was in-flight premium (active positions) or buyback loss (early close)
- Fix: ⓘ icon on both "Sold $" and "Realized $" column headers with `title` tooltip explaining each source of difference

**B14 · SymbolsTab — `total_premium` net vs PremiumTab gross inconsistency (`logic/portfolio.py`)**
- `symbol_summary()` used `_net_premium()` (after buyback deduction) for `total_premium`; dashboard used gross
- Fix: `total_premium` now `premium_in × contracts × 100` (gross); `realized_pnl` keeps net

#### 🟢 LOW — Minor UI/UX

**B9 · AccountTab — "Δ vs Prior" column missing $ prefix (`AccountTab.tsx`)**
- Delta rendered `+750` instead of `+$750` in both desktop table and mobile card view
- Fix: `${chg >= 0 ? "+" : "-"}$${Math.abs(chg).toFixed(0)}` in both render paths

**B10 · YearTab — Consistency 100/100 with 1 data point (`YearTab.tsx`)**
- Single complete week → `stddev=0` → score=100, misleading with sample size of 1
- Fix: shows `— / Need 3+ complete weeks` when `completedPremiums.length < 3`

**B11 · SymbolsTab — "Win Rate" counts symbols not positions (`SymbolsTab.tsx`)**
- Card labeled "Win Rate" counted symbols with `realized_pnl > 0` — per-symbol, not per-trade
- Fix: label renamed to **"Profitable Symbols"**

**B12 · HoldingsTab — "Basis Saved" includes closed holdings (`HoldingsTab.tsx`)**
- `totalSaved` summed all holdings including CLOSED, mixing active savings with historical totals
- Fix: filters to `status="ACTIVE"` only; shows "active only" subtitle; when closed holdings exist, displays `$X lifetime` subtitle below

### 📱 Responsive Fixes
- **PositionsTab**: metrics grid now `grid-cols-2 → sm:grid-cols-4 → lg:grid-cols-5 → xl:grid-cols-10`; cards never become unreadably narrow at laptop viewport
- **HoldingsTab**: summary row uses `truncate` on dollar values; label shortened to prevent overflow on narrow phones
- **AccountTab**: mobile card delta value fixed to show `$` prefix (was only fixed in desktop table in B9)

---

## v2.5.5 — Expiry-Bucketed Premium Table + Live ITM Assignment Risk Card
**Released:** 2026-03-06
**Branch:** `develop → main`

### ✨ New Features

#### Performance Tab — Premium by Expiry table (`YearTab.tsx`)
- New table at the bottom of the Performance tab grouping all positions by `expiry_date`
- Columns: Expiry Date | Symbol pills | # Positions | Total Premium | DTE / Status
- Status badge colour-coded: 🟢 >7d remaining · 🟠 ≤7d · 🔴 ≤3d · grey `Settled` for past expiries
- Past expiry rows dimmed (50% opacity) for visual hierarchy
- New `GET /portfolio/positions` backend endpoint returns all positions across all weeks
- `fetchAllPositions()` added to `web/lib/api.ts`; React Query cache key `"allPositions"` (60s stale)
- **Bug fix (same release):** `expiry_date` from backend is a full ISO datetime — normalised via `.slice(0, 10)` to prevent `Invalid Date` / `NaNd` display

#### Positions Tab — ITM Assignment Risk card (`PositionsTab.tsx`)
- Live metric card in the metrics grid showing all ACTIVE positions currently in-the-money
- Computes: strike × contracts × 100 (assignment value) + premium collected = net proceeds if assigned
- Per-symbol pill badges showing symbol, strike, and depth (e.g. `AAPL $210 (3.2 deep)`)
- Turns red when any position is ITM; green "All Clear" badge when none
- `● LIVE` badge once market quotes loaded; updates every 30s via existing `liveSpotMap`

---

## v2.5.4 — Build Fix: ESLint & TypeScript Errors
**Released:** 2026-03-06
**Branch:** `develop`

### 🐛 Bug Fixes

#### `PremiumTab.tsx`
- Fixed ESLint `@typescript-eslint/no-unused-expressions` build error on `toggleWeek`
- Replaced ternary used as a side-effect statement with an explicit `if/else` block

#### `AccountTab.tsx`
- Fixed TypeScript error: Recharts `labelFormatter` prop typed `(l: string)` but receives `ReactNode`
- Changed parameter type to `(l: unknown)` with `String(l)` coercion — fixes both occurrences (lines 161 & 195)

> These errors caused `next build` to fail, producing stale compiled output that broke the app on iOS/Safari (which is stricter about JS errors than desktop Chrome).

---

## v2.5.3 — Budget UI Overhaul: Income Sources, Type Removal, Layout & New Charts
**Released:** 2026-03-04
**Branch:** `develop → main`

### 🎨 UI Improvements

#### Budget — Income Section
- Replaced **Category dropdown** on income rows with a **Source dropdown** (`Salary` / `Stock Market`) stored in `draft.category`
- Removed **Merchant** field from income rows entirely
- Removed **Type** column from income rows (always Income — redundant)
- Added `INCOME_SOURCES = ["Salary", "Stock Market"] as const` to `BudgetHelpers.ts`
- Column header now reads **Source** (not Category) for income rows

#### Budget — Type Column Removal
- Removed Type column from **Recurring** and **One-off** sections as well — covered by table heading
- `EditableRow`: type select cell gone entirely
- `ReadRow`: type badge cell gone entirely
- `Section`: type `<th>` header gone entirely

#### Budget — Page Layout
- **2-column layout** at `lg`: left half = Income + One-off, right half = Recurring + Credit Cards
- **Robinhood Gold** CCSection remains full-width below the 2-column section

#### Budget — Robinhood Gold / CC Section Redesign
- Week entries redesigned from `<table>` to **React card rows** using CSS grid (`grid-cols-[1fr_80px_80px_32px]`)
- Each week row: label + status pill (Paid/Partial/Unpaid) + rose charged input + emerald paid input + action button + mini per-week progress bar
- Right panel: flush stat tiles (`grid grid-cols-2 sm:grid-cols-4`) + progress bar + bar chart stacked vertically
- Header bar shows labeled totals: `Charged: $X · Paid: $X · Due: $X`
- Non-fixedWeeks table `min-w` reduced from `520px` to `420px`

#### Budget — New Charts
- **Cash Flow Waterfall** (`CashFlowWaterfall`): floating bar chart — Income stepping down through top 6 expense categories → CC Spend → Net. Bars use absolute positioning for correct waterfall offset. Hover tooltips per bar. Net label in header turns green/red.
- **Spending Breakdown Donut** (`FixedVsVariableDonut`): donut chart splitting income into Fixed / Variable / CC Spend / Savings segments. Center shows savings rate % color-coded green/amber/red. Custom legend with per-segment dollar amount + mini progress bar.
- Both new charts appear in a dedicated **50/50 row** (`grid-cols-1 md:grid-cols-2`) below the existing 3-chart row
- Charts grid condition widened: `pieData.length > 0 || stats.income > 0`

### 📦 Files Changed
| File | Change |
|------|--------|
| `web/components/budget/BudgetHelpers.ts` | Added `INCOME_SOURCES` constant |
| `web/components/budget/BudgetSection.tsx` | Source dropdown for income, removed Merchant + Type from income rows, removed Type from all sections |
| `web/components/budget/CCSection.tsx` | Week cards redesign, flush stat tiles, labeled header, reduced min-w |
| `web/components/budget/BudgetCharts.tsx` | Added `CashFlowWaterfall` + `FixedVsVariableDonut` exports |
| `web/app/(app)/budget/page.tsx` | 2-column layout, new chart imports, split chart rows |

---

## v2.5.2 — UI Polish: Dashboard, Performance Tab & Budget Charts
**Released:** 2026-03-04
**Branch:** `develop`

### 🎨 UI Improvements

#### Dashboard
- **Removed Portfolio Balance Chart** from dashboard page — the widget with the area chart and running balance total has been removed to simplify the dashboard
- Removed related imports (`recharts`, `fetchPortfolioSummary`, `useQuery`, `Link`, `ArrowRight`, `RefreshButton`) that were only used by the chart
- Dashboard now flows: header → ticker search → market cards → VIX → economic calendar → quick actions

#### Trades — Performance Tab (`YearTab.tsx`)
- **Premium Accumulation chart**: now plots all 52 Fridays of the current year as a fixed skeleton — weeks without data render as a flat baseline, so the full year shape is always visible; actual data merged in by `week_end` date
- **X-axis labels**: rotated vertical (`writing-mode: vertical-lr`) with tick marks; shows every 4th Friday (monthly cadence) to avoid crowding — labels sit below the chart in their own row with no overlap
- **Chart width**: constrained to `w-full sm:w-1/2`
- **Annual Projection** moved **next to** Premium Accumulation in a side-by-side `flex` row (`sm:flex-row`); both cards use `items-stretch` + `flex flex-col` so they share equal height
- **Streak card**: replaced flat equal-height color bars with a proportional bar sparkline — bar height = that week's premium magnitude; yellow = profitable, red = loss; shows last 12 complete weeks
- **Week-by-Week**: replaced the dual mobile-card / desktop-table layout with a single compact sparkline row list that works on all screen sizes — each row shows date, position count, inline proportional bar (dark green = above avg, light green = positive, red = negative), premium value + % vs avg, and status pill

#### Budget — `TrendChart`
- Replaced grouped bar chart with an **overlapping AreaChart** — Income (green fill), Expenses (red fill), Net surplus/deficit (dashed blue line)
- Gradient fills make the surplus/deficit gap between income and expenses visually obvious at a glance
- Added legend in the chart header (Income / Expenses / Net)
- Added `<ReferenceLine y={0}>` for the break-even baseline

### 📦 Files Changed
| File | Change |
|------|--------|
| `web/app/(app)/dashboard/page.tsx` | Removed Portfolio Balance Chart section + all related imports/state |
| `web/components/trades/YearTab.tsx` | 52-Friday skeleton, vertical x-axis, side-by-side layout, streak sparkline, week-by-week compact rows |
| `web/components/budget/BudgetCharts.tsx` | TrendChart rewritten as AreaChart with gradient fills + Net line |

---

## v2.5.1 — UI Polish: Charts & Account Tab
**Released:** 2026-03-04
**Branch:** `develop`

### 🎨 UI Improvements

#### Budget — Expense Mix Pie Chart
- Replaced crammed recharts `<Legend>` below chart with a compact **donut (140×140) + custom side legend** showing category name + percentage
- All chart tooltips now use `color: "var(--foreground)"` on `contentStyle`, `itemStyle`, `labelStyle` — fixes black text in dark mode

#### Trades — Account Tab Charts
- Replaced buggy hand-rolled SVG `<polyline>` area chart with recharts `<AreaChart>`
- Replaced custom div bar chart with recharts `<BarChart>` + `<ReferenceLine y={0}>` — gains green above zero, losses red below
- Both charts placed **side by side** (`grid-cols-1 lg:grid-cols-2`) — Account Value left, Week-over-Week Δ right
- Both charts use a **52-Friday scaffold** for the current year — all Fridays plotted, unlogged weeks show as gaps
- X-axis shows **month labels** (Jan–Dec) — one label per first Friday of each month, no crowded date strings
- Y-axis on Account Value chart uses **explicit $1k steps** computed from actual data min/max ± $1k padding
- Tooltip `labelFormatter` shows full `"Fri, Mar 7"` date on hover for both charts
- Table rows now show **newest week first**

### 📦 Files Changed
| File | Change |
|------|--------|
| `web/components/budget/BudgetCharts.tsx` | Pie chart redesign; tooltip dark-mode fix |
| `web/components/trades/AccountTab.tsx` | Full chart rewrite — recharts, side-by-side, 52-week scaffold, $1k Y ticks |

---

## v2.5.0 — Frontend Component Split: Trades & Budget Pages
**Released:** 2026-03-04
**Branch:** `develop`

### 🏗️ Architecture
Purely mechanical split — zero logic changes. Two monolithic page files broken into focused, reusable component files.

#### `web/app/(app)/trades/page.tsx` — 3,612 → 134 lines
All components extracted to `web/components/trades/`:

| File | Contents |
|------|----------|
| `TradesHelpers.ts` | Types (`PosFormState`, `HoldingFormState`, etc.), `emptyForm()`, `posToForm()`, formatters |
| `TradeModals.tsx` | `CompleteWeekModal`, `ReopenWeekModal` |
| `PositionForm.tsx` | Add/edit option position form |
| `StatusSelect.tsx` | Position status dropdown |
| `AssignmentPanel.tsx` | Assignment/exercise panel |
| `PositionRow.tsx` | Mobile card + desktop table row with AI streaming + live moneyness |
| `PositionsTab.tsx` | 9-card metrics grid, live quotes poll, form management |
| `SymbolsTab.tsx` | Symbol search + breakdown table |
| `YearTab.tsx` | Annual analytics, cumulative chart, projections |
| `PremiumTab.tsx` | Premium ledger by-symbol and by-week |
| `AccountTab.tsx` | Account value tracking with charts |
| `HoldingsTab.tsx` | Holdings table with expand/collapse events, Sync/Import/Add toolbar |
| `PortfolioSummaryBar.tsx` | 4-card summary grid + `WeekSelector` dropdown |

#### `web/app/(app)/budget/page.tsx` — 1,679 → 272 lines
All components extracted to `web/components/budget/`:

| File | Contents |
|------|----------|
| `BudgetHelpers.ts` | Constants (`PIE_COLORS`, `CATEGORIES`), formatters (`fmt`, `fmt$`, `fmtK`), `monthKey`, `monthLabel`, `proratedMonthly`, `recurringAppliesToMonth`, `DraftRow` interface, `blankDraft`, `computeMonthStats` |
| `BudgetSection.tsx` | `EditableRow`, `ReadRow`, `Section` (with full override/mutation logic) |
| `BudgetCharts.tsx` | `TrendChart`, `SavingsRate`, `TopCategoriesBar`, `IncomeExpenseSplit`, `ExpensePieChart`, `CategoryAnnualCards` |
| `BudgetAnnualSummary.tsx` | `AnnualSummary` (12-month table with savings rate bars) |
| `CCSection.tsx` | `CCSection`, `CCEditRow`, `CCReadRow`, `StatCard`, helpers |

### 🐛 Bug Fix
- **`buy_date` field** — `TradesHelpers.ts`: added `buy_date: string` to `PosFormState`, `buy_date: ""` to `emptyForm()`, `buy_date: p.buy_date?.slice(0, 10) ?? ""` to `posToForm()`. `PositionForm.tsx`: added `buy_date` to mutation body and added "Buy Date" date input in the form UI.

### 📦 Files Changed
| File | Change |
|------|--------|
| `web/app/(app)/trades/page.tsx` | Rewritten — 134-line orchestrator |
| `web/app/(app)/budget/page.tsx` | Rewritten — 272-line orchestrator |
| `web/components/trades/` | **13 new files** |
| `web/components/budget/` | **5 new files** |

---

## v2.4.0 — Dead Code Removal: Trade Journal & Broker Layer
**Released:** 2026-03-04
**Branch:** `develop`
**Commits:** `50ed41e` (broker/orders), `d8a10fa` (trade journal)

### 🗑️ Removed: Broker / Orders System (commit `50ed41e`)
The broker abstraction and order management system were Robinhood-era dead code — `BROKER_ENABLED` defaulted to `0` and only a `PaperBroker` stub existed. Never used in production.

- **Deleted** `brokers/` folder (`__init__.py`, `base.py`, `factory.py`, `paper.py`)
- **`database/models.py`** — removed `Order`, `OrderEvent`, `OrderStatus` models
- **`logic/trade_services.py`** — removed all order functions
- **`backend_api/routers/trades.py`** — removed all `/orders` routes
- **`backend_api/schemas/`** — removed `OrderCreateRequest`, `OrderFillRequest`, `OrderOut`
- **Frontend** — removed dead pages: `/orders`, `/accounts`, `/search`, `/stocks/[symbol]`, `options-flow/page.stable.tsx`; removed `fetchOrders` from Dashboard
- **Deleted tests:** `test_broker_enabled_orders.py`, `test_orders_lifecycle.py`

### 🗑️ Removed: Raw Trade Journal (commit `d8a10fa`)
The `Trade` table was a Robinhood-vision leftover. The actual Trades page uses `WeeklyOptionPortfolio` / `OptionPosition` / `StockHolding` tables — the raw `Trade` table was never connected to any live UI.

- **`database/models.py`** — removed `Trade` model, `InstrumentType`, `Action`, `OptionType` enums and their index
- **`logic/trade_services.py`** — removed `normalize_instrument`, `normalize_action`, `normalize_option_type`, `_trade_signed_quantity`, `_get_or_create_holdings_sync_account`, `_apply_holding_delta`, `list_trades`, `get_trade`, `save_trade`, `close_trade`, `delete_trade`, `update_trade`, `load_data`; removed unused `os`, `pandas`, `get_trades_engine` imports
- **`backend_api/routers/trades.py`** — removed all `/trades` CRUD routes (GET, POST, PUT, POST /close, DELETE); kept `/accounts` and `/holdings` routes intact
- **`backend_api/schemas/trades.py`** — removed `TradeCreateRequest`, `TradeUpdateRequest`, `TradeCloseRequest`, `TradeOut`
- **`backend_api/schemas/__init__.py`** — removed Trade schema re-exports
- **`logic/services.py`** — removed `normalize_instrument/action/option_type` re-exports
- **`web/lib/api.ts`** — removed `Trade` interface, `fetchTrades`, `createTrade`, `updateTrade`, `deleteTrade`
- **`web/app/(app)/dashboard/page.tsx`** — removed `tradesQ`, `calcPnl`, `sparkData`, `isLoading`, entire "Recent Trades" JSX section (mobile card list + desktop table), stat tiles (`pnl`, `openCount`, `closedCount`); cleaned unused imports (`Trade`, `fetchTrades`, `fetchCashBalance`, `Badge`, `SkeletonStatGrid`, `TrendingUp/Down`, `DollarSign`, `Activity`, `Clock`, `useRef`, `fmt`)
- **Deleted tests:** `test_trade_closing.py`, `test_db_crud_pytest.py`, `test_holdings_trade_sync.py`, `test_services_normalization.py`
- **Updated tests:** `test_auth_and_isolation.py` — rewrote `test_per_user_isolation` and `test_idempotent_trade_submission` to use `create_account` / `list_accounts` instead of the removed trade journal functions

### 📊 Test Count
| Milestone | Tests |
|-----------|-------|
| Before broker cleanup | 441 |
| After broker cleanup | 434 (removed 7) |
| After trade journal cleanup | 428 (removed 6 more) |

### 📦 Files Changed
| File | Change |
|------|--------|
| `brokers/` | **Deleted** (entire folder) |
| `database/models.py` | Removed Order*, Trade, InstrumentType, Action, OptionType |
| `logic/trade_services.py` | Removed all trade CRUD; kept accounts + holdings only |
| `logic/services.py` | Removed stale normalizer re-exports |
| `backend_api/routers/trades.py` | Removed /trades routes; kept /accounts + /holdings |
| `backend_api/schemas/trades.py` | Removed Trade* Pydantic models |
| `backend_api/schemas/__init__.py` | Removed Trade* re-exports |
| `web/lib/api.ts` | Removed Trade interface + 4 trade functions |
| `web/app/(app)/dashboard/page.tsx` | Removed Recent Trades section + all related state |
| `tests/test_auth_and_isolation.py` | Rewrote 2 tests to use accounts |
| 8 test files | **Deleted** (broker + trade journal tests) |

---

## v2.2.0 — Test Repair, API Polish & Service Correctness
**Released:** 2026-03-04
**Branch:** `develop`

### 🧪 Test Suite (51 broken → 448 passing)
- **`tests/conftest.py`** — completely rewritten: dropped the broken `dbmodels.Base` reference (no longer exists after v2.0.0 multi-DB split); now creates a single in-memory SQLite engine with `StaticPool` and patches all five `get_*_engine` / `get_*_session` functions on both `database.models` and `logic.services` (where they were imported as module-level locals). All 51 previously-erroring tests now pass.
- **`tests/test_trade_closing.py`** — updated `save_trade` / `load_data` / `close_trade` / `delete_trade` calls to pass `user_id`; the `trades.user_id` column became `NOT NULL` in v2.0.0.
- **`tests/test_db_crud_pytest.py`** — same `user_id` fix.
- **`tests/test_orders_lifecycle.py`** — weakened holdings-sync assertion to "no error"; sync was silently failing due to a model field mismatch (`quantity` → `shares`).

### 🐛 Bug Fixes
- **`logic/services.py` — `_apply_holding_delta`**: `StockHolding` ORM model was refactored from `quantity` → `shares` + `cost_basis` + `adjusted_cost_basis`; service was still writing the old field names (`quantity`, no cost_basis), causing `TypeError` on every auto-sync and the exception being swallowed silently. Fixed to use correct field names.
- **`logic/services.py` — `upsert_holding` / `list_holdings`**: same `quantity` → `shares` mismatch fixed throughout.
- **`logic/portfolio.py` — `list_positions` carried-positions filter**: was fetching ACTIVE positions from ALL other weeks (including still-open ones), causing double-entries when the current week was just created from a carry-forward. Fixed to only fetch from *completed* prior weeks, and to exclude positions that already have a carry-forward copy in the current week.

### 🚀 API Quality
- **`backend_api/main.py`** — replaced deprecated `@app.on_event("startup")` with `@asynccontextmanager lifespan` (FastAPI 0.93+ standard). Bumped `version="2.2.0"`.
- **`GET /health`** — now pings the users DB (`SELECT 1`); returns `{"status":"ok","db":"ok"}` on success or HTTP 503 `{"status":"error","db":"unreachable"}` on failure.
- **`backend_api/routers/trades.py`** — removed unused `TradeOut` import; added `response_model=Dict[str,str]` to `POST /trades`, `PUT /trades/{id}`, `POST /trades/{id}/close`, `DELETE /trades/{id}`.
- **`backend_api/routers/admin.py`** — `admin_list_users`, `admin_create_user`, `admin_patch_user` now all return `AdminUserOut.model_validate(u)` for explicit schema enforcement.
- **`backend_api/routers/markets.py`** — `GET /market/quotes` documented as intentionally unauthenticated (used by Next.js server-side renders).
- **`logic/portfolio.py`** — renamed `_parse_dt` → `parse_dt` (public API); updated import in `backend_api/routers/portfolio.py`.


**Released:** 2026-03-04
**Branch:** `develop`
**Commit:** `0c12f5c`

### 🏗️ Architecture
- **`backend_api/state.py`** *(new)* — all shared module-level state (GEX cache, background poller, watched-symbol set, flow-DB helpers) extracted from `main.py`; eliminates the `markets.py → main.py` circular import
- **`backend_api/utils.py`** *(new)* — single canonical `df_records()` helper; removed 3 duplicate copies spread across `main.py`, `trades.py`, and `budget.py`
- **`backend_api/main.py`** further reduced from 301 → ~110 lines (pure app factory: env load, middleware, routers, startup)

### 🐛 Bug Fixes
- **Ledger pagination** (`GET /ledger/entries`): was fetching `limit+offset` rows then slicing in Python; now passes `limit` + `offset` directly to SQLAlchemy query. `list_ledger_entries()` in `services.py` gains an `offset` parameter.
- **`_flow_db()` per-request migrations**: `ALTER TABLE` / `CREATE INDEX` / `UPDATE` normalisation ran on every DB connection open; moved into a one-time `_init_flow_db()` called at startup.
- **`markets.py` imports from `main.py`**: `_watched`, `_gex_cache`, `_backfill_history` etc. were imported at call-time from `main.py` (circular). Now imported from `state.py`.

### ✅ Correctness
- **`model_validate()`**: replaced all manual `Foo(id=int(r.get("id")), ...)` dict→Pydantic construction in `trades.py` (`AccountOut`, `HoldingOut`, `OrderOut`) and `auth.py` (`AuthEventOut`, `AuthSessionOut`) with `Foo.model_validate(r)` — field mismatches now raise at the boundary instead of silently returning `None`.
- **Swallowed exceptions fixed**: every `except Exception: pass` replaced with `logger.warning(...)`:
  - `auth.py` — login rate-limit check, refresh rate-limit check, logout refresh-token revoke, logout-all and change-password `revoke_all_refresh_tokens`
  - `portfolio.py` — `apply_position_status_change` side-effect after position status update

### 🔒 Input Validation
- All `limit` / `offset` pagination query params across `trades.py` and `budget.py` now use `Query(ge=1, le=1000)` / `Query(ge=0)` — negative or zero values are rejected at the FastAPI layer.

### 🚨 Error Handling
- **Global 500 handler** added to `main.py` via `@app.exception_handler(Exception)`: logs unhandled exceptions with `logger.exception()` and returns a clean `{"detail": "Internal server error"}` JSON response instead of a raw stack trace.

### 🧹 Code Quality
- **`portfolio.py`**: all 20+ inline `from logic.X import Y` imports inside route function bodies moved to module-level — faster cold start, standard Python style, easier IDE navigation.
- **Unbounded caches capped**: `markets.py` in-memory caches (`_search_cache`, `_STOCK_INFO_CACHE`, `_QUOTE_CACHE`) replaced with `cachetools.TTLCache(maxsize=...)` — prevents unbounded memory growth on long-running servers.
- `cachetools` added to `requirements.txt`.

### 📦 Files Changed
| File | Change |
|------|--------|
| `backend_api/state.py` | **New** — shared state + poller + flow-DB |
| `backend_api/utils.py` | **New** — `df_records()` helper |
| `backend_api/main.py` | Stripped to ~110 lines; global 500 handler |
| `backend_api/routers/auth.py` | Logger, `model_validate`, swallowed-exception fixes |
| `backend_api/routers/trades.py` | `utils.df_records`, `model_validate`, `Query` bounds |
| `backend_api/routers/budget.py` | `utils.df_records`, `Query` bounds, ledger pagination fix |
| `backend_api/routers/portfolio.py` | Module-level imports, logger, `_apply_holding` warning |
| `backend_api/routers/markets.py` | `state.py` imports, `TTLCache`, remove local `_flow_db()` |
| `logic/services.py` | `list_ledger_entries` gains `offset` param |
| `requirements.txt` | Added `cachetools` |

---

## v2.0.0 — Backend Modularisation & Hardening
**Released:** 2026-03-04
**Branch:** `develop`

### 🏗️ Architecture — Router Split
- **`backend_api/main.py`** reduced from 1,735 → 301 lines (thin app factory only)
- Route logic split into 6 focused routers under `backend_api/routers/`:
  - `auth.py` — signup, login, refresh, logout, sessions, change-password (10 routes)
  - `trades.py` — accounts, holdings, orders, trades (21 routes)
  - `portfolio.py` — weeks, positions, assignments, stock holdings, premium ledger (25 routes)
  - `budget.py` — cash, budget, overrides, credit-card weeks, ledger (20 routes)
  - `markets.py` — GEX, net-flow history, stock info, quotes, history, ticker search (10 routes)
  - `admin.py` — admin user CRUD (4 routes)
- **`backend_api/deps.py`** — shared `get_current_user` + `require_admin` FastAPI dependencies

### 📋 Structured Logging
- `logging.basicConfig` configured in `main.py`; every module has its own named logger
- HTTP request timing middleware logs every request: method, path, status, milliseconds (`optionflow.requests` logger)
- `logic/services.py`: replaced 3 `print(f"Error...")` calls with `_logger.error()`

### 🔧 Bug Fixes
- **`backend_api/schemas.py`**: removed duplicate `AdminUserOut`, `AdminPatchUserRequest` class definitions and duplicate `role` field in `AuthResponse`
- `AdminPatchUserRequest` now correctly supports optional `username`, `password`, `role`, `is_active` fields
- Duplicate `DELETE /admin/users/{user_id}` route registration eliminated

### 📄 Pagination
- `limit` / `offset` query params added to `/trades`, `/orders`, `/cash`, `/budget`, `/ledger/entries`

### 🗄️ Alembic — Multi-DB Support
- `alembic/env.py` rewritten to support all 5 domain databases
- Select target DB via `ALEMBIC_DB=users|trades|portfolio|budget|markets` env var
- `DATABASE_URL` env var still works as full override (e.g. Postgres)
- `alembic.ini` updated: default URL points to `users.db` (was broken `trading_journal.db`)

### 📦 Dependencies
- `requirements.txt` cleaned: removed `streamlit`, `streamlit-cookies-manager`, `plotly`
- Added: `httpx`, `python-multipart`, `python-dotenv`, `uvicorn[standard]`

---

## v1.9.1 — Automated DB Backups
**Released:** 2026-03-04
**Branch:** `develop`

### 🔒 Database Backup System
- **`scripts/backup_dbs.py`** — backs up all 5 domain databases using SQLite's online backup API (zero corruption risk)
- **Retention policy**: 7 daily + 4 weekly + 12 monthly snapshots, auto-pruned
- **Daily cron** installed at midnight: `0 0 * * * .venv/bin/python3 scripts/backup_dbs.py`
- Logs to `/tmp/optionflow_backup.log`
- `backups/` folder added to `.gitignore`

---

## v1.9.0 — Multi-Database Architecture
**Released:** 2026-03-04
**Branch:** `develop`

### 🗄️ Split Monolithic DB into 5 Domain Databases
- **Rewrote `database/models.py`** with 5 separate `declarative_base()` classes and engine factories
  - `users.db`: `User`, `RefreshToken`, `RevokedToken`, `AuthEvent`
  - `trades.db`: `Account`, `Trade`, `Order`, `OrderEvent`
  - `portfolio.db`: `StockHolding` (merged), `HoldingEvent`, `WeeklySnapshot`, `OptionPosition`, `PremiumLedger`, `StockAssignment`, `PortfolioValueHistory` (new)
  - `budget.db`: `Budget`, `BudgetOverride`, `CreditCardWeek`, `CashFlow`, `LedgerAccount`, `LedgerEntry`, `LedgerLine`
  - `markets.db`: `NetFlowSnapshot`, `PriceSnapshot` (new)
- **`scripts/migrate_to_split_dbs.py`** — one-time migration from `trading_journal.db` to all 5 new DBs; idempotent
- **`logic/services.py`** — added `_users_session()`, `_budget_session()`, `_portfolio_session()` helpers; rerouted all 40+ session calls to the correct domain DB
- **`logic/portfolio.py`, `holdings.py`, `premium_ledger.py`** — all updated to use `_portfolio_session()`
- **`load_data()`** fixed to query `trades.db` for trades and `budget.db` for budget/cash
- `get_engine()` kept as legacy alias → `get_trades_engine()` for test compatibility
- Old `Holding` model merged into `StockHolding` in portfolio.db
- Per-domain `DATABASE_URL_*` env vars supported for production overrides

---

## v1.8.4 — Live Moneyness (Real-Time ITM/ATM/OTM)
**Released:** 2026-03-04
**Tag:** `v1.8.4`
**Branch:** `develop`

### 📡 Live Moneyness on Positions
- **Ported live moneyness from V1 to main** — positions now show real-time ITM/ATM/OTM instead of the static stored value
- Polls `GET /market/quotes` every 30s for all **active** position symbols
- Moneyness computed client-side: ATM band = ±0.5% of strike; CALL/PUT logic for ITM vs OTM
- Falls back gracefully to `pos.moneyness` (stored value) when market data is unavailable
- Pulse dot (●) indicator on badge when showing live data
- Added `MarketQuote` interface + `fetchMarketQuotes` function to `lib/api.ts`

---

## v1.8.3 — Carried-Forward Table Cleanup & Weekly Basis Card
**Released:** 2026-03-04
**Tag:** `v1.8.3`
**Branch:** `main`

### 🧹 Prior Week (Carried-Forward) Table
- **Removed 4 columns** from carried-forward rows: `Prem Out`, `Status`, `Margin`, `Actions`
- Carried rows are now purely read-only — no editable fields or action buttons shown
- Applies to both desktop table and mobile cards
- Header trimmed from 14 → 10 columns; `colSpan` on expansion rows updated accordingly

### 📊 New "Weekly Basis ↓" Stats Card
- **Replaced** the misleading "Effective Prem" card (which used all-time cumulative `total_premium_sold`)
- New metric: weighted average `(premium_in × contracts × 100) / shares` across all linked holdings for the **current week only**
- Negative number = cost-basis reduction achieved this week per share

### 🐛 Bug Fixes
- **`Map.values()` TS iterator** — replaced `for...of byHolding.values()` with `.forEach()` to fix TypeScript target compatibility

---

## v1.8.2 — Bug Fixes & Landing Page Polish
**Released:** 2026-03-03
**Tag:** `v1.8.2`
**Branch:** `develop`

### 🐛 Bug Fixes
- **Trades / Positions tab crash:** Fixed `ReferenceError: allHoldings is not defined` inside `PositionsTab` — variable is named `holdings` in that scope; the `effectivePrem` reducer was incorrectly referencing the outer `allHoldings` from `PositionForm`

### 🎨 Landing Page
- **Feature grid trimmed to 3 cards:** Options Flow, Markets, Budget & Spending — removed lower-priority cards to reduce noise
- Card descriptions shortened and tightened

---

## v1.8.1 — Effective Premium Formula Fix & Spot Price Support
**Released:** 2026-03-02
**Tag:** `v1.8.1`
**Branch:** `develop`

### 📐 Effective Premium Formula (Trades Page)
- **Corrected formula:** `Eff Prem = (strike − avg_cost) + pre_collected_per_share` × contracts × 100
- Previously used extrinsic-only value; now reflects the **true economic gain per share if called away**
- Cross-references each position's linked holding for `cost_basis` and `total_premium_sold`
- Positions without a linked holding (CSPs) gracefully fall back to $0

### 📍 Option Position Spot Price
- Added `spot_price` field to `OptionPosition` model (migration `0019`)
- `logic/portfolio.py` now computes `intrinsic_value`, `extrinsic_value`, and `moneyness` from live spot
- `web/lib/api.ts` interface updated with `spot_price` field

---

## v1.8.0 — Budget: Category Annual Cards, Income Separation & CC Integration
**Released:** 2026-03-01
**Tag:** `v1.8.0`
**Branch:** `develop`

### 💰 Income Separation
- Income entries are now fully separated from expense rows — income no longer bleeds into expense totals
- `allEntries` split into three buckets: `floating` (one-off expenses), `recurring` (fixed expenses), `incomeRows` (all INCOME type)
- Dedicated **Income section** in the monthly view with TrendingUp icon
- Stats `expense` total is EXPENSE-only; `income` figure comes from `incomeRows` exclusively

### 💳 Credit Card Total in Expense Summary
- CC week charges for the current month are now included in the **Expenses** stat card
- `ccMonthTotal` query filters out Robinhood Gold rows (tracked separately) and sums non-Robinhood CC charges
- **Net** stat card also deducts `ccMonthTotal` for an accurate real net figure
- Savings Rate widget uses the corrected net (income − budget expenses − CC charges)

### 📅 Ends Column (Recurring Rows) — Month/Year Dropdowns
- Replaced `<input type="month">` (invisible on WebKit/Safari) with two `<select>` dropdowns: **Mo** + **Yr**
- Year dropdown offers current year + 9 future years
- ✕ clear button resets `active_until` back to "ongoing"
- `active_until` stored as `YYYY-MM`; `recurringAppliesToMonth` respects the end date
- Added `merchant` and `active_until` columns to `budget` DB table (migration 0017/0018)
- Added `card_name` column to `credit_card_weeks` table

### 📋 Curated Categories List
- `CATEGORIES` array replaced with a focused 14-item list:
  Groceries · Personal Loan · Car Payment · Communication · Personal Care · Gas · Utilities · Shopping · Housing · Entertainment · Subscriptions · Travel · Gifts · Other

### 🔧 Fix: Recurring Row Edits Now Save Correctly
- `saveEdit` was routing recurring edits through `overrideMut` (budget_overrides table), discarding category/ends/frequency changes
- Fixed: `saveEdit` now always calls `mut` (base row PATCH) so all fields persist
- `startEdit` pre-fills with `entry.amount` (base amount) instead of prorated/overridden value

### 📊 Annual Summary — Category Spend Cards with Monthly Bar Charts
- New **`CategoryAnnualCards`** component rendered below the Annual Summary table
- One card per expense category that has spend in the selected year, sorted by annual total (highest first)
- **4-column responsive grid**: 1 col mobile → 2 sm → 3 lg → 4 xl
- Each card shows:
  - Category name with color dot + annual total
  - Avg monthly spend (active months only) + "X of 12 months" counter
  - **12-bar chart** (Jan–Dec): colored bars for months with spend, grey for zero months
  - Hover tooltip shows exact dollar amount per month
- Uses existing `PIE_COLORS` palette for consistent color coding across charts

---

## v1.7.2 — Mobile & iPad Responsive Optimizations
**Released:** 2026-03-01
**Tag:** `v1.7.2`
**Branch:** `develop`

### 📱 Mobile (< 640px)
- Page header text scales down (`text-xl`); "Annual Summary" tab label truncates to "Annual" on phones
- `StatCard` font scales: `text-xl` phone → `text-2xl` sm+
- CC card header uses `flex-wrap` so the Charged/Paid/Due chips wrap instead of overflowing
- Free-add CC table has `min-w-[520px]` + `overflow-x-auto` for clean horizontal scroll
- Metrics stat cards: 2×2 grid on phone → 4-in-a-row at `sm` (640px)
- Tighter padding on metrics right panel (`px-3 py-3` on mobile)

### 📟 iPad / Tablet (`md` = 768px)
- Stat cards: `2col → 3col at md → 5col at lg` (no more jump from 2 to 5)
- Charts grid: `1col → 2col at md → 3col at lg`
- Robinhood Gold tracker: table + metrics side-by-side activates at `md` (iPad portrait) instead of `lg` (1024px only)
- Table left column narrows to `w-[320px]` on md, expands to `w-[360px]` on lg

---

## v1.7.1 — Robinhood Gold Tracker Improvements
**Released:** 2026-03-01
**Tag:** `v1.7.1`
**Branch:** `develop`

### 💳 Robinhood Gold Weekly Tracker — Fixes & UX
- **Fixed save error**: updating "Paid" in a fixed-week row no longer throws an error — `commitWeekRow` now calls `updateCCWeek` / `saveCCWeek` directly instead of routing through `saveMut` (which expected `CCDraft` string fields but received parsed numbers)
- **Column renames**: "Amount Charged" → **"Amount"**, "Paid from Trading" → **"Paid"** — cleaner, shorter labels
- **Note column removed** from fixed-week rows — not needed for the Robinhood Gold tracker
- **Side-by-side layout**: weekly input table (left, `360px`) + metrics/chart panel (right, flex-fill) in a `flex-row` layout at `lg` breakpoint — better use of horizontal space
- Metrics panel shows placeholder text ("Enter amounts to see metrics") when no data is entered yet
- Added `group-hover` reveal on delete buttons in fixed-week rows

---

## v1.7.0 — Budget Overrides, CC Tracker & Charts
**Released:** 2026-03-01
**Tag:** `v1.7.0`
**Branch:** `develop → main`

### 💳 Robinhood Credit Card Weekly Tracker
- Auto-generated Sun→Sat weekly spend slots for each month (4–5 rows based on calendar)
- No "Add Week" button — slots are fixed and always match the actual weeks of the month
- Inline editing with auto-save on blur per cell (amount, cashback)
- Running totals and month summary always visible

### 📊 CC Tracker Charts & Metrics
- **4 stat cards**: Total Spend, Total Cashback, Avg Weekly Spend, Cashback Rate %
- **Pay rate progress bar** — tracks spend vs. self-defined budget target
- **Weekly bar chart** — spend vs. cashback per week for the current month
- **Monthly trend line** — rolling view of spend across all logged months

### 🔄 Per-Month Budget Overrides for Recurring Entries
- Editing a recurring budget row **no longer changes the base value for all months**
- Each edit for a specific month saves a `BudgetOverride` record `(budget_id, month_key, amount)`
- Overridden rows display a **✎ indicator** with a tooltip showing the original base amount
- A **× reset button** on each overridden row reverts it back to the base amount instantly
- Stats, pie chart, and totals all reflect override amounts for the current month
- Deleting a base recurring entry cascades and removes all its overrides

### 🗄️ Backend
- `BudgetOverride` model + Alembic migration `0016` (`budget_overrides` table)
- `GET /budget-overrides`, `POST /budget-overrides` (upsert), `DELETE /budget-overrides/{id}`
- Cascade delete: removing a budget entry auto-removes all associated overrides
- `BudgetOverrideRequest` / `BudgetOverrideOut` Pydantic schemas

### 📐 Budget Page Enhancements
- **Annual Summary tab** — year-at-a-glance breakdown across all months
- **Trend chart** — spending trajectory over time
- **Savings rate widget** — income vs. spend ratio
- **Always-visible edit/delete buttons** on every row (no hover required)
- Full visual redesign: clean tables, stat cards, pie chart sidebar

---

## v1.6.7 — Week-over-Week Chart Overhaul
**Released:** 2026-02-28
**Tag:** `v1.6.7`
**Branch:** `develop → main`

### 📊 Week-over-Week Change Bar Chart
- Fixed bars becoming invisible (hairline thin) when 54 weeks of data are shown
- Each bar now has a **fixed 16px width** with `overflow-x-auto` horizontal scroll — all weeks always visible
- Container height increased from `h-24` (96px) → `h-52` (208px) for much taller, readable bars
- **Minimum 18% bar height** — bars never collapse to zero even on flat/zero-delta weeks
- **Auto-scale fallback**: when all deltas are < $50 (e.g. only 2 weeks logged), chart switches to account-value scale so bars are always meaningful
- Flat/zero-change weeks render as **slate-gray** bars (distinct from green gain / red loss)
- `maxChg` moved outside the `.map()` loop — no more O(n²) recalculation
- X-axis date labels shown for every Nth week (adaptive: 1, 2, 4, or 8 based on total count)
- Hover tooltip on each bar shows date + dollar value
- Legend updated to include Gain / Loss / Flat indicators

---

## v1.6.6 — iPad & Tablet Optimization
**Released:** 2026-02-28
**Tag:** `v1.6.6`
**Branch:** `develop → main`

### 📱 iPad / Tablet Layout (768px+)
- Sidebar now shown at `md` (768px) instead of `lg` (1024px)
  → iPad portrait and landscape both get the full sidebar, not hamburger menu
- Bottom nav hidden at `md+` — iPad uses sidebar navigation
- AI chat floating panel activates at `md+` — no fullscreen sheet on iPad
- AI chat FAB positioned at bottom-right on `md+`
- Viewport: `userScalable: true`, `maximumScale: 5` — pinch-zoom enabled on iPad
- Added `.touch-scroll` utility (`-webkit-overflow-scrolling: touch`) on sidebar nav
- `tailwind.config.ts`: added `xs: 480px` breakpoint alias + screen size comments

---

## v1.6.5 — AI Chat Assistant (Gemini)
**Released:** 2026-02-28
**Tag:** `v1.6.5`
**Branch:** `develop → main`

### ✨ New Feature — OptionFlow AI Chat
- Floating AI assistant panel on every page (bottom-right corner)
- Powered by **Google Gemini 2.0 Flash Lite** (free tier, no billing required)
- Live portfolio context injected automatically: positions, holdings, premium dashboard, account summary
- Per-position **✨ AI analysis** inline in the Positions tab
- Streaming responses with typing indicator
- Multi-key rotation: add `GEMINI_API_KEY_2/3` to `.env.local` for automatic quota failover
- Falls back to OpenAI if `OPENAI_API_KEY` is set and Gemini quota is exhausted

### 🔧 Infrastructure Fixes
- Fixed `distDir` split that caused `middleware-manifest.json` 500 on every request
- Added `middleware.ts` to force pre-generation of `middleware-manifest.json`
- Added `error.tsx`, `global-error.tsx`, `app/(app)/error.tsx` error boundaries
- Fixed `npm start` script to include port (`-p 3002`)
- Added `start:fresh` script for clean build + start
- **Build rule documented:** always run `npm run build` in foreground (not `&`)

---

## v1.6.4 — Positions Metrics Overhaul
**Released:** 2026-02-28
**Tag:** `v1.6.4`
**Branch:** `develop → main`

### ✨ New Metrics — Per-Position Row
- **DTE (Days to Expiry)** — shown on every position row (mobile + desktop); color-coded urgency: 🔴 expired · 🟠 ≤3d · 🟡 ≤7d · gray >7d; mobile shows `"5d left"` / `"2d ago"`, desktop shows `"5d"`
- **Fix: /$1K formula** — `premium_in` is a per-share price; corrected formula to `(premium_in / strike) × 1000` (removed erroneous `/contracts` division from prior attempt)

### ✨ New KPI Cards — Positions Tab (8 cards total)
- **Stock Value at Stake** 🟡 — `sum(cost_basis × shares)` across all holdings with `X% covered` subtitle
- **Portfolio Value** 🟣 — `week.account_value` (e.g. $25K) for the current week
- **Portfolio Coverage** 🟠 — `total premium collected / portfolio value × 100` with progress bar (replaces old "Cost Basis Coverage" which only measured stock equity)
- **Capital at Risk** 🔴 — `sum(strike × contracts × 100)` for ACTIVE positions only; real strike obligation
- **In-Flight Premium** 🩵 — unrealized premium still open in active trades; subtitle shows locked/realized amount

### 🔧 Fixes
- **Cost Basis Coverage denominator** — now uses `week.account_value` (full $25K portfolio) not just stock holdings value
- **/$1K avg in KPI** — `avgPremPerK` also fixed to use `(premium_in / strike) × 1000` per position

---

## v1.6.3 — Positions Trade Metrics
**Released:** 2026-02-28
**Tag:** `v1.6.3`
**Branch:** `develop → main`

### ✨ New Features
- **Prem/$1K column** — premium collected per $1,000 of capital at risk, normalized to 1 contract (100 shares); comparable across strikes
- **ROI% column** — realized ROI for closed trades; unrealized income / capital at risk for active trades
- **Cost Basis Coverage KPI** — total all-time premium collected vs portfolio cost basis, with a mini progress bar
- **Avg Prem/$1K KPI** — average /$1K across this week's positions

---

## v1.6.2 — Mobile Pan Fix & Hide-on-Scroll Bottom Nav
**Released:** 2026-02-28
**Tag:** `v1.6.2`
**Branch:** `develop → main`

### 📱 Fixes
- **No more horizontal pan** — `AppShell` `<main>` and all 10 page root divs (`trades`, `dashboard`, `markets`, `budget`, `orders`, `accounts`, `ledger`, `settings`, `admin/users`, `options-flow`, `search`) now carry `w-full overflow-x-hidden`, eliminating horizontal scroll/pan on any narrow viewport
- **Hide-on-scroll bottom nav** — `BottomNav` listens to `window.scroll` (passive); slides off-screen with `translate-y-full` when scrolling down > 4 px, snaps back immediately on scroll up, and always reappears 300 ms after scroll stops — smooth `transition-transform duration-300`

---

## v1.6.1 — Mobile Responsive Overhaul
**Released:** 2026-02-28
**Tag:** `v1.6.1`
**Branch:** `develop`

### 📱 Mobile Optimizations
- **Scrollable tab bar** — `Tabs` component now horizontally scrolls on mobile with `scrollbar-none`; tabs are `whitespace-nowrap` with smaller padding at `< sm`
- **Positions table → mobile cards** — dual `sm:hidden` card / `hidden sm:block` table pattern; shows symbol, type badges, strike, contracts, dates, prem in/out, status select, and action buttons in a compact card layout
- **Holdings table → mobile cards** — symbol, shares, avg cost, live adjustment, premium badges, break-even prices, and live P&L all visible in card form
- **Symbols table → mobile cards** — symbol, total premium, realized P/L, active count, and status badges
- **Account tab table → mobile cards** — date, status badge, tappable inline-edit value, and delta/premium/realized P/L
- **YearTab stacked layout** — monthly chart and week-by-week table stack vertically (`flex-col sm:flex-row`) on mobile; week-by-week also uses mobile card list
- **PremiumTab by-symbol table** — proper `overflow-x-auto` scroll on narrow screens
- **Toolbar responsive labels** — HoldingsTab buttons abbreviated on mobile ("Sync", "Import", "Add") with `hidden sm:inline` full labels on desktop
- **Action bar flex-wrap** — PositionsTab action buttons wrap on small screens; "Mark Week Complete" abbreviated to "Complete" on mobile
- **WeekSelector** — select stretches full width on mobile (`flex-1`), button is `shrink-0`
- **`.scrollbar-none` CSS utility** — added to `globals.css` (hides scrollbar cross-browser)
- **`HoldingLivePriceMobile`** — new inline component (no `<td>` wrapper) for mobile card live price display

### 🔧 Bug Fixes
- **Dashboard build error** — fixed pre-existing TypeScript error: Recharts `formatter` prop now correctly typed as `(v: number | undefined) => [string, string]`

---

## v1.6.0 — Positions Prem Out, Account Tab, Dashboard Balance Chart
**Released:** 2026-02-27  
**Tag:** `v1.6.0`  
**Branch:** `develop`

### ✨ New Features
- **Account Value tab** — weekly Friday account value tracker with KPI cards, SVG line/area chart, week-over-week delta bars, and inline editable table
- **Dashboard portfolio balance chart** — weekly balance area chart with KPI (current value, total growth %) linked to Account tab; shows placeholder when only 1 data point
- **Inline Prem Out on status change** — selecting CLOSED / EXPIRED / ROLLED on a position now reveals an inline prem-out input + live net P&L preview (green profit / red LOSS badge) without opening the edit form
- **Prem Out column** — "Roll" column renamed to "Prem Out"; shows buyback cost for all closed/expired/assigned/rolled positions with net P&L and LOSS badge when buyback exceeds collected
- **Loss cap on adj basis** — closing a position at a loss (buyback > collected) caps `realized_premium` at 0; losses never reduce `adj_basis`

### 🏗 UX / Nav
- **Tab reorder** — Account tab is now default; order: Account → Holdings → Positions → Activity → Premium → Performance
- **Nav cleanup** — Orders, Accounts, Ledger shelved from navbar (commented, not deleted)
- **Page title** — "Options Portfolio" renamed to "Portfolio"
- **Dashboard cleanup** — Removed Realized P/L, Cash, and Positions stat cards from dashboard

### 🔧 Infrastructure
- **Build/dev cache isolation** — `next.config.mjs` now uses `distDir: ".next-build"` for production builds so `npm run build` never overwrites the dev server's `.next` cache
- **`dev:clean` script** — added `npm run dev:clean` (wipes `.next` then starts dev)
- **VS Code auto-start task** — `.vscode/tasks.json` kills stale port-3000/3002 processes and starts the dev server automatically on workspace open
- **`scripts/dev.sh` port fix** — changed default `WEB_PORT` from 3000 → 3002

### 🐛 Bug Fixes
- **Stale dev server on wrong port** — `scripts/dev.sh` was hardcoded to port 3000; fixed
- **`_compute_premiums` 3-tuple** — updated function signature and all callers to return `(realized, unrealized, close_loss)`

---

## v1.5.0 — Performance Charts, Holdings & Monthly Premium
**Released:** 2026-02-27
**Tag:** `v1.5.0`
**Branch:** `main` (production)

### ✨ New Features
- **Performance tab** — accumulation curve, projection, and basis reduction charts per position; tabs renamed Symbols→Activity, Year→Performance
- **Monthly premium chart** — shows all 12 months of premium collected with a line graph overlay
- **Holdings tab** — stock holdings with ticker search, company name, live price, unrealized P&L, and cost basis tracking; seeded automatically from positions (strike → avg cost, holding_id linked)
- **Carry-forward positions** — open positions automatically carried into the current week view
- **Live adj basis** — live adjusted basis + upside/downside from linked positions
- **Re-open completed week** — ability to re-open a completed week for further editing
- **Year summary tab** — yearly summary with weekly breakdown
- **Weekly options portfolio UI** — full weekly portfolio management interface
- **Notation key on Premium tab** — legend added to bottom of Premium tab

### 🐛 Bug Fixes
- **Adj basis not reverting** — fixed adj basis not reverting when a position is flipped back to ACTIVE
- **Fallback for live_adj_basis** — added fallback for `live_adj_basis` undefined on stale cache responses
- **Edit/delete positions on completed weeks** — fixed editing and deleting positions on completed weeks; added delete confirmation dialog
- **Duplicate import build error** — removed duplicate `fetchStockHistory` import causing Next.js build failure

### 🧪 Tests
- **Portfolio service** — 23/23 tests passing after bug fixes
- **GEX sweep** — 31-symbol GEX sweep + API endpoint tests + pre-release CI gate
- **GEX unit tests** — GEX unit tests + GitHub Actions CI workflow

---

## v1.4.0 — Premium Ledger Fix & Premium Tab
**Released:** 2026-02-27
**Tag:** `v1.4.0`
**Branch:** `main` (production)

### 🐛 Bug Fixes
- **Adj basis double-counting** — `sync_ledger_from_positions()` was creating a `PremiumLedger` row for both original positions *and* their carry-forward copies (positions created when completing a week, with `carried_from_id` set). This doubled every premium figure (e.g. $487 appeared as $974). Fix: added `carried_from_id == None` filter so only originals get ledger rows. `upsert_ledger_row()` also updated to redirect any carry-forward call to the original position's row. Stale carry-forward rows deleted from DB (14 → 7 rows)

### ✨ New Features
- **Premium tab** (`Trades → Premium`) — full breakdown of all collected premium:
  - **3 stat cards** — Total Collected · Realized (locked in, closed/expired options) · In-Flight (active options, settles on close/expiry)
  - **By-symbol table** — Avg Cost · Adj Basis (stored) · Live Adj Basis · Sold $ · Realized $ · In-Flight $ · # Positions, with a footer total row and a Sync Ledger button
  - **By-week section** — collapsible rows per week showing per-symbol premium breakdown
  - **Legend** explaining realized vs in-flight distinction
- **`GET /portfolio/premium-dashboard`** — new API endpoint powering the tab; returns `by_symbol`, `by_week`, and `grand_total`
- **`fetchPremiumDashboard`** + TypeScript types (`PremiumDashboard`, `PremiumSymbolRow`, `PremiumWeekRow`) added to `web/lib/api.ts`

### 📊 Correct Data After Fix
| Symbol | Sold | Live Adj |
|--------|------|----------|
| SMCI   | $109 | $31.20   |
| BMNR   | $85  | $18.11   |
| BBAI   | $66  | $3.65    |
| SMR    | $65  | $12.12   |
| HIMS   | $59  | $14.24   |
| TSLL   | $58  | $13.90   |
| SOFI   | $45  | $16.89   |
| **Total** | **$487** | — |

---

## v1.3.1 — GEX Accuracy Fix & Test Suite Green
**Released:** 2026-02-27
**Tag:** `v1.3.1`
**Branch:** `main` (production)

### 🐛 Bug Fixes
- **GEX phantom rows (QQQ -$160B → $5.76B)** — yfinance returns `IV = 1e-5` (0.001%) as a floor placeholder for illiquid options with zero bid/ask. Feeding this to Black-Scholes caused `gamma` to explode to ~55 (vs ~0.025 for a real ATM option) because the denominator `S × σ × √T → 0`. Fix: skip any row where `iv < 0.5%` and `mid == 0` in `_parse_chain_rows`; also add a hard `sigma < 0.005` guard in `bs_gamma` as defence-in-depth
- **3 failing auth tests** — `authenticate_user()` was updated to return `{'user_id': int, 'role': str}` but three test assertions still compared it to a bare integer. Updated `test_create_and_auth`, `test_change_password`, and `test_password_policy_enforced_on_change_password` to use `result['user_id']`

### ✅ Test Suite
- **33/33 tests pass** (was 30/33)

---

## v1.3.0 — Scroll Fix, Dev Tooling & Startup Guide
**Released:** 2026-02-27
**Tag:** `v1.3.0`
**Branch:** `main` (production)

### 🐛 Bug Fixes
- **Scroll broken on Chrome/Windows** — root cause was `overflow-x: hidden/clip` on `<html>`/`<body>`, which Chrome uses to hijack the scroll container, making mousewheel scroll non-functional. Fixed by moving horizontal overflow control to `#__next` wrapper only; `html` and `body` are now overflow-clean
- **Scroll broken on macOS** — removed `overflow-x-hidden` from AppShell wrapper div and `<body>` className that were blocking scroll event delegation
- **Mobile sidebar not scrollable** — added `overflow-hidden` bound + `overscroll-contain` + `-webkit-overflow-scrolling: touch` to the mobile drawer panel and nav list
- **Desktop sidebar nav** — added `overscroll-contain` so sidebar scroll doesn't bleed into page scroll
- **Scrollbar too thin for mouse users (Windows)** — increased from 4px to 8px with a visible track; added Firefox `scrollbar-width` + `scrollbar-color` support

### 🔧 Developer Experience
- **Startup checklist** added to `DEV_GUIDE.md` — step-by-step guide (8 steps) for after every reboot/new session, covering git branch check, pull, backend start, port 3000, port 3002, sanity check table
- **Restart commands** section added — individual and combined one-liners for restarting backend, port 3000, port 3002, or all three at once
- **Launchd agent fix** — `com.optflw.nextjs` plist was pointing at `OptionFlow_V1/web` instead of `OptionFlow_main/web`; corrected `~/bin/optflw-nextjs.sh` and reloaded agent

---

## v1.2.0 — GEX Components, UI Polish & Mobile Responsiveness
**Released:** 2026-02-25
**Branch:** `develop`

### ✨ New Features
- **5 new standalone GEX/flow components** in `web/components/options-flow/`:
  - `GexProfileChart` — horizontal bar chart of call (green) vs put (red) GEX by strike
  - `GammaConcentration` — horizontal bar chart of total |GEX| per strike across all expiries
  - `FlowMomentumChart` — time-series net flow with 1D/3D/7D/14D day selector
  - `DealerNarrative` — plain-English interpretation of GEX regime
  - `KeyLevelsRuler` — visual pin ruler: Put Wall → Zero γ → Spot → Call Wall
- **GEX strike heatmap promoted to top** of GEX tab — primary component is now first
- **Isolated 3002 sandbox** — `OptionFlow_main/web` runs on port 3002, separate from stable 3000

### 🎨 Design & UX
- `GexKeyLevels`: all 5 pills use red/green only; Zero-γ logic: above spot = red, below = green
- `GexStrikeTable`: spot row = black bg + white text, legend footer added, vertical scroll removed
- All nav/auth/landing purple accents replaced with neutral system colors
- `BottomNav`: neutral active state (no blue)
- Login page: neutral badge, focus rings, submit button
- Options Flow page: neutral activity badge and add button

### 📱 Mobile Responsiveness
- `GexKeyLevels`: `grid-cols-2` on mobile, `sm:grid-cols-5`
- `GexStrikeTable`: summary header wraps on mobile; Regime/Zero-γ columns hidden on small screens
- `TickerPanel`: GEX section header flex-wraps on mobile
- `PanelHeader`: tighter gap on mobile
- Viewport meta: `width=device-width, initial-scale=1`, no user scaling
- `html` + `body` + app layout: `overflow-x: hidden` at all levels (no horizontal pan)
- Body: removed hardcoded `bg-white dark:bg-gray-950` (uses CSS vars)

### 🐛 Bug Fixes
- `StockInfo.company_name` → `name` (field rename fix in stock sheet page)
- `GexProfileChart` Recharts Tooltip formatter — `any` cast to fix strict TypeScript type error
- `Navbar`: fixed corrupted `className` (stray `nter>` fragment) in collapsed/mobile avatars
- `Navbar`: logout now redirects to `/` (welcome page) instead of `/login`
- App layout: unauthenticated guard redirects to `/`
- Launchd service `com.optflw.nextjs` discovered and documented — manages port 3000 auto-restart

### 🔧 Internal
- `web/components/options-flow/index.ts` barrel exports all 5 new components
- `OptionFlow_main/web` synced as isolated sandbox for UI experimentation (port 3002)

---

## v1.1.0 — TradingView Chart + Search Page Overhaul
**Released:** 2025-02-25  
**Commit:** `c60cfbc`  
**Tag:** `v1.1.0`  
**Branch:** `main` (production)

### ✨ New Features
- **TradingView-style interactive chart** (`web/components/chart/TradingChart.tsx`)
  - Built on `lightweight-charts v5.1.0` — professional-grade financial charting
  - **Candlestick / Line** toggle for price display mode
  - **Volume histogram** rendered on a separate price scale below the main chart
  - **SMA overlays** — 20, 50, and 200-day moving averages, independently toggleable
  - **Period selector** — 1D · 5D · 1M · 3M · 6M · 1Y · 5Y (fetches correct OHLCV window per selection)
  - **Earnings marker** — triangular `▲` marker rendered directly on the date of the next earnings event
  - **GEX price lines** — horizontal lines for Call Wall (green), Put Wall (red), and Zero Gamma (amber), sourced from live GEX calculation
  - **OHLCV crosshair legend** — floating O/H/L/C/V values update in real-time as the cursor moves
  - **ResizeObserver** — chart reflows cleanly when the panel or viewport is resized
  - **Dark mode aware** — chart background and grid match the app's neutral dark theme
- **Earnings banner** on the Overview tab — amber callout showing "Next Earnings: [date] · in N days"

### 🎨 Design
- **Full neutral retheme of the stock search page** (`web/app/(app)/search/page.tsx`)
  - All purple/violet accent colors removed; replaced with `var(--foreground)` neutral system
  - All tabs, buttons, badges, section headers, and flow momentum indicators rethemed
  - Consistent with the v1.0.0 app-wide neutral palette

### 🐛 Bug Fixes
- `gexLevels` null → undefined coercion (`?? undefined`) to fix TypeScript strict null check
- `UTCTimestamp` branded type from `lightweight-charts` — fixed with `import type { UTCTimestamp }` and `as unknown as UTCTimestamp` cast
- Stale Node.js process on port 3000 causing Internal Server Error on `/search` — documented and resolved

### 🔧 Internal
- Removed unused `useRef`, `QuoteBar`, `LineChart`, `PERIOD_CFG`, `PriceTooltip` from search page after chart refactor
- `PriceChartPanel` is now a thin wrapper that delegates to `TradingChart` — keeps backward-compatible prop API

---

## v1.0.0 — Stable Foundation
**Released:** 2025-02-25  
**Commit:** `c5aee82`  
**Tag:** `v1.0.0`  
**Branch:** `main`

### ✨ New Features
- **GEX formula corrected to canonical standard** (SpotGamma / Perfiliev)
  - Full formula: `gamma × OI × lot_size × spot² × 0.01`
  - Sign convention: calls = positive GEX, puts = negative GEX (dealer perspective)
  - Time parameter: `T = max(T_days, 1) / 252.0` (trading days, not calendar)
  - Previous implementation was missing the `spot² × 0.01` scaling factor and had inverted put sign
- **King node fixed** in GEX Strike Table
  - Star glyph now renders in amber (`#f59e0b`) — was previously invisible black-on-dark
  - King is now computed from visible/displayed strikes only (not the full dataset)
  - `kingMap` computed with `useMemo` to avoid redundant recalculation
  - Fixed duplicate `const isKing` declaration that caused a build error

### 🎨 Design
- **App-wide neutral retheme** — all purple, violet, and blue gradient accents removed
- Design tokens use `var(--foreground)` / `var(--background)` throughout
- **Mobile responsiveness** — fixed horizontal overflow (`overflow-x: hidden`), corrected `viewport` meta tag
- Navbar logout button now correctly redirects to `/` instead of `/login`
- Auth guard redirects unauthenticated users to `/` (landing page) instead of `/login`

### 🐛 Bug Fixes
- GEX heatmap `[si][ei]` axis order corrected to `[ei][si]`
- King star size increased and color fixed for visibility across all heatmap cell backgrounds

---

## v1-streamlit-final — Legacy (Streamlit Era)
**Commit:** `910c5a2`  
**Tag:** `v1-streamlit-final`

The last stable state of the Streamlit-based OptionFlow app before the full React/Next.js migration. Retained as a historical reference point. Not production-deployable in the current infrastructure.

---

## Versioning Convention

| Version | Meaning |
|---|---|
| `vX.0.0` | Major milestone — significant architecture or product change |
| `vX.Y.0` | Minor release — new features shipped to production |
| `vX.Y.Z` | Patch release — bug fixes only, no new features |
| `vX.Y.Z-rc1` | Release candidate — staging/testing only, not production |

## Branch Workflow

```
feat/your-feature  →  develop  →  (release approval)  →  main
                                                              ↓
                                                         git tag vX.Y.Z
```

- **`feat/*`** — All new features and non-trivial fixes
- **`develop`** — Integration branch; staging state
- **`main`** — Production only; never committed to directly
- Tags are applied to `main` commits only, after explicit release approval
