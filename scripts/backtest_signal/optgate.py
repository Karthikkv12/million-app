import pandas as pd, numpy as np
O = pd.read_pickle("O.pkl"); O["mon"] = O.date.dt.to_period("M")
add = (O.rsi14 < 40) & (O.vix_pct >= .8)
O["ivr"] = O.iv30 / O.theta                    # IV vs its own 5-year normal
def t_month(x, mon):
    m = x.groupby(mon).mean(); return m.mean() / (m.std() / np.sqrt(len(m)))
print("### ADD split by how rich IV is vs the stock's own 5-year normal (365 DTE, 0.80Δ, STRESS costs)")
for h in (20, 60):
    col = f"o_365_0.8_stress_{h}"; x = O[col] - O.groupby(["sym", "per"])[col].transform("mean")
    for lab, m in (("IV < 1.2× normal", O.ivr < 1.2), ("IV 1.2–1.5×", O.ivr.between(1.2, 1.5)), ("IV ≥ 1.5× normal", O.ivr >= 1.5)):
        out = []
        for per in ("IS", "OOS"):
            mm = add & m & (O.per == per) & O[col].notna()
            out.append(f"{per}: n {mm.sum():6d} ret {O.loc[mm, col].mean()*100:6.2f} excess {x[mm].mean()*100:5.2f} hit {(O.loc[mm, col] > 0).mean()*100:4.1f} t {t_month(x[mm], O.mon[mm]):4.2f}")
        print(f"  {h}d {lab:18s} | " + " | ".join(out))
print("\nshare of ADD days by IV richness:", (pd.cut(O.ivr[add], [0, 1.2, 1.5, 9]).value_counts(normalize=True).round(2)).to_dict())
# theta curve for a 0.80Δ call at typical IV 35% / 50%, r 4%
import math
def N(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def c(S, K, T, r, v):
    d1 = (math.log(S / K) + (r + v*v/2) * T) / (v * math.sqrt(T)); return S * N(d1) - K * math.exp(-r*T) * N(d1 - v*math.sqrt(T))
print("\n### theta of a 0.80Δ call: % of its value lost per 20 trading days, price & IV unchanged")
for v in (0.35, 0.50, 0.80):
    row = []
    for D in (30, 60, 90, 120, 150, 180, 240, 365, 540, 730):
        T = D / 365; K = 100 * math.exp(-(0.841621 * v * math.sqrt(T)) + (0.04 + v*v/2) * T)
        p0 = c(100, K, T, .04, v); p1 = c(100, K, max(T - 20/252, 1e-4), .04, v); row.append(f"{D}d {100*(p1/p0-1):5.1f}%")
    print(f"  IV {v:.0%}: " + "  ".join(row))
