# OptionFlow — Version History

> **Branch rules:** All development happens on `develop` (or `feat/*` branches off `develop`).  
> `main` is production-only and is **never touched directly**. Releases happen on explicit approval.

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
