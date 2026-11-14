"""Probabilities per desk case (2026-11-14 rule), from 2015–2026 (unseen when the rules were set). Stock outcomes from
F/O, option outcomes from O (365-day 0.80Δ call, stress costs). Edge confidence: month-cluster bootstrap of the mean
60-day excess. Cases are mutually exclusive: ADD (fear score ≥ 0.283) · LEAN (RSI < 40, not ADD, not CAUTION) ·
CAUTION (calm market and 10%+ off the 52-week high, or stretched) · HOLD (the rest). TRIM (long puts) = ADD days.
Also: the exit line (calm-market close under the 200-day, after being over it)."""
import json, numpy as np, pandas as pd
O = pd.read_pickle("O.pkl")
O = O[O.date >= "2015"].copy()
for h in ("fwd20", "fwd60"):
    O[h + "x"] = O[h] - O.groupby("sym")[h].transform("mean")
col = "o_365_0.8_stress_60"
score = np.clip((O.vix_pct - .5) / .5, 0, 1) ** 1.5 * np.clip((50 - O.rsi14) / 30, 0, 1)
add = score >= 0.283
calm = O.vix_pct < .6
caution = ~add & calm & ((O.dd52 <= -.10) | (O.d_ma50.between(.03, .15) & (O.rsi14 > 65)))
lean = ~add & ~caution & (O.rsi14 < 40)
cases = {"ADD": add, "LEAN": lean, "CAUTION": caution, "HOLD": ~add & ~caution & ~lean, "TRIM": add}
rng = np.random.default_rng(11)
O["mon"] = O.date.dt.to_period("M")
out = {}
for k, m in cases.items():
    D = O[m & O.fwd60.notna()]
    mon = D.groupby("mon").fwd60x.agg(["sum", "count"])
    idx = rng.integers(0, len(mon), size=(4000, len(mon)))
    boot = mon["sum"].values[idx].sum(1) / mon["count"].values[idx].sum(1)
    opt = D[col].dropna()
    out[k] = dict(cases=int(len(D)), months=int(len(mon)),
                  p_up_20=round(float((D.fwd20 > 0).mean()), 3), p_up_60=round(float((D.fwd60 > 0).mean()), 3),
                  p_beat_20=round(float((D.fwd20x > 0).mean()), 3), p_beat_60=round(float((D.fwd60x > 0).mean()), 3),
                  p_option_profit_60=round(float((opt > 0).mean()), 3) if len(opt) else None,
                  edge_60=round(float(D.fwd60x.mean()), 4), edge_lo=round(float(np.quantile(boot, .05)), 4),
                  edge_hi=round(float(np.quantile(boot, .95)), 4), p_edge_positive=round(float((boot > 0).mean()), 3))
    print(k, out[k])
json.dump(out, open("probs.json", "w"), indent=1)
# the exit line, both periods: first calm-market close under the 200-day after a close over it
F = pd.read_pickle("F.pkl").sort_values(["sym", "date"]); F["per"] = np.where(F.date < "2015", "IS", "OOS")
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
F["mon"] = F.date.dt.to_period("M")
under = F.d_ma200 < 0
cross = under & ~F.groupby("sym").d_ma200.shift(1).lt(0).fillna(True)
for lab, m in (("calm cross under 200d", cross & (F.vix_pct < .6)), ("fear cross under 200d", cross & (F.vix_pct >= .8)),
               ("calm, under 200d (any day)", under & (F.vix_pct < .6))):
    for p in ("IS", "OOS"):
        D = F[m & (F.per == p) & F.fwd60.notna()]; mm = D.groupby("mon").fwd60x.mean()
        print(lab, p, len(D), round(D.fwd20x.mean() * 100, 2), round(D.fwd60x.mean() * 100, 2), "t60", round(mm.mean() / (mm.std() / np.sqrt(len(mm))), 2))
