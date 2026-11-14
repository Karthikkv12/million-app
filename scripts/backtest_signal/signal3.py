"""Regular signal, round 3 (2026-11-14): the live rules re-read on 200 symbols, and candidates to sharpen ADD.
Excess = forward return minus that symbol's average forward return in the same period ("vs holding"); t clustered by
month. Candidates chosen on 1995–2014 (t of the 60-day excess, and the excess itself); 2015–2026 read once; the 52 new
names reported apart as a second hold-out.

python signal3.py  (F.pkl from feats.py on the 200 names) → signal3.json
"""
import json, numpy as np, pandas as pd
from swing3 import OLD148

F = pd.read_pickle("F.pkl").sort_values(["sym", "date"]).reset_index(drop=True)
F["date"] = pd.to_datetime(F["date"])
F["per"] = np.where(F.date < "2015", "IS", "OOS")
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
F["score"] = np.clip((F.vix_pct - .5) / .5, 0, 1) ** 1.5 * np.clip((50 - F.rsi14) / 30, 0, 1)
F["new52"] = ~F.sym.isin(OLD148)
prev200 = F.groupby("sym").d_ma200.shift(1)
calm = F.vix_pct < 0.60
ADD = F.score >= 0.283
RULES = {
    "ADD (current: score ≥ 0.283)": ADD,
    "ADD, score ≥ 0.25": F.score >= 0.25,
    "ADD, score ≥ 0.35": F.score >= 0.35,
    "ADD & 60d vs SPY ≥ −10%": ADD & (F.rs60 >= -0.10),
    "ADD & 60d vs SPY ≥ −20%": ADD & (F.rs60 >= -0.20),
    "ADD & within 20% of 200-day": ADD & (F.d_ma200 >= -0.20),
    "ADD & off 52w high ≤ 30%": ADD & (F.dd52 >= -0.30),
    "CAUTION (current)": calm & ((F.dd52 <= -0.10) | ((F.d_ma50 >= .03) & (F.d_ma50 <= .15) & (F.rsi14 > 65))),
    "EXIT (current: calm, fresh close under 200-day)": calm & (F.d_ma200 < 0) & (prev200 >= 0),
}


def st(m, col):
    D = F[m & F[col].notna()]
    if len(D) < 30:
        return None
    mo = D.groupby(D.date.dt.to_period("M"))[col].mean()
    t = mo.mean() / (mo.std() / np.sqrt(len(mo))) if len(mo) > 2 else np.nan
    return {"n": int(len(D)), "months": int(len(mo)), "avg": round(D[col].mean() * 100, 2),
            "up": round((D[col.replace("x", "")] > 0).mean() * 100, 1), "t": round(float(t), 2)}


if __name__ == "__main__":
    out = {"symbols": int(F.sym.nunique()), "symbol_days": int(len(F)), "rules": {}}
    print(out)
    fm = lambda x: f"{x['n']:7d} {x['avg']:+5.2f}% up{x['up']:5.1f}% t{x['t']:5.2f}" if x else "-"
    for name, m in RULES.items():
        r = {}
        for p in ("IS", "OOS"):
            for h in ("fwd20x", "fwd60x"):
                r[f"{p}_{h}"] = st(m & (F.per == p), h)
            r[f"{p}_new52_fwd60x"] = st(m & (F.per == p) & F.new52, "fwd60x")
        out["rules"][name] = r
        print(f"{name:48} IS60 {fm(r['IS_fwd60x'])} | OOS20 {fm(r['OOS_fwd20x'])} | OOS60 {fm(r['OOS_fwd60x'])} | new52 OOS60 {fm(r['OOS_new52_fwd60x'])}", flush=True)
    json.dump(out, open("signal3.json", "w"), indent=1)
