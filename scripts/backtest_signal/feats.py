"""Point-in-time features per symbol-day (only data up to the close of day t) + forward returns."""
import numpy as np, pandas as pd

def clip(x, lo=-1, hi=1): return np.clip(x, lo, hi)

def rsi_sma(c, n=14):                       # the production RSI: simple averages over n changes
    d = c.diff(); up = d.clip(lower=0).rolling(n).mean(); dn = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))

def one(d, spy, vix):
    c, v, h, l = d.Close, d.Volume.astype(float), d.High, d.Low
    f = pd.DataFrame(index=d.index)
    r1 = c.pct_change()
    m20, m50, m100, m200 = (c.rolling(n).mean() for n in (20, 50, 100, 200))
    # ── production reads (signal.py), vectorised ──
    parts = [clip((c/m20-1)/0.04), clip((c/m50-1)/0.08), clip((c/m200-1)/0.15), np.where(m50 >= m200, 0.6, -0.6)]
    f["p_trend"] = sum(parts) / 4
    base = v.shift(1).rolling(20).mean()
    rv = v / base
    direction = np.sign(r1.where(r1.abs() > 0.001, 0))
    heavy = clip(rv - 1, 0, 1)
    obv = (np.sign(r1) * v).rolling(20).sum()
    f["p_volume"] = clip(0.6 * direction * heavy + 0.4 * clip(obv / (base * 10)))
    r = rsi_sma(c)
    s = np.select([r >= 75, r >= 60, r >= 45, r >= 30], [-0.4, 0.6, (r - 52.5) / 15, -0.6], 0.3)
    roc20 = c / c.shift(20) - 1
    f["p_momentum"] = clip(0.7 * s + 0.3 * clip(roc20 / 0.10))
    f["p_score"] = 100 * (20 * f.p_trend + 15 * f.p_volume + 10 * f.p_momentum) / 45
    # ── research features ──
    for n, m in ((20, m20), (50, m50), (100, m100), (200, m200)): f[f"d_ma{n}"] = c / m - 1
    f["ma50_200"] = m50 / m200 - 1
    f["slope200"] = m200 / m200.shift(63) - 1
    for n in (5, 20, 60, 120, 252): f[f"ret{n}"] = c / c.shift(n) - 1
    f["mom12_1"] = c.shift(21) / c.shift(252) - 1
    f["rsi14"] = r
    f["rsi2"] = rsi_sma(c, 2)
    f["rv"] = rv
    f["obv20"] = obv / (base * 20)
    f["upvol20"] = (v.where(r1 > 0, 0)).rolling(20).sum() / v.rolling(20).sum()
    lr = np.log(c).diff()
    hv20, hv60 = lr.rolling(20).std() * np.sqrt(252), lr.rolling(60).std() * np.sqrt(252)
    f["hv20"] = hv20; f["hv_ratio"] = hv20 / hv60
    f["hv_pct"] = hv20.rolling(252).rank(pct=True)
    f["dd52"] = c / c.rolling(252).max() - 1
    f["up52"] = c / c.rolling(252).min() - 1
    hh, ll = h.rolling(20).max(), l.rolling(20).min()
    f["stoch20"] = (c - ll) / (hh - ll)
    sp = spy.reindex(d.index).ffill()
    f["rs60"] = f.ret60 - (sp / sp.shift(60) - 1)
    f["rs120"] = f.ret120 - (sp / sp.shift(120) - 1)
    f["spy_trend"] = sp / sp.rolling(200).mean() - 1
    vx = vix.reindex(d.index).ffill()
    f["vix"] = vx; f["vix_rel"] = vx / vx.rolling(20).mean() - 1
    f["vix_pct"] = vx.rolling(252).rank(pct=True)
    f["dollar_vol"] = np.log((c * v).rolling(20).mean())
    # ── forward (close t → close t+h), and max drawdown over the next 20 ──
    for hzn in (5, 10, 20, 60): f[f"fwd{hzn}"] = c.shift(-hzn) / c - 1
    f["fwd20_open"] = c.shift(-21) / d.Open.shift(-1) - 1           # enter next open (no same-close fill)
    fut_min = l[::-1].rolling(20).min()[::-1].shift(-1)
    f["mdd20"] = fut_min / c - 1
    f["px"] = c; f["vol_t"] = v
    return f

def build():
    P = pd.read_pickle("prices.pkl"); vix = pd.read_pickle("vix.pkl")
    vix = vix.iloc[:, 0] if isinstance(vix, pd.DataFrame) else vix
    spy = P.loc["SPY"].Close
    out = []
    for s in P.index.get_level_values(0).unique():
        d = P.loc[s]; d = d[(d.Close > 0) & (d.Volume > 0)]
        if len(d) < 300: continue
        f = one(d, spy, vix); f["sym"] = s; out.append(f)
    F = pd.concat(out).reset_index().rename(columns={"index": "date", "Date": "date"})
    F = F[F.date >= "1995-01-01"]
    F = F.dropna(subset=["d_ma200", "ret252", "hv_pct"])   # need a full year of history first
    F.to_pickle("F.pkl"); return F

if __name__ == "__main__":
    F = build()
    print(len(F), F.sym.nunique(), F.date.min(), F.date.max())
