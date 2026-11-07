# AGENT_CONTEXT.md — Read this first before doing anything

This file is for any new AI agent/chat session working on this codebase.
It summarises the current state, architecture decisions, workflow rules, and what to do next.

---

## Project

**OptionFlow** — Personal finance + options trading portfolio tracker.
- Owner: Karthik Kondajji Vidyaranya (`Karthikkv12`)
- GitHub repo: `Karthikkv12/million-app` (GitHub repo name — rename optional)
- Stack: FastAPI (Python 3.11) backend · Next.js 14 (TypeScript) frontend · SQLite (5 DBs)

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `develop` | ✅ **Always work here** — ALL code changes go to `develop` |
| `main` | Production only — merge from `develop` when ready to release |

> **Never commit directly to `main`.** Always work on `develop`, then push to `develop`.
> Merge to `main` only when the user explicitly says "push to main" or "release".

---

## How to Start the App

### Backend
```bash
cd /Users/karthikkondajjividyaranya/Desktop/OptionFlow_main
source .venv/bin/activate
uvicorn backend_api.main:app --reload --port 8000
```

### Frontend
```bash
export PATH="/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin:$PATH"
cd /Users/karthikkondajjividyaranya/Desktop/OptionFlow_main/web
node node_modules/.bin/next dev --port 3000
```

### Auto-start (launchd — survives reboots)
Three launchd agents are installed and active:
- `com.optflw.fastapi` → backend on :8000
- `com.optflw.nextjs` → frontend on :3000
- `com.optflw.cloudflared` → optflw.com tunnel

To restart: `launchctl unload ~/Library/LaunchAgents/com.optflw.X.plist && launchctl load ~/Library/LaunchAgents/com.optflw.X.plist`

---

## Credentials

| Field | Value |
|-------|-------|
| Username | `karthik.kv12` |
| Password | `Karthik@123456` |
| Role | `admin` |

---

## Database Architecture (5 separate SQLite files)

| File | Domain | Key tables |
|------|--------|-----------|
| `users.db` | Auth & users | `users`, `refresh_tokens`, `revoked_tokens`, `auth_events` |
| `trades.db` | Accounts & holdings | `accounts`, `stock_holdings` |
| `portfolio.db` | Options portfolio | `option_positions`, `weekly_option_portfolio`, `premium_ledger`, `portfolio_value_history` |
| `budget.db` | Personal finance | `budget`, `budget_overrides`, `credit_card_weeks`, `cash_flow`, `ledger_*` |
| `markets.db` | Market data | `net_flow_snapshots`, `price_snapshots` |

All DB files live at `/Users/karthikkondajjividyaranya/Desktop/OptionFlow_main/*.db`.

> **Do not use the old `trading_journal.db` for anything.** It is the legacy monolithic DB; all data has been migrated.

### Session factories (use these in all new code)
```python
from database.models import (
    get_users_session, get_trades_session,
    get_portfolio_session, get_budget_session, get_markets_session,
)
# OR the engine getters:
# get_users_engine(), get_trades_engine(), get_portfolio_engine(),
# get_budget_engine(), get_markets_engine()
```

---

## Backend Architecture (`backend_api/`)

```
backend_api/
  main.py          # thin app factory — CORS, middleware, lifespan, health, /health (all 5 DBs)
  state.py         # shared GEX cache, background poller, flow-DB helpers
  utils.py         # df_records() — single canonical dict serialiser
  deps.py          # FastAPI Depends: get_current_user, require_admin
  schemas/         # Pydantic v2 models — split by domain
    __init__.py    # re-exports everything (backward compat)
    auth.py        # auth schemas
    trades.py      # account + holding schemas
    budget.py      # cash, budget, CC week schemas
    portfolio.py   # option position, weekly portfolio, snapshot schemas
  routers/
    auth.py        # /auth/* — login, refresh, sessions, change-password
    trades.py      # /accounts, /holdings  (raw trade journal removed)
    portfolio.py   # /portfolio/weeks, /portfolio/positions, /portfolio/summary
    budget.py      # /budget, /cash, /credit-card-weeks, /budget/ledger/*
    markets.py     # /stock/info, /market/quotes, /options/gamma-exposure/*
    admin.py       # /admin/users
```

