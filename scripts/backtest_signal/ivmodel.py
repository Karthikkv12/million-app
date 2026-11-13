"""IV30 proxy for stocks without IV history: log IV30 = a + b·log HV20 + c·log HV60 + d·log HV252 + e·log(VIX / VIX 1y median).
Fit on real IV indexes (SPY/VIX, QQQ/VXN, DIA/VXD, GLD/GVZ, USO/OVX), leave-one-underlying-out."""
import pandas as pd, numpy as np
I = pd.read_pickle("ividx.pkl"); P = pd.read_pickle("prices.pkl")
vix = I["^VIX"]; vix.index = vix.index.tz_localize(None).normalize() if vix.index.tz is not None else vix.index.normalize()
def norm(s):
    s = s.copy(); s.index = (s.index.tz_localize(None) if s.index.tz is not None else s.index).normalize(); return s
vix = norm(vix); vmed = vix.rolling(252).median()
def feats(close):
    lr = np.log(close).diff()
    f = pd.DataFrame({f"hv{n}": lr.rolling(n).std() * np.sqrt(252) for n in (10, 20, 60, 252)})
    f["vixrel"] = (vix / vmed).reindex(f.index).ffill()
    return f
def X(f): return np.column_stack([np.ones(len(f)), np.log(f.hv20), np.log(f.hv60), np.log(f.hv252), np.log(f.vixrel)])
pairs = {"SPY": "^VIX", "QQQ": "^VXN", "DIA": "^VXD", "GLD": "^GVZ", "USO": "^OVX"}
D = {}
for u, ix in pairs.items():
    c = P.loc[u].Close if u in P.index.get_level_values(0) else I["USO"]["Close"]
    c = norm(c); f = feats(c); f["iv"] = norm(I[ix]).reindex(f.index) / 100
    f = f.dropna(); f = f[(f.hv20 > 0) & (f.iv > 0)]; D[u] = f
def fit(F): return np.linalg.lstsq(X(F), np.log(F.iv), rcond=None)[0]
coef_all = fit(pd.concat(D.values()))
print("coef (all):", np.round(coef_all, 3), "  [const, log hv20, log hv60, log hv252, log vix/median]")
rows = []
for u in D:
    tr = pd.concat([D[k] for k in D if k != u]); te = D[u]; b = fit(tr)
    pred = np.exp(X(te) @ b)
    naive = te.hv20                                   # what the desk would use without a model
    d20a, d20p = te.iv.shift(-20) - te.iv, pd.Series(pred, te.index).shift(-20) - pred
    m = d20a.notna()
    rows.append((u, len(te), te.index[0].year, round(np.mean(np.abs(pred - te.iv)) * 100, 1), round(np.mean(np.abs(naive - te.iv)) * 100, 1),
                 round(np.corrcoef(pred, te.iv)[0, 1], 3), round(np.mean(pred - te.iv) * 100, 1), round(np.corrcoef(d20p[m], d20a[m])[0, 1], 3)))
R = pd.DataFrame(rows, columns=["held-out", "days", "from", "MAE model (vol pts)", "MAE HV20 alone", "corr level", "bias (pts)", "corr of 20d IV change"])
print(R.to_string(index=False))
np.save("ivcoef.npy", coef_all)
# term structure: VIX3M vs VIX → mean-reversion speed for long-dated IV:  IV_T = θ + (IV30-θ)·(1-e^{-κT})/(κT) (T in yrs, IV30 at T=1/12)
v3 = norm(I["^VIX3M"]); j = pd.concat([vix, v3], axis=1, keys=["v", "v3"]).dropna() / 100
theta = (vix.rolling(252 * 5, min_periods=252).mean() / 100).reindex(j.index)
best = None
for k in np.arange(0.5, 12.01, 0.25):
    g = lambda T: (1 - np.exp(-k * T)) / (k * T)
    # express VIX3M (T=.25) from VIX (T=1/12): both relative to θ
    pred = theta + (j.v - theta) * g(0.25) / g(1 / 12)
    e = np.nanmean(np.abs(pred - j.v3))
    if best is None or e < best[1]: best = (k, e)
print(f"term structure: kappa {best[0]} /yr, MAE on VIX3M {best[1]*100:.2f} pts (n={len(j)})")
np.save("kappa.npy", np.array([best[0]]))
