import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl").sort_values(["sym", "date"])
F["r1n"] = F.groupby("sym").px.shift(-1) / F.px - 1
def persist(sig, days):
    s = pd.Series(sig.astype(float).values, index=F.index)
    return s.groupby(F.sym.values).transform(lambda x: x.replace(0, np.nan).ffill(limit=days - 1).fillna(0)).values > 0
add = persist((F.rsi14 < 40) & (F.vix_pct >= .8), 20)
add60 = persist((F.rsi14 < 40) & (F.vix_pct >= .8), 60)
knife = persist((F.dd52 <= -.10) & (F.vix_pct < .6), 20)
knife_strict = persist((F.dd52 <= -.20) & (F.d_ma200 < 0) & (F.vix_pct < .6) & (F.spy_trend > 0), 20)
stretched = persist((F.vix_pct < .6) & F.d_ma50.between(.03, .15) & (F.rsi14 > 65), 20)
trend_off = F.d_ma200.values < 0                               # classic trend filter, for reference
pol = {
  "buy&hold": np.ones(len(F)),
  "ADD 20d": np.where(add, 1.5, 1),
  "ADD 60d": np.where(add60, 1.5, 1),
  "KNIFE cut": np.where(knife, .5, 1),
  "KNIFE strict cut": np.where(knife_strict, .5, 1),
  "STRETCHED cut": np.where(stretched, .5, 1),
  "ADD60 + strict knife": np.where(add60, 1.5, np.where(knife_strict, .5, 1)),
  "200d trend filter (0.5 below)": np.where(trend_off, .5, 1),
}
def mdd(r):
    eq = (1 + r.fillna(0)).cumprod(); return (eq / eq.cummax() - 1).min()
out = []
for per, m in (("1995-2014", (F.date < "2015").values), ("2015-2026", (F.date >= "2015").values)):
    base_sh = None
    for k, w in pol.items():
        D = F[m].assign(ret=w[m] * F[m].r1n.values).dropna(subset=["ret"])
        g = D.groupby("sym").ret
        ann, vol = g.mean() * 252, g.std() * np.sqrt(252); sh = ann / vol
        dd = g.apply(mdd)
        if base_sh is None: base_sh, base_dd = sh, dd
        out.append((per, k, round(ann.mean()*100, 1), round(sh.mean(), 3), round((sh > base_sh + 1e-9).mean()*100), round(dd.mean()*100, 1),
                    round((dd > base_dd + 1e-9).mean()*100), round(w[m].mean(), 2)))
R = pd.DataFrame(out, columns=["period", "policy", "ann%", "sharpe", "%syms sharpe>B&H", "avg maxDD%", "%syms smaller DD", "avg exp"])
print(R.to_string(index=False))
print("\nfire rates:", {k: round(float(v.mean()), 3) for k, v in [("add", add), ("knife_strict", knife_strict), ("stretched", stretched)]})
