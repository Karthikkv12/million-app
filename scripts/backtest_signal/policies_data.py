"""Holding policies vs buy-and-hold over 148 symbols: exposure set at each close for the next day (1.5 on Add for 20
days, 0.5 on cuts for 20 days, else 1). Per symbol: annual return, Sharpe, worst drawdown; averaged over symbols."""
import json, pandas as pd, numpy as np
CODE = open(__file__).read()
F = pd.read_pickle("F.pkl").sort_values(["sym", "date"])
F["r1n"] = F.groupby("sym").px.shift(-1) / F.px - 1
def persist(sig, days=20):
    s = pd.Series(sig.astype(float).values, index=F.index)
    return s.groupby(F.sym.values).transform(lambda x: x.replace(0, np.nan).ffill(limit=days - 1).fillna(0)).values > 0
add = persist((F.rsi14 < 40) & (F.vix_pct >= .8)); knife = persist((F.dd52 <= -.10) & (F.vix_pct < .6))
pol = {"Buy and hold": np.ones(len(F)),
       "Old signal": np.select([F.p_score >= 25, F.p_score <= -25], [1.5, .5], 1.0),
       "Add on fear dips": np.where(add, 1.5, 1.0),
       "Cut on calm-market weakness": np.where(knife, .5, 1.0),
       "Cut below the 200-day average": np.where(F.d_ma200.values < 0, .5, 1.0)}
def mdd(r):
    eq = (1 + r.fillna(0)).cumprod(); return (eq / eq.cummax() - 1).min()
rows = []
for per, m in (("1995–2014", (F.date < "2015").values), ("2015–2026", (F.date >= "2015").values)):
    for k, w in pol.items():
        D = F[m].assign(ret=w[m] * F[m].r1n.values).dropna(subset=["ret"]); g = D.groupby("sym").ret
        ann, vol = g.mean() * 252, g.std() * np.sqrt(252)
        rows.append({"policy": k, "period": per, "annual_return": round(float(ann.mean() * 100), 1),
                     "sharpe": round(float((ann / vol).mean()), 2), "worst_drawdown": round(float(g.apply(mdd).mean() * 100), 1)})
        print(rows[-1])
json.dump({"rows": rows, "meta": [{"label": "policies_data.py", "value": CODE, "type": "code", "lang": "python"},
                                  {"label": "Input", "value": "F.pkl (148 symbols, 1995-01 → 2026-11)"}]}, open("summary/policies.json", "w"), ensure_ascii=False)