**logic/ service layer (split from monolith):**
```
logic/
  auth_services.py      # auth, users, tokens, rate-limiting
  trade_services.py     # accounts, holdings (no raw trade journal)
  budget_services.py    # cash, budget, overrides, CC weeks, ledger
  portfolio_services.py # portfolio value history snapshots
  portfolio.py          # option positions, weekly portfolio, premium ledger
  holdings.py           # stock holding helpers
  gamma.py              # GEX calculations (core product)
  services.py           # thin re-export shim (backward compat)
  premium_ledger.py     # premium ledger helpers
```

**Rules:**
- Every new route goes in the correct router file, NOT in main.py
- Use `df_records()` from `backend_api.utils` — never duplicate it
- Always use `logger = logging.getLogger("optionflow.<module>")` — no `print()` for errors
- Response models: always declare `response_model=` on every route
- Use `model_validate(dict)` (Pydantic v2) not manual `Foo(field=dict["field"], ...)`
- Pagination: all list endpoints must support `limit: int = Query(50, ge=1, le=1000)` and `offset: int = Query(0, ge=0)`

---

## Frontend Architecture (`web/`)

```
web/app/(app)/
  dashboard/     # Portfolio overview + recent trades
  options-flow/  # GEX + net flow charts
  markets/       # Stock quotes + search
  trades/        # Weekly options portfolio — slim 134-line orchestrator
  budget/        # Budget tracker + credit card weeks — slim 272-line orchestrator
  settings/      # User settings
web/components/
  Navbar.tsx     # Desktop sidebar — Dashboard → Options Flow → Markets → Trades → Budget
  BottomNav.tsx  # Mobile nav — same order
  trades/        # 13 component files split from trades/page.tsx (v2.5.0)
    TradesHelpers.ts        # Types, emptyForm(), posToForm(), formatters. weekLabel() uses local-time Date constructor (year,month-1,day) to avoid UTC off-by-one "Invalid Date"
    TradeModals.tsx         # CompleteWeekModal, ReopenWeekModal
    PositionForm.tsx        # Add/edit position form
    StatusSelect.tsx        # Status dropdown
    AssignmentPanel.tsx     # Assignment/exercise panel
    PositionRow.tsx         # Mobile card + desktop row (AI streaming, live moneyness)
    PositionsTab.tsx        # Metrics grid, live quotes poll, form management
    SymbolsTab.tsx          # Symbol search + breakdown table
    YearTab.tsx             # Annual analytics, cumulative chart. Monthly premium bar chart scoped to last 12 months via .slice(-12)
    PremiumTab.tsx          # Premium ledger by-symbol and by-week
    AccountTab.tsx          # Account value tracking with charts. Account legend is a hidden "Accounts ▾" toggle panel (pill buttons). Table uses table-fixed + <colgroup> for equal-width columns
    HoldingsTab.tsx         # Holdings table with Sync/Import/Add toolbar
    PortfolioSummaryBar.tsx # 4-card summary grid + WeekSelector (year <select> dropdown + week <select w-[320px]> + New Week button in a single flex row)
  budget/        # 5 component files split from budget/page.tsx (v2.5.0)
    BudgetHelpers.ts        # Constants, formatters, monthKey/Label, recurringAppliesToMonth
    BudgetSection.tsx       # EditableRow, ReadRow, Section (override/mutation logic)
    BudgetCharts.tsx        # TrendChart, SavingsRate, TopCategoriesBar, IncomeExpenseSplit, ExpensePieChart, CashFlowWaterfall, FixedVsVariableDonut, CategoryAnnualCards
    BudgetAnnualSummary.tsx # AnnualSummary (12-month table)
    CCSection.tsx           # CCSection, StatCard, CCEditRow, CCReadRow
web/lib/
  api.ts         # All fetch calls to the backend
  auth.tsx       # Auth context — silent refresh on load, proactive refresh timer
```

**Navigation order (must be consistent):**
Dashboard → Options Flow → Markets → Trades → Budget

---

## Automated Backups

Daily cron at midnight backs up all 6 DB files to `OptionFlow_main/backups/`.
- Retention: 7 daily, 4 weekly, 12 monthly
- Script: `scripts/backup_dbs.py`
- Log: `/tmp/optionflow_backup.log`
- `backups/` is in `.gitignore` — never committed

---

## Testing

```bash
# Run all tests (except GEX integration test)
source .venv/bin/activate && python -m pytest tests/ -q --ignore=tests/test_api_gex.py

# All tests should pass: currently 428 passing, 0 failing
```

