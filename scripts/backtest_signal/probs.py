"""Probabilities per desk signal, from 2015–2026 (unseen when the rules were set). Stock outcomes from F, option
outcomes from O (365-day 0.80Δ call, stress costs). Edge confidence: month-cluster bootstrap of the mean 60-day excess."""
import json, numpy as np, pandas as pd
O = pd.read_pickle("O.pkl")
O = O[O.date >= "2015"].copy()
for h in ("fwd20", "fwd60"):
    O[h + "x"] = O[h] - O.groupby("sym")[h].transform("mean")
col = "o_365_0.8_stress_60"
O["ivr"] = O.iv30 / O.theta
O["rb"] = 100 * (np.clip(O.vix_pct * 2 - 1, -1, 1) + np.clip((50 - O.rsi14) / 25, -1, 1) + np.clip(-O.d_ma50 / .15, -1, 1)) / 3
fear = (O.rsi14 < 40) & (O.vix_pct >= .8); ivok = O.ivr >= 1.2
calm = O.vix_pct < .6
caution = ~fear & calm & ((O.dd52 <= -.10) | (O.d_ma50.between(.03, .15) & (O.rsi14 > 65)))
lean = ~fear & ~caution & (O.rb.round() >= 50) & (O.rsi14 < 40)
cases = {"ADD": fear & ivok, "FEAR_IV_NORMAL": fear & ~ivok, "LEAN": lean, "CAUTION": caution,
         "HOLD": ~fear & ~caution & ~lean, "TRIM": fear}
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
