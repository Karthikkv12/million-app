import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl").sort_values(["sym", "date"])
F["r1n"] = F.groupby("sym").px.shift(-1) / F.px - 1
# target = the stock's own trailing 3-year median HV (point in time), so average exposure stays near 1
F["hv_med"] = F.groupby("sym").hv20.transform(lambda x: x.rolling(756, min_periods=252).median())
F["w_vt"] = np.clip(F.hv_med / F.hv20, 0.25, 1.5)
F["w_vt_add"] = np.where((F.rsi14 < 40) & (F.vix_pct >= .8), np.maximum(F.w_vt, 1.0), F.w_vt)
def mdd(r):
    eq = (1 + r.fillna(0)).cumprod(); return (eq / eq.cummax() - 1).min()
for per, m in (("1995-2014", F.date < "2015"), ("2015-2026", F.date >= "2015")):
    D0 = F[m & F.hv_med.notna()]
    res = {}
    for k, w in (("buy&hold", 1.0), ("vol-target", D0.w_vt), ("vol-target + fear-dip floor", D0.w_vt_add)):
        D = D0.assign(ret=w * D0.r1n).dropna(subset=["ret"])
        g = D.groupby("sym").ret; ann, vol = g.mean()*252, g.std()*np.sqrt(252); sh = ann/vol
        res[k] = (ann, sh, g.apply(mdd), float(np.mean(w)))
    b = res["buy&hold"]
    for k, (ann, sh, dd, ex) in res.items():
        print(per, f"{k:30s} ann {ann.mean()*100:5.1f}%  sharpe {sh.mean():.3f}  sharpe>B&H {((sh > b[1]+1e-9).mean()*100):4.0f}% syms  maxDD {dd.mean()*100:6.1f}%  smallerDD {((dd > b[2]+1e-9).mean()*100):4.0f}%  exp {ex:.2f}")