**Conftest pattern:** `tests/conftest.py` provides `db_engine_and_session` fixture.
- Creates a single `StaticPool` in-memory SQLite engine
- Creates all tables from all 5 Bases
- Monkeypatches all `get_*_engine` and `get_*_session` on both `database.models` and `logic.services`

---

## Version History (summary)

| Version | What |
|---------|------|
| v2.5.9 | PositionsTab: "This Week Premium" → "Week P&L" (net of buy-backs, subtitle shows gross − closed). Net Realized card (closed positions only). Closed thead DTE column added + bg/padding fix. YearTab: Net Realized history table (all weeks newest-first, gross/cost/net columns). `isEffectivelyComplete` fix (removed dateless third condition, `.slice(0,10)` on `week_end`). |
| v2.5.8 | UI: Week selector year redesigned as `<select>` dropdown; week dropdown widened to `w-[320px]`; `weekLabel()` fixed to local-time parsing (avoids UTC off-by-one "Invalid Date"). AccountTab: account legend replaced with hidden "Accounts ▾" toggle panel (pill buttons, strike-through for hidden, dashed for inactive); table uses `table-fixed` + `<colgroup>` for equal-width columns. YearTab: monthly premium bar chart capped to last 12 months (`.slice(-12)`). |
| v2.5.7 | Full Bug Audit Fix: 14 Bugs Across All Trades Tabs (see VERSIONS.md). |
| v2.5.6 | Holdings: soft-delete guard (lots with event history → CLOSED not destroyed), ↻ Re-enter button on closed holdings, _recalculate_adj_basis dual-path (PremiumLedger primary, HoldingEvent basis_delta fallback). Fixed SOFI/EOSE/BBAI closed adj_basis in DB. Fixed admin/users page (was 500 — mismatched service function names, wrong schema alias). Audit cleanup: JWT renamed million-* → optionflow-*, trading_journal.db removed from backup list, DEV_GUIDE wrong path fixed. |
| v2.5.5 | Performance tab: expiry-bucketed Premium by Expiry table (grouped by expiry_date, DTE colour badges, Settled dimming). New GET /portfolio/positions endpoint + fetchAllPositions(). Bug fix: ISO datetime normalisation (.slice(0,10)) for valid dates. Positions tab: live ITM Assignment Risk card (assignment value, net proceeds, per-symbol depth pills, 30s refresh). |
| v2.5.4 | Build fix: ESLint no-unused-expressions in PremiumTab (ternary→if/else); TypeScript labelFormatter type in AccountTab (string→unknown). Fixes iOS/Safari breakage from stale compiled output. |
| v2.5.3 | Budget: Income rows → Source dropdown (Salary/Stock Market), no Merchant, no Type. Type column removed from all 3 budget sections. 2-column page layout (Income+One-off left, Recurring+CC right). Robinhood Gold week cards redesign + flush stat tiles. Two new charts: CashFlowWaterfall + FixedVsVariableDonut in 50/50 row. |
| v2.5.2 | Dashboard: removed portfolio balance chart. Performance tab: 52-Friday skeleton chart, vertical x-axis labels, side-by-side accumulation+projection, streak bar sparkline, compact week-by-week rows. Budget TrendChart rewritten as AreaChart with gradient fills + Net line. |
| v2.5.1 | UI polish: recharts area+bar charts side-by-side in AccountTab (52-week scaffold, $1k Y ticks, newest-first table); Expense Mix pie redesign; dark-mode tooltip fix across all budget charts. |
| v2.5.0 | Split trades/page.tsx (3612→134 lines) into 13 components; split budget/page.tsx (1679→272 lines) into 5 components. Fixed buy_date bug in PositionForm. |
| v2.4.0 | Removed broker layer, order system, raw trade journal, dead frontend pages (orders/accounts/search/stocks). 428 passing tests. |
| v2.3.1 | Split schemas.py into domain package (auth/trades/budget/portfolio). Fixed npm PATH in dev.sh. |
| v2.3.0 | Split services.py monolith into auth_services, trade_services, budget_services, portfolio_services. /health probes all 5 DBs. Backend API improvements (GET /trades filters, PATCH/DELETE /cash, GET /budget/summary, enum validation). |
| v2.2.0 | 448 passing tests, lifespan migration, /health DB ping, field-name fixes |
| v2.1.0 | 18 audit fixes: state.py/utils.py, TTLCache, pagination, model_validate |
| v2.0.0 | Split 1735-line main.py into 6 routers |
| v1.9.0 | Split monolithic DB into 5 domain DBs |

