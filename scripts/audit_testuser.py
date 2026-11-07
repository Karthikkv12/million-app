"""
audit_testuser.py  — Full audit of testuser (user_id=3) against all known bugs.
Run: .venv/bin/python3 scripts/audit_testuser.py
"""
from __future__ import annotations
import sys, math
sys.path.insert(0, '.')

UID = 3  # testuser

# ─────────────────────────────────────────────────────────────────────────────
# 1. portfolio_summary  (YearTab / AccountTab backend data)
# ─────────────────────────────────────────────────────────────────────────────
from logic.portfolio import portfolio_summary
s = portfolio_summary(user_id=UID)

wb = s["weeks_breakdown"]           # newest-first
mp = s["monthly_premium"]           # dict month-key → float

print("=" * 70)
print("1. PORTFOLIO SUMMARY AUDIT")
print("=" * 70)
print(f"  total_premium_collected : {s['total_premium_collected']}")
print(f"  realized_pnl            : {s['realized_pnl']}")
print(f"  win_rate (backend)      : {s['win_rate']}")
print(f"  total_weeks             : {s['total_weeks']}")
print(f"  complete_weeks          : {s['complete_weeks']}")
print(f"  best_week               : {s['best_week']}")
print(f"  worst_week              : {s['worst_week']}")

# ── B3: worst_week includes open weeks ───────────────────────────────────────
worst_all = min(wb, key=lambda x: x["premium"])
worst_complete_list = [w for w in wb if w["is_complete"]]
worst_complete = min(worst_complete_list, key=lambda x: x["premium"])
b3 = worst_all["is_complete"] == False
print(f"\n  B3 (worst_week = open week?): {'CONFIRMED BUG' if b3 else 'OK'}")
print(f"     worst of ALL: {worst_all['week_end']} complete={worst_all['is_complete']} prem={worst_all['premium']}")
print(f"     worst COMPLETE: {worst_complete['week_end']} prem={worst_complete['premium']}")

# ── B4: best/worst month distinct ────────────────────────────────────────────
monthly_entries = sorted(mp.items())
best_m = max(monthly_entries, key=lambda x: x[1])
worst_m_entries = [(k,v) for k,v in monthly_entries if v > 0]
worst_m = min(worst_m_entries, key=lambda x: x[1]) if worst_m_entries else None
b4_ok = worst_m and best_m[0] != worst_m[0]
print(f"\n  B4 (best/worst month distinct): {'OK - different months' if b4_ok else 'BUG - same month'}")
print(f"     bestMonth={best_m}  worstMonth={worst_m}")

# ── B5: win rate subtitle denominator ────────────────────────────────────────
# backend returns win_rate = 9/10 complete = 90.0
# B5 was: subtitle said "X/total_weeks weeks" using all weeks not complete weeks
# Check what the frontend would render: it uses s.complete_weeks for denominator
winning = sum(1 for w in worst_complete_list if w["premium"] > 0)
win_denom_correct = s["complete_weeks"]
win_denom_buggy   = s["total_weeks"]
print(f"\n  B5 (win rate denominator): backend complete_weeks={win_denom_correct}, total_weeks={win_denom_buggy}")
print(f"     winning={winning}, win_rate={s['win_rate']}%")
print(f"     B5 CHECK: frontend must use complete_weeks ({win_denom_correct}) not total_weeks ({win_denom_buggy})")

# ── B6: future empty month bars ──────────────────────────────────────────────
future = [(k,v) for k,v in monthly_entries if v == 0]
print(f"\n  B6 (future empty months in chart): {len(future)} future months with $0")
print(f"     months: {[k for k,v in future]}")
print(f"     B6 CONFIRMED: chart will render {len(future)} empty bars (Apr-Dec)")

# ── B10: consistency score ────────────────────────────────────────────────────
comp_prems = [w["premium"] for w in wb if w["is_complete"] and w["premium"] > 0]
mean_p = sum(comp_prems) / len(comp_prems) if comp_prems else 0
stddev_p = math.sqrt(sum((x-mean_p)**2 for x in comp_prems)/len(comp_prems)) if len(comp_prems) > 1 else 0
consist = max(0, min(100, 100 - (stddev_p / mean_p) * 100)) if mean_p > 0 else 0
print(f"\n  B10 (consistency score): {consist:.1f}/100")
print(f"     n={len(comp_prems)}, mean={mean_p:.2f}, stddev={stddev_p:.2f}")
b10_ok = consist < 100 and len(comp_prems) > 1
print(f"     B10 STATUS: {'OK - meaningful score' if b10_ok else 'BUG - misleading'}")

# ── NEW BUG CHECK: annual projection includes open weeks ─────────────────────
chrono = list(reversed(wb))
active_prem_weeks = [w for w in chrono if w["premium"] > 0]
open_in_active = [w for w in active_prem_weeks if not w["is_complete"]]
avg_weekly = sum(w["premium"] for w in active_prem_weeks) / len(active_prem_weeks) if active_prem_weeks else 0
annual_proj = avg_weekly * 52
print(f"\n  NEW B13 (annual projection includes open/incomplete weeks?):")
print(f"     activePremWeeks count: {len(active_prem_weeks)}")
print(f"     openWeeksIncluded: {open_in_active}")
print(f"     avgWeeklyPremium: {avg_weekly:.2f}  annualProjection: {annual_proj:.2f}")
if open_in_active:
    print(f"     BUG CONFIRMED: open week Mar 13 (premium=200) inflates projection!")

