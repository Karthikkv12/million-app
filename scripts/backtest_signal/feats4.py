"""Round 4 features: like feats.py, but back to 1963 and on 265 symbols (fetch4 list), with a fear gauge before the VIX.

The gauge: the VIX's 1-year percentile where the VIX exists (1991+); before that, the percentile of a modeled VIX,
log VIX ≈ c + a·log RV5 + b·log RV20 + d·log RV60 + e·(drawdown from the 20-day high) + f·(drawdown from the 60-day
high) + g·(5-day return) of the S&P 500 (^GSPC, from 1927). Fit on 1990–2014 (gauge_fit()), checked on 2015–2026:
R² 0.87 / 0.72 on log VIX, percentile correlation 0.78 / 0.82, same side of the 80th percentile 88% of days.
Foreign indexes (^N225, ^FTSE, …) get the same model on their OWN index: their crises are their own.

python feats4.py  (prices.pkl from fetch.py + fetch4, vix.pkl) → F.pkl (float32), gauge.pkl
"""
import numpy as np, pandas as pd
from feats import one

FOREIGN = {"^N225", "^FTSE", "^GDAXI", "^FCHI", "^HSI", "^AXJO", "^GSPTSE", "^BVSP", "^KS11", "^TWII"}
COLS = ["rv5", "rv20", "rv60", "dd20", "dd60", "r5"]


def gauge_x(c):
    lr = np.log(c).diff()
    return pd.DataFrame({"rv5": np.log(lr.rolling(5).std() * np.sqrt(252)), "rv20": np.log(lr.rolling(20).std() * np.sqrt(252)),
                         "rv60": np.log(lr.rolling(60).std() * np.sqrt(252)), "dd20": c / c.rolling(20).max() - 1,
                         "dd60": c / c.rolling(60).max() - 1, "r5": c.pct_change(5)})


def gauge_fit(gspc, vix):
    X = gauge_x(gspc); d = pd.concat([X, np.log(vix).reindex(X.index).rename("y")], axis=1).dropna()
    tr = d[d.index < "2015"]
    return np.linalg.lstsq(np.c_[np.ones(len(tr)), tr[COLS].values], tr.y.values, rcond=None)[0]


def gauge_pct(c, b):
    X = gauge_x(c)
    return pd.Series(np.c_[np.ones(len(X)), X[COLS].values] @ b, index=X.index).rolling(252).rank(pct=True)


def build():
    P = pd.read_pickle("prices.pkl"); vix = pd.read_pickle("vix.pkl")
    vix = vix.iloc[:, 0] if isinstance(vix, pd.DataFrame) else vix
    vix.index = pd.to_datetime(vix.index)
    g = P.loc["^GSPC"].Close; g.index = pd.to_datetime(g.index)
    b = gauge_fit(g, vix)
    vp = vix.rolling(252).rank(pct=True)
    us = gauge_pct(g, b)
    us_gauge = vp.reindex(us.index).combine_first(us)            # real VIX where it has a year of history
    src = pd.Series(np.where(vp.reindex(us.index).notna(), "vix", "model"), index=us.index)
    pd.DataFrame({"gauge": us_gauge, "src": src}).to_pickle("gauge.pkl")
    out = []
    for s in P.index.get_level_values(0).unique():
        d = P.loc[s].copy(); d.index = pd.to_datetime(d.index)
        d = d[d.Close > 0]
        if s.startswith("^"):
            d["Volume"] = d.Volume.where(d.Volume > 0, 1.0)          # indexes: no volume (unused by the signals)
        else:
            d = d[d.Volume > 0]
        if len(d) < 300:
            continue
        f = one(d, g, vix)
        f["vix_pct"] = (gauge_pct(d.Close, b) if s in FOREIGN else us_gauge).reindex(d.index).values
        f["gauge_src"] = "own" if s in FOREIGN else src.reindex(d.index).values
        f = f.drop(columns=["p_trend", "p_volume", "p_momentum", "p_score", "vix", "vix_rel"], errors="ignore")
        f["sym"] = s
        out.append(f.astype({c: "float32" for c in f.columns if f[c].dtype == "float64"}))
    F = pd.concat(out).reset_index().rename(columns={"index": "date", "Date": "date"})
    F = F[F.date >= "1963-01-01"].dropna(subset=["d_ma200", "ret252", "hv_pct", "vix_pct"])
    F.to_pickle("F.pkl"); return F


if __name__ == "__main__":
    F = build()
    print(len(F), F.sym.nunique(), F.date.min(), F.date.max(), F.gauge_src.value_counts().to_dict())
