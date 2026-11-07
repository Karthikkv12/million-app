# OptionFlow — Consolidated Bug List
*Generated after full audit of all Trades tabs + testuser (user_id=3) data seed*
*Last updated: 2026-03-07*

---

## Test Seed

| Field | Value |
|---|---|
| username | `testuser` |
| password | `Test1234!` |
| user_id | 3 |
| script | `scripts/seed_test_user.py` |
| audit | `scripts/audit_testuser.py` |

---

## 🔴 HIGH — Data Correctness

### B1 · PremiumTab — Active holding mis-categorized as "Exited"
**Tab:** PremiumTab  
**Status:** In production data (user_id=1 HIMS). Not reproducible with testuser (requires hard-deleted holding).

**Root cause:** `get_premium_dashboard()` builds `by_symbol` keyed by `symbol` string, then for each symbol uses the **first encountered `holding_id`** to look up `shares`. For HIMS, the first encountered `holding_id=4` belongs to a hard-deleted old holding (reconstructed via `HoldingEvent` descriptions → `shares=0`). The active new holding (`id=13`, 100 shares) is never consulted. `shares=0` → row lands in `exitedRows` table instead of `activeRows`.  

**Effect:** HIMS active position's `$112 in-flight` is invisible in the Active table; HIMS is excluded from the "Premium per Share" bar chart.  

**Fix location:** `logic/premium_ledger.py` — join to `StockHolding` table instead of using first-seen `holding_id`; use the holding with `status="ACTIVE"` and `shares > 0` for that symbol.

---

### B3 · YearTab — "Worst Week" shows current open (incomplete) week
**Tab:** YearTab  
**Status:** ✅ Confirmed with testuser data

**Root cause:** `portfolio_summary()` computes `worst_week = min(weeks_breakdown, key=lambda x: x["premium"])` over **all** weeks, including open/incomplete ones. The current open week (no positions yet) has `premium=$0, is_complete=False` and always wins as "worst".  

**Observed:** `worst_week = 2026-03-20 (is_complete=False, premium=$0)` instead of `2026-01-16 (is_complete=True, premium=$0)`.  

**Fix location:** `logic/portfolio.py` line ~874 — filter to `[w for w in weeks_breakdown if w["is_complete"]]` before min/max.

---

### B13 · YearTab — Annual projection includes in-progress (open) weeks
**Tab:** YearTab  
**Status:** ✅ Confirmed with testuser data (NEW bug found during audit)

**Root cause:** `YearTab.tsx` computes `avgWeeklyPremium` from `activePremWeeks = chronoWeeks.filter(w => w.premium > 0)`. This filter does **not** exclude incomplete weeks — any open week with partially-collected premium (e.g., a position sold mid-week) inflates the average.  

**Observed:** Open week Mar 13 (premium=$200, is_complete=False) is included → avg=$338.90/wk instead of $354.33/wk without it. Annual projection = $17,622 vs correct $18,425.  

**Effect:** Annual and monthly projection cards are inaccurate — they over-count by mixing complete + in-progress data.  

**Fix location:** `web/components/trades/YearTab.tsx` — change `activePremWeeks` filter to `w.premium > 0 && w.is_complete`.

---

## 🟡 MEDIUM — Misleading or Incorrect Display

### B2 · AccountTab — Chart tooltips show "Invalid Date"
**Tab:** AccountTab  
**Status:** Structural (confirmed by code inspection)

**Root cause:** `XAxis dataKey="tick"` where tick values are abbreviated month names like `"Mar"`, `"Apr"`. The custom tooltip's `labelFormatter` does `new Date(String(l) + "T00:00:00")` → `"MarT00:00:00"` → `Invalid Date`.  

**Effect:** Both the Area chart (account value history) and the WoW BarChart display `"Invalid Date"` in all tooltip headers.  

**Fix location:** `web/components/trades/AccountTab.tsx` — `labelFormatter` should format `l` directly as a string instead of constructing a `Date` object.

---

### B4 · YearTab — Best/Worst Month same month when insufficient data
**Tab:** YearTab  
**Status:** ✅ Fixed by testuser seed (Jan=$1,698 best, Feb=$725 worst — distinct months)  
*Was a bug with single-month data; testuser data resolves it correctly.*