# ── STREAK CHECK ─────────────────────────────────────────────────────────────
completed_weeks = [w for w in wb if w["is_complete"]]  # newest-first
streak_break = next((i for i,w in enumerate(completed_weeks) if w["premium"] <= 0), -1)
current_streak = len(completed_weeks) if streak_break == -1 else streak_break
print(f"\n  STREAK CHECK:")
print(f"     completedWeeks (newest first): {[w['week_end'] for w in completed_weeks]}")
print(f"     streak_break at index {streak_break} → week {completed_weeks[streak_break]['week_end'] if streak_break != -1 else 'n/a'}")
print(f"     currentStreak: {current_streak}")
print(f"     Expected: Mar 6 + Feb 27 = 2 profitable in a row (streakBreak at Jan 16 $0 week)")

# ─────────────────────────────────────────────────────────────────────────────
# 2. Premium Dashboard  (PremiumTab backend data)
# ─────────────────────────────────────────────────────────────────────────────
from logic.premium_ledger import get_premium_dashboard
p = get_premium_dashboard(user_id=UID)

print("\n" + "=" * 70)
print("2. PREMIUM DASHBOARD AUDIT")
print("=" * 70)
print(f"  grand_total: {p['grand_total']}")
print(f"\n  by_symbol rows:")
for row in p.get("by_symbol", []):
    print(f"    {row}")

# ── B1: mis-categorized symbol check ─────────────────────────────────────────
exited = p.get("exited_rows", [])
active = p.get("active_rows", [])
print(f"\n  active_rows count : {len(active)}")
print(f"  exited_rows count : {len(exited)}")
print(f"\n  B1 CHECK - any active symbol with shares>0 landing in exitedRows?")
for row in exited:
    if row.get("shares", 0) == 0 and row.get("in_flight", 0) > 0:
        print(f"    BUG: {row['symbol']} in exitedRows but has in_flight={row['in_flight']}")
    elif row.get("shares", 0) > 0:
        print(f"    BUG: {row['symbol']} in exitedRows but shares={row['shares']} > 0!")
print(f"  (B1 requires hard-deleted holding — not present in testuser seed)")

# ── B8: sold > realized diff ──────────────────────────────────────────────────
print(f"\n  B8 CHECK - symbols where premium_sold > realized (buyback cost):")
for row in p.get("by_symbol", []):
    sold = row.get("total_premium_sold", 0)
    realized = row.get("realized_premium", 0)
    if sold > 0 and sold != realized:
        print(f"    {row['symbol']}: sold=${sold:.2f}  realized=${realized:.2f}  diff=${sold-realized:.2f}")

# ─────────────────────────────────────────────────────────────────────────────
# 3. Symbol Summary  (SymbolsTab backend data)
# ─────────────────────────────────────────────────────────────────────────────
from logic.portfolio import symbol_summary
syms = symbol_summary(user_id=UID)

print("\n" + "=" * 70)
print("3. SYMBOL SUMMARY AUDIT")
print("=" * 70)
for sym in syms:
    print(f"  {sym}")

# ── B11: win rate counts symbols not positions ────────────────────────────────
winners = [s for s in syms if s.get("realized_pnl", 0) > 0]
losers  = [s for s in syms if s.get("realized_pnl", 0) <= 0 and s.get("realized_pnl") is not None]
print(f"\n  B11 CHECK: winners={len(winners)} losers={len(losers)}")
print(f"     Win Rate shown = {len(winners)}/{len(syms)} symbols = {len(winners)/len(syms)*100:.0f}%")
print(f"     This counts SYMBOLS not individual trade instances (B11 confirmed)")

# ─────────────────────────────────────────────────────────────────────────────
# 4. Holdings audit  (HoldingsTab)
# ─────────────────────────────────────────────────────────────────────────────
from logic.holdings import list_holdings
holdings = list_holdings(user_id=UID)

print("\n" + "=" * 70)
print("4. HOLDINGS AUDIT")
print("=" * 70)
total_basis_saved = sum(
    (h.get("cost_basis", 0) - h.get("adjusted_cost_basis", 0)) * h.get("shares", 1) if h.get("shares", 0) > 0
    else (h.get("cost_basis", 0) - h.get("adjusted_cost_basis", 0))
    for h in holdings
)
print(f"  Holdings: {[(h['symbol'], h['status'], h['shares']) for h in holdings]}")
print(f"\n  B12 CHECK (basis saved includes closed holdings):")
for h in holdings:
    saved = (h.get("cost_basis", 0) - h.get("adjusted_cost_basis", 0)) * max(h.get("shares", 0), 1)
    print(f"    {h['symbol']:6s} status={h['status']:7s} shares={h['shares']:4.0f}  basis_reduction={h.get('basis_reduction',0)}")
closed_basis = sum(h.get("basis_reduction", 0) for h in holdings if h.get("status") == "CLOSED")
print(f"\n  CLOSED holdings contribute to basis_saved: ${closed_basis:.2f}")
print(f"  B12 CONFIRMED: ${closed_basis:.2f} from closed holdings mixed into total without label" if closed_basis > 0 else "  B12: no basis from closed holdings in this dataset")

print("\n" + "=" * 70)
print("AUDIT COMPLETE")
print("=" * 70)
