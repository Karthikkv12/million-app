"""Swing round 3b: grade the current rule's trades (no change to the trigger). Which conditions at the signal close
separate the better trades? Tier chosen on 1995–2014 (avg AND t); 2015–2026 and the 52 new names read once.
python swing3b.py → swing3b.json"""
import json
import numpy as np, pandas as pd
import swing as S
from swing3 import SETUPS, EXIT, OLD148

t = S.trades(SETUPS["CURRENT: Add or drop5 ≥ 5% above 200"], EXIT)
look = {}
for s, a in S.SYM.items():
    fear = S.fear(a["vix_pct"], a["rsi14"]) >= 0.283
    look[s] = pd.DataFrame({"fear": fear, "ret5": a["ret5"], "d200": a["d200"], "z5": a["z5"], "rsi2": a["rsi2"],
                            "vix_pct": a["vix_pct"]}, index=pd.to_datetime(a["dates"]))
t = pd.concat([g.join(look[s], on="date") for s, g in t.groupby("sym")])
t["drop"] = (t.ret5 <= -0.05) & (t.d200 > 0)
TIERS = {
    "all buys": np.ones(len(t), bool),
    "drop only": t["drop"] & ~t.fear, "fear only": t.fear & ~t["drop"], "both legs": t.fear & t["drop"],
    "drop ≥ 7%, above 200": (t.ret5 <= -0.07) & (t.d200 > 0),
    "drop ≥ 10%, above 200": (t.ret5 <= -0.10) & (t.d200 > 0),
    "z5 ≤ −2": t.z5 <= -2, "RSI(2) < 5": t.rsi2 < 5,
    "drop ≥ 7% or both legs": ((t.ret5 <= -0.07) & (t.d200 > 0)) | (t.fear & t["drop"]),
}
out = {}
fm = lambda x: f"{x['trades']:6d} {x['avg']:+5.2f}% {x['win']:4.1f}% {x['worst5']:+5.1f} t{x['t']:5.2f}" if x else "-"
for k, m in TIERS.items():
    d = t[np.asarray(m, bool)]
    a, b = S.split(d)
    n = d[~d.sym.isin(OLD148) & (d.date > S.IS_END)]
    out[k] = {"is": a, "oos": b, "oos_new52": S.stats(n)}
    print(f"{k:26} | {fm(a)} | {fm(b)} | {fm(out[k]['oos_new52'])}", flush=True)
json.dump(out, open("swing3b.json", "w"), indent=1)