**Root cause:** With only 1 month of data, `bestMonth` and `worstMonth` both resolve to the same entry since `worstMonth` filters `e[1] > 0` but there's only one qualifying entry.  

**Fix location:** `web/components/trades/YearTab.tsx` — guard: if `bestMonth === worstMonth` (same key), render "Only 1 month of data" or hide the "Lightest" card.

---

### B5 · YearTab — Win Rate subtitle denominator mismatch
**Tab:** YearTab  
**Status:** ✅ Backend correctly returns `complete_weeks=10`, `win_rate=90.0%`

**Root cause:** In the prior audit, the subtitle showed `"1/3 weeks profitable"` mixing `winning_weeks/total_weeks` instead of `winning_weeks/complete_weeks`. With testuser data: win_rate=90% = 9/10 complete weeks. Needs frontend validation.  

**Fix location:** `web/components/trades/YearTab.tsx` — win rate subtitle should read `"9/10 completed weeks profitable"` using `complete_weeks`, not `total_weeks`.

---

### B6 · YearTab — Monthly premium chart renders 9 future empty bars
**Tab:** YearTab  
**Status:** ✅ Confirmed with testuser data (Apr–Dec all $0)

**Root cause:** `portfolio_summary()` always populates all 12 months of the current calendar year: `for _m in range(1, 13): monthly_premium[f"{year}-{m:02d}"] = 0.0 if missing`. The chart renders all 12 bars, so Apr–Dec show as flat $0 bars cluttering the chart.  

**Fix location:** `logic/portfolio.py` — only pad months up to the current month, not all 12. Or filter in `YearTab.tsx`: `monthlyEntries2.filter(([k, v]) => v > 0 || k <= currentMonthKey)`.

---

### B7 · PositionsTab — ITM card overflows `lg:grid-cols-8` grid
**Tab:** PositionsTab  
**Status:** Structural (confirmed by code inspection)

**Root cause:** The current-week metric cards grid uses `lg:grid-cols-8`. There are 8 single-column cards plus 1 `col-span-2` "ITM Risk" card = 10 columns total in an 8-column grid → the ITM card wraps to a new row, creating a blank partial row.  

**Fix location:** `web/components/trades/PositionsTab.tsx` — either change to `lg:grid-cols-10`, reduce to 7 single-column cards, or make the grid auto-fit.

---

### B8 · PremiumTab — "Sold $" vs "Realized $" difference has no inline explanation
**Tab:** PremiumTab  
**Status:** ✅ Confirmed with testuser data (NVDA: sold=$1075, realized=$817, diff=$258)

**Note after audit:** The diff is caused by two distinct things:
1. **In-flight (unrealized) premium** — active positions whose premium hasn't closed yet (majority)
2. **Buyback debit** — positions closed early with a buy-to-close order (premium_out set)

**Root cause:** Both in-flight and buyback costs appear as "Sold > Realized" with no distinction. Users can't tell if $258 difference is unrealized in-flight (good, pending) or buyback loss (bad, paid to close). No inline tooltip explains the breakdown.  

**Fix location:** `web/components/trades/PremiumTab.tsx` — add tooltip/info icon inline on the "Sold $" and "Realized $" columns clarifying the two sources of difference.

---

### B14 · SymbolsTab — `total_premium` is net (after buyback) vs PremiumTab gross
**Tab:** SymbolsTab vs PremiumTab  
**Status:** ✅ NEW bug confirmed with testuser data

**Root cause:** `symbol_summary()` uses `net = _net_premium(p) * contracts * 100` (subtracts `premium_out` buyback cost) for `total_premium`. But `get_premium_dashboard()` exposes `total_premium_sold = premium_sold` from the ledger (gross sold, no deduction). For NVDA: SymbolsTab shows $1,062 (net), PremiumTab shows $1,075 (gross) — a $13 difference.  

**Effect:** Comparing "Total Premium" across the two tabs gives inconsistent numbers, confusing users tracking their earnings.  

**Fix location:** `logic/portfolio.py` `symbol_summary()` — use `gross = (p.premium_in or 0) * p.contracts * 100` for `total_premium` to match the premium dashboard, and separately track `realized_pnl` with net.

---

## 🟢 LOW — Minor UI/UX Issues

### B9 · AccountTab — "Δ vs Prior" column missing `$` prefix
**Tab:** AccountTab  
**Status:** Structural (confirmed by code inspection)