See `VERSIONS.md` for full changelog.

---

## What Needs to Be Built Next

These are the highest-impact features in priority order:

### 🥇 1. Portfolio Value History chart
- `GET /portfolio/value-history` and `POST /portfolio/value-history` endpoints are live
- `portfolio_value_history` table exists but is empty — need UI to enter weekly net-worth snapshots
- Dashboard should render a line chart of this over time

### 🥈 2. Budget — complete CC week flow
- Credit card week tracker exists but needs a proper "settle up" weekly flow
- Enter card spend for the week → mark as paid

### 🥉 3. GEX caching / faster Options Flow load
- yfinance fetch is slow (~3–8s) on first load
- Consider persisting last GEX result to markets.db so the page loads from cache instantly
- Background refresh every N minutes via the existing poller in state.py

### 4. Alembic multi-DB migrations
- alembic/env.py supports all 5 DBs via `ALEMBIC_DB=users|trades|portfolio|budget|markets`
- No autogenerated migration files yet — run per-DB to capture current schema

---

## Known Issues / Gotchas

1. **Trades & Budget pages are split** — `trades/page.tsx` and `budget/page.tsx` are thin orchestrators. All logic lives in `web/components/trades/` (13 files) and `web/components/budget/` (5 files). Edit the component files, not the page files.
2. **`StockHolding` uses `shares` + `cost_basis`** — not `quantity`. Any new code must use the correct field names.
3. **Trades page is the weekly options portfolio** — covered calls, CSPs, option positions. There is NO raw trade journal — it was removed in v2.4.0.
4. **Node.js** is at a custom path: `/Users/karthikkondajjividyaranya/bin/node-v20.11.1-darwin-arm64/bin/`. Always set `PATH` before running npm/node commands.
5. **`.next` cache corruption** — if the frontend returns 500, `rm -rf web/.next` and restart.
6. **Zoom locked on iOS/iPadOS** — `maximumScale=1, userScalable=no` is intentional (app-like feel).
7. **schemas is a package, not a file** — `backend_api/schemas/` is a directory with `__init__.py`. Import from `backend_api.schemas` as before; do NOT create a new `schemas.py` file.
8. **brokers/ folder is gone** — broker abstraction and order system removed in v2.4.0. Do not re-add.
9. **Holdings soft-delete** — `delete_holding()` in `logic/holdings.py` soft-closes lots that have HoldingEvent history (sets status=CLOSED, shares=0) instead of hard-deleting. Only hard-deletes fresh lots with zero event history. Use the "↻ Re-enter" button in HoldingsTab to reactivate a closed lot.
10. **adj_basis = f(avg_cost)** — `_recalculate_adj_basis` uses PremiumLedger rows as primary source; falls back to summing `basis_delta` from HoldingEvents. This means editing avg_cost on any holding (active or closed) correctly recomputes adj_basis.
11. **JWT audience** — Changed from `million-app` → `optionflow-app` (issuer: `million-api` → `optionflow-api`) in v2.5.6. Existing sessions were invalidated — users must log in again after this deploy.
12. **`premium_out` is stored negative** — In `option_positions`, `premium_out` (buy-back cost) is a negative number (e.g. `-1.30` = paid $1.30). Net P&L per position = `(premium_in + premium_out) × contracts × 100`. When computing cost-to-close totals always use `Math.abs(premium_out)`; never subtract a raw `premium_out` sum (double-count bug).

---

## Key Commands Reference

```bash
# Check backend health
curl -s http://localhost:8000/health

# Login and test an endpoint
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"karthik.kv12","password":"Karthik@123456"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -s http://localhost:8000/budget -H "Authorization: Bearer $TOKEN"

# Run tests
source .venv/bin/activate && python -m pytest tests/ -q --ignore=tests/test_api_gex.py

# DB row counts
source .venv/bin/activate && python3 -c "
import sqlite3
for db in ['users.db','trades.db','portfolio.db','budget.db','markets.db']:
    conn = sqlite3.connect(db)
    cur = conn.cursor()
    cur.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")
    for (t,) in cur.fetchall():
        cur.execute(f'SELECT COUNT(*) FROM {t}')
        print(f'{db}.{t}: {cur.fetchone()[0]}')
    conn.close()
"

# Git workflow
git checkout develop           # always work here
git add -A
git commit -m "feat/fix: ..."
git push origin develop
# When releasing:
git checkout main && git merge develop && git push origin main && git checkout develop
```
