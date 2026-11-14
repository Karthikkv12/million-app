# Generated from holdsim.py (checks up to 231 trading days held) → Hroll.pkl, for roll.py.
"""Held-LEAPS simulation: buy a 365-day 0.80Δ call every 21 trading days on every symbol, then look at it every 21
days for 7 checks (≈ 21–147 trading days held). At each check: the position's P&L, delta, time value, the signal
case, and what the next 60 trading days bring for (a) holding the same call, (b) a delta-matched roll into a fresh
365-day 0.80Δ call with the difference banked in cash. Black-Scholes with the IV model and term structure (optsim)."""
import pandas as pd, numpy as np
I = pd.read_pickle("ividx.pkl"); P = pd.read_pickle("prices.pkl"); F = pd.read_pickle("F.pkl")
coef = np.load("ivcoef.npy"); KAPPA = float(np.load("kappa.npy")[0])
def norm(s):
    s = s.copy(); s.index = (s.index.tz_localize(None) if s.index.tz is not None else s.index).normalize(); return s
vix = norm(I["^VIX"]); vrel = vix / vix.rolling(252).median(); rate = (norm(I["^IRX"]) / 100).clip(lower=0)
def erf(x):
    s = np.sign(x); x = np.abs(x); t = 1 / (1 + 0.3275911 * x)
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x))
N = lambda x: 0.5 * (1 + erf(x / np.sqrt(2)))
def bs(S, K, T, r, v):
    T = np.maximum(T, 1e-6); sq = v * np.sqrt(T); d1 = (np.log(S / K) + (r + v * v / 2) * T) / sq
    return S * N(d1) - K * np.exp(-r * T) * N(d1 - sq), N(d1)
g = lambda T: (1 - np.exp(-KAPPA * T)) / (KAPPA * T)
ivT = lambda iv30, th, T: th + (iv30 - th) * g(np.maximum(T, 1 / 12)) / g(1 / 12)
Z80, T0, H = 0.841621, 365 / 365, 60
feat = F.set_index(["sym", "date"])[["rsi14", "vix_pct", "d_ma50", "dd52", "fwd60"]]
rows = []
for s in P.index.get_level_values(0).unique():
    d = P.loc[s]; d = d[d.Close > 0]; d.index = (d.index.tz_localize(None) if d.index.tz is not None else d.index).normalize()
    c = d.Close; lr = np.log(c).diff(); hv = {n: lr.rolling(n).std() * np.sqrt(252) for n in (20, 60, 252)}
    iv30 = np.exp(coef[0] + coef[1] * np.log(hv[20]) + coef[2] * np.log(hv[60]) + coef[3] * np.log(hv[252]) + coef[4] * np.log(vrel.reindex(c.index).ffill()))
    th = iv30.rolling(1260, min_periods=252).mean(); r = rate.reindex(c.index).ffill()
    S, IV, TH, R, dates = c.values, iv30.values, th.values, r.values, c.index
    n = len(S)
    for e in range(0, n - 21 * 2 - H, 21):
        if not (np.isfinite(IV[e]) and np.isfinite(TH[e]) and np.isfinite(R[e])): continue
        v0 = ivT(IV[e], TH[e], T0); K = S[e] * np.exp(-(Z80 * v0 * np.sqrt(T0)) + (R[e] + v0 ** 2 / 2) * T0)
        p0, _ = bs(S[e], K, T0, R[e], v0)
        for k in range(1, 12):
            t = e + 21 * k; f = t + H
            if f >= n or not np.isfinite(IV[t]) or not np.isfinite(IV[f]): break
            Tt, Tf = T0 - 21 * k / 252, T0 - (21 * k + H) / 252
            vt, vf = ivT(IV[t], TH[t], Tt), ivT(IV[f], TH[f], Tf)
            pt, dt = bs(S[t], K, Tt, R[t], vt); pf, _ = bs(S[f], K, Tf, R[f], vf)
            # fresh 365-day 0.80Δ call at t, delta-matched: q fresh calls per old call
            vn = ivT(IV[t], TH[t], T0); Kn = S[t] * np.exp(-(Z80 * vn * np.sqrt(T0)) + (R[t] + vn ** 2 / 2) * T0)
            pn, dn = bs(S[t], Kn, T0, R[t], vn); pnf, _ = bs(S[f], Kn, T0 - H / 252, R[f], ivT(IV[f], TH[f], T0 - H / 252))
            q = dt / dn
            rows.append((s, dates[e], dates[t], k * 21, pt / p0 - 1, dt, max(pt - max(S[t] - K, 0), 0) / pt, S[t] / S[e] - 1,
                         pf / pt - 1, pt, pf, pn, pnf, q))
H_ = pd.DataFrame(rows, columns=["sym", "entry", "date", "held", "pnl", "delta", "tv_share", "stock_since", "hold60",
                                 "pt", "pf", "pn", "pnf", "q"])
H_ = H_.merge(feat, left_on=["sym", "date"], right_index=True, how="left")
H_.to_pickle("Hroll.pkl"); print(len(H_), "position-checks;", H_.sym.nunique(), "symbols;", H_.groupby(["sym", "entry"]).ngroups, "positions")