**Root cause:** Delta column renders `+750` instead of `+$750`. The `fmt$` helper or inline formatter is not applied to the delta value.  

**Fix location:** `web/components/trades/AccountTab.tsx` — wrap delta with `fmt$(delta)` or prefix with `$`.

---

### B10 · YearTab — Consistency score is now meaningful with testuser data
**Tab:** YearTab  
**Status:** ✅ Resolved with testuser data (score=41.8/100, n=9 weeks, stddev=$206)  
*Was a bug only when a single data point gave stddev=0 → score=100 with no basis.*

**Original bug:** With 1 complete week, `stddev=0` → `consistency = 100 - (0/mean)*100 = 100`. Shows "100/100" as if performance is perfectly consistent, which is misleading with a sample size of 1.  

**Fix location:** `web/components/trades/YearTab.tsx` — guard: if `completedPremiums.length < 3`, render "Need 3+ weeks" or `—` instead of a numeric score.

---

### B11 · SymbolsTab — "Win Rate" counts profitable symbols, not profitable trades
**Tab:** SymbolsTab  
**Status:** ✅ Confirmed with testuser data (7/7 = 100% — all symbols profitable)

**Root cause:** `winners = symbols.filter(s => s.realized_pnl > 0)` — counts each symbol once. All 7 symbols have positive `realized_pnl` (even those with active positions). A symbol that had 9 profitable weeks and 1 losing week is counted as a "winner".  

**Effect:** Win rate = 100% even though some symbols had individual losing trades.  

**Fix location:** `web/components/trades/SymbolsTab.tsx` — either clarify the label ("Profitable Symbols") or compute win rate at the position level via backend.

---

### B12 · HoldingsTab — "Basis Saved" card includes closed holdings
**Tab:** HoldingsTab  
**Status:** Partial (testuser closed holdings AMD/AMZN show $0 basis_reduction — seeded correctly)

**Root cause:** `totalSaved = holdings.reduce((s, h) => s + h.basis_reduction, 0)` sums all holdings including those with `status="CLOSED"`. With real closed holdings having non-zero `basis_reduction`, the card shows a lifetime total mixing active and closed without labeling it as such.  

**Effect:** Users may think the displayed amount reflects current cost savings on active positions, not a lifetime total.  

**Fix location:** `web/components/trades/HoldingsTab.tsx` — either filter to `ACTIVE` holdings only, or label the card "Lifetime Basis Saved (Active + Closed)".

---

## Summary Table

| # | Severity | Tab | Title | Status |
|---|---|---|---|---|
| B1 | 🔴 HIGH | PremiumTab | Active holding mis-categorized as "Exited" | Prod only (HIMS) |
| B2 | 🔴 HIGH | AccountTab | Chart tooltips show "Invalid Date" | Confirmed |
| B3 | 🔴 HIGH | YearTab | Worst Week shows open incomplete week | ✅ Confirmed |
| B4 | 🟡 MEDIUM | YearTab | Best/Worst Month same when 1 month data | Edge case |
| B5 | 🟡 MEDIUM | YearTab | Win Rate subtitle denominator mismatch | Confirmed |
| B6 | 🟡 MEDIUM | YearTab | Monthly chart renders 9 future empty bars | ✅ Confirmed |
| B7 | 🟡 MEDIUM | PositionsTab | ITM card overflows grid | Confirmed |
| B8 | 🟡 MEDIUM | PremiumTab | Sold$ vs Realized$ diff has no explanation | ✅ Confirmed |
| B9 | 🟢 LOW | AccountTab | Δ vs Prior column missing $ prefix | Confirmed |
| B10 | 🟢 LOW | YearTab | Consistency 100/100 with 1 data point | Edge case |
| B11 | 🟢 LOW | SymbolsTab | Win Rate counts symbols not positions | ✅ Confirmed |
| B12 | 🟢 LOW | HoldingsTab | Basis Saved includes closed holdings | Confirmed |
| B13 | 🔴 HIGH | YearTab | Annual projection includes open weeks | ✅ NEW — Confirmed |
| B14 | 🟡 MEDIUM | SymbolsTab | total_premium net vs PremiumTab gross inconsistency | ✅ NEW — Confirmed |

**Total: 14 bugs** (12 original + 2 new from testuser audit)
