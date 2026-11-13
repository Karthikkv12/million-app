"""Simulated long-call P&L (Black-Scholes) on every symbol-day: theta, IV (modelled, incl. term structure and the
crush after fear) and time left all included. Entry = buy a call at target delta / DTE; exit after h trading days.
Conservative costs: entry IV + ENTRY_IV_PREM, bid-ask COST each way (fraction of the option price)."""
import pandas as pd, numpy as np, sys
I = pd.read_pickle("ividx.pkl"); P = pd.read_pickle("prices.pkl"); F = pd.read_pickle("F.pkl")
coef = np.load("ivcoef.npy"); KAPPA = float(np.load("kappa.npy")[0])
def norm(s):
    s = s.copy(); s.index = (s.index.tz_localize(None) if s.index.tz is not None else s.index).normalize(); return s
vix = norm(I["^VIX"]); vrel = vix / vix.rolling(252).median()
rate = (norm(I["^IRX"]) / 100).clip(lower=0)
def erf(x):                                   # Abramowitz–Stegun 7.1.26, |err| < 1.5e-7
    s = np.sign(x); x = np.abs(x); t = 1 / (1 + 0.3275911 * x)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return s * y
N = lambda x: 0.5 * (1 + erf(x / np.sqrt(2)))
def call(S, K, T, r, v):
    T = np.maximum(T, 1e-6); sq = v * np.sqrt(T)
    d1 = (np.log(S / K) + (r + v * v / 2) * T) / sq
    return S * N(d1) - K * np.exp(-r * T) * N(d1 - sq)
g = lambda T: (1 - np.exp(-KAPPA * T)) / (KAPPA * T)
def ivT(iv30, theta, T):                      # long-dated IV from 30-day IV (mean-reverting term structure)
    return theta + (iv30 - theta) * g(np.maximum(T, 1 / 12)) / g(1 / 12)
ZD = {0.6: 0.253347, 0.7: 0.524401, 0.8: 0.841621}   # N^-1(delta)
rows = []
for s in P.index.get_level_values(0).unique():
    d = P.loc[s]; d = d[(d.Close > 0)]; d.index = (d.index.tz_localize(None) if d.index.tz is not None else d.index).normalize()
    c = d.Close; lr = np.log(c).diff()
    hv = {n: lr.rolling(n).std() * np.sqrt(252) for n in (20, 60, 252)}
    iv30 = np.exp(coef[0] + coef[1] * np.log(hv[20]) + coef[2] * np.log(hv[60]) + coef[3] * np.log(hv[252]) + coef[4] * np.log(vrel.reindex(c.index).ffill()))
    theta = iv30.rolling(1260, min_periods=252).mean()
    r = rate.reindex(c.index).ffill()
    df = pd.DataFrame({"S": c, "iv30": iv30, "theta": theta, "r": r})
    for h in (20, 60):
        df[f"S{h}"], df[f"iv30_{h}"], df[f"theta{h}"], df[f"r{h}"] = c.shift(-h), iv30.shift(-h), theta.shift(-h), r.shift(-h)
    df["sym"] = s; rows.append(df)
O = pd.concat(rows).reset_index().rename(columns={"index": "date", "Date": "date"})
O = O.merge(F[["sym", "date", "rsi14", "vix_pct", "d_ma50", "dd52", "fwd20", "fwd60"]], on=["sym", "date"], how="inner")
O = O.dropna(subset=["iv30", "theta", "r"])
O["per"] = np.where(O.date < "2015", "IS", "OOS")
res = {}
for D in (90, 180, 365, 540):
    for dl in (0.7, 0.8):
        T = D / 365
        for prem, cost in (("base", (0.0, 0.01)), ("stress", (0.05, 0.02))):
            ivp, k = cost
            v0 = ivT(O.iv30, O.theta, T) + ivp                 # pay up on entry IV (e.g. earnings premium)
            K = O.S * np.exp(-(ZD[dl] * v0 * np.sqrt(T)) + (O.r + v0 ** 2 / 2) * T)
            p0 = call(O.S, K, T, O.r, v0) * (1 + k)
            for h in (20, 60):
                T1 = T - h / 252
                if T1 <= 0.02: continue
                v1 = ivT(O[f"iv30_{h}"], O[f"theta{h}"], T1)
                p1 = call(O[f"S{h}"], K, T1, O[f"r{h}"], v1) * (1 - k)
                O[f"o_{D}_{dl}_{prem}_{h}"] = p1 / p0 - 1
                if prem == "base":                                       # pure decay: same price, same IV
                    O[f"th_{D}_{dl}_{h}"] = call(O.S, K, T1, O.r, ivT(O.iv30, O.theta, T1)) / (p0 / (1 + k)) - 1
O.to_pickle("O.pkl")
print(len(O), "symbol-days simulated;", O.sym.nunique(), "symbols;", sum(c.startswith("o_") for c in O.columns), "option configs")
