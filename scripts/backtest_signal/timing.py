"""The Add / Hold / Caution / Exit read as an ENTRY / EXIT TIMING signal, rules FROZEN (2026-11-14, owner).

Nothing is re-fit: the verdicts below are hedge.signal.evaluate()'s for a long holder, with its constants
(SCORE_CUT 0.283, CALM_VIX 0.60, KNIFE_DD −10%, stretched 3–15% over the 50-day with RSI > 65, Exit = a calm close
under the 200-day). "Trim" in the app is the take-profit on puts / short calls on fear-dip days; for a long holder the
sell side is EXIT (and CAUTION = don't add), so those are what "Trim" is measured as here.

Data: round 4 (fetch.py + feats4.py): 265 symbols, 1963-01 → 2026-11, modeled VIX before 1991, foreign indexes on
their own gauge. Rules were chosen on the original 148 names in 1995–2014; everything else is out of sample:
1963–1994, 2015–2026, and the 117 names / new sectors added in rounds 3 and 4 in every year.

1. Forward returns 5 / 20 / 60 / 120 days (close → close), mean and median, vs a random day in the same stock and era.
2. Path: max adverse excursion after Add (intraday lows), stop levels (chosen on the in-sample block, read on the rest);
   drawdown after Exit vs a random day, and the Exit rule as a switch (out while Exit, back when it clears) vs holding.
3. Backdrop: S&P 500 vs its 200-day, VIX level, 10-year yield rising / falling (6 months), NBER recession or not.
4. Sector and era (1963–79, 1980–94, 1995–2002, 2003–14, 2015–26), in-sample cells marked.
5. Decay: excess by year, rolling 5 years, and the trend.

python timing.py  (in the round-4 folder: prices.pkl, F.pkl, vix.pkl, vix_model.pkl, tnx.pkl) → timing.json
"""
import json
import numpy as np, pandas as pd
from sectors import SECTOR, ORIGINAL148 as OLD148

H = (5, 20, 60, 120)
ERAS = [("1963–1979", "1963", "1980"), ("1980–1994", "1980", "1995"), ("1995–2002", "1995", "2003"),
        ("2003–2014", "2003", "2015"), ("2015–2026", "2015", "2100")]
RECESSIONS = [("1969-12", "1970-11"), ("1973-11", "1975-03"), ("1980-01", "1980-07"), ("1981-07", "1982-11"),
              ("1990-07", "1991-03"), ("2001-03", "2001-11"), ("2007-12", "2009-06"), ("2020-02", "2020-04")]
COST = 0.001                     # per switch, for the Exit-as-a-switch test


def era_of(d):
    out = np.empty(len(d), dtype=object)
    for name, a, b in ERAS:
        out[(d >= a) & (d < b)] = name
    return out


def build():
    P = pd.read_pickle("prices.pkl")
    F = pd.read_pickle("F.pkl")[["sym", "date", "vix_pct", "rsi14", "dd52", "d_ma50", "d_ma200"]]
    F["date"] = pd.to_datetime(F["date"])
    rows = []
    for s, d in P.groupby(level=0):
        d = d.droplevel(0); d.index = pd.to_datetime(d.index)
        d = d[d.Close > 0]
        c, lo = d.Close.values.astype(float), d.Low.where(d.Low > 0, d.Close).values.astype(float)
        n = len(c); f = pd.DataFrame({"date": d.index, "sym": s, "px": c})
        for h in H:
            f[f"fwd{h}"] = np.r_[c[h:] / c[:-h] - 1, np.full(h, np.nan)] if n > h else np.nan
        # path over the next 60 / 120 sessions: worst intraday low vs the close (MAE), worst close vs the close
        for h in (20, 60, 120):
            lw = pd.Series(lo[::-1]).rolling(h, min_periods=h).min().values[::-1]      # min low over t..t+h-1
            lw = np.r_[lw[1:], np.nan]                                                    # t+1..t+h
            f[f"mae{h}"] = lw / c - 1
            cw = pd.Series(c[::-1]).rolling(h, min_periods=h).min().values[::-1]
            f[f"worst{h}"] = np.r_[cw[1:], np.nan] / c - 1
        rows.append(f)
    X = pd.concat(rows, ignore_index=True).merge(F, on=["sym", "date"], how="inner")
    X = X.sort_values(["sym", "date"]).reset_index(drop=True)
    vp, r14 = X.vix_pct, X.rsi14
    X["score"] = np.clip((vp - .5) / .5, 0, 1) ** 1.5 * np.clip((50 - r14) / 30, 0, 1)
    add = X.score >= 0.283
    calm = vp < 0.60
    knife = calm & (X.dd52 <= -0.10)
    stretched = calm & (X.d_ma50 >= .03) & (X.d_ma50 <= .15) & (r14 > 65)
    X["verdict"] = np.where(add, "ADD", np.where(knife | stretched, "CAUTION", "HOLD"))
    X["exit"] = (~add) & calm & (X.d_ma200 < 0)                                  # the held-stock EXIT, every such day
    X["exit_fresh"] = X.exit & ~X.groupby("sym").exit.shift(1, fill_value=False)
    X["era"] = era_of(X.date)
    X["sector"] = X.sym.map(SECTOR)
    X["original"] = X.sym.isin(OLD148)
    X["insample"] = X.original & (X.date >= "1995") & (X.date < "2015")
    for h in H:                                                                  # vs a random day, same stock & era
        X[f"x{h}"] = X[f"fwd{h}"] - X.groupby(["sym", "era"])[f"fwd{h}"].transform("mean")
    for h in (60, 120):
        X[f"xworst{h}"] = X[f"worst{h}"] - X.groupby(["sym", "era"])[f"worst{h}"].transform("mean")
    # backdrop
    g = X[X.sym == "^GSPC"].set_index("date")
    spx = pd.read_pickle("prices.pkl").loc["^GSPC"].Close; spx.index = pd.to_datetime(spx.index)
    X["spx_above200"] = X.date.map((spx > spx.rolling(200).mean()).to_dict())
    vix = pd.read_pickle("vix.pkl"); vix = vix.iloc[:, 0] if isinstance(vix, pd.DataFrame) else vix
    vix.index = pd.to_datetime(vix.index)
    model = np.exp(pd.read_pickle("vix_model.pkl")); model.index = pd.to_datetime(model.index)
    lvl = vix.reindex(model.index).combine_first(model)
    X["vix_level"] = X.date.map(lvl.to_dict())
    tnx = pd.read_pickle("tnx.pkl"); tnx = tnx.iloc[:, 0] if isinstance(tnx, pd.DataFrame) else tnx
    tnx.index = pd.to_datetime(tnx.index); tnx = tnx.dropna()
    X["rates_rising"] = X.date.map((tnx - tnx.shift(126) > 0).to_dict())
    rec = pd.Series(False, index=pd.to_datetime(sorted(X.date.unique())))
    for a, b in RECESSIONS:
        rec[(rec.index >= a) & (rec.index < pd.Period(b, "M").end_time)] = True
    X["recession"] = X.date.map(rec.to_dict())
    del g
    return X


def summ(v, dates):
    """mean, median, month-clustered SE / t, n."""
    v = pd.Series(np.asarray(v, float)); d = pd.to_datetime(pd.Series(dates).values)
    ok = v.notna().values; v, d = v[ok].reset_index(drop=True), d[ok]
    if len(v) < 30:
        return None
    avg = v.mean(); mon = d.to_period("M")
    g = (v - avg).groupby(np.asarray(mon.astype(str))).sum()
    se = np.sqrt((g ** 2).sum()) / len(v) * np.sqrt(len(g) / max(len(g) - 1, 1))
    return {"n": int(len(v)), "months": int(len(g)), "mean": float(avg), "median": float(v.median()),
            "se": float(se), "t": float(avg / se) if se > 0 else None, "up": float((v > 0).mean())}


SIGNALS = {"Add": lambda X: X.verdict == "ADD", "Hold": lambda X: (X.verdict == "HOLD") & ~X.exit,
           "Caution (don't add)": lambda X: X.verdict == "CAUTION",
           "Exit (every calm day under the 200-day)": lambda X: X.exit,
           "Exit (fresh: first day)": lambda X: X.exit_fresh, "All days": lambda X: X.px.notna()}


def forward(X, mask):
    out = {}
    for h in H:
        D = X[mask]
        out[h] = {"raw": summ(D[f"fwd{h}"], D.date), "excess": summ(D[f"x{h}"], D.date),
                  "random_mean": float(D[f"fwd{h}"].mean() - D[f"x{h}"].mean()),        # the same stocks' era means
                  "random_median": float(X.loc[X.sym.isin(D.sym.unique()) & X.era.isin(D.era.unique()), f"fwd{h}"].median())}
    return out


def stops(X, mask, levels=(None, .10, .15, .20, .25, .30), h=60):
    """Each Add day held h sessions from its close, or stopped when the intraday low hits close × (1 − k): filled at the
    stop (gap-downs at the stop too: optimistic by the gap). Mean / median / win / worst 1 in 20, per block."""
    D = X[mask & X[f"fwd{h}"].notna()]
    res = {}
    for k in levels:
        r = D[f"fwd{h}"].values.copy()
        if k is not None:
            hit = D[f"mae{h}"].values <= -k
            r[hit] = -k
        s = pd.Series(r)
        res["none" if k is None else f"{int(k*100)}%"] = {
            "mean": float(s.mean()), "median": float(s.median()), "win": float((s > 0).mean()),
            "worst5": float(s.quantile(.05)), "stopped": float((D[f"mae{h}"].values <= -k).mean()) if k else 0.0,
            "t": (summ(r, D.date) or {}).get("t")}
    return res


def exit_switch(X, buffers=(0.0, 0.03, 0.05)):
    """Per stock: hold, step out at the close while the Exit rule is on (calm, close ≥ b under the 200-day, no Add),
    back in when it clears. Annual return and max drawdown vs holding, per era block (US stocks and ETFs)."""
    out = {}
    for b in buffers:
        rows = []
        for s, d in X[X.sector != "World indexes"].groupby("sym"):
            r = d.px.pct_change().fillna(0).values
            ex = (((d.vix_pct < 0.6) & (d.d_ma200 < -b) & (d.verdict != "ADD"))).values
            pos = np.r_[1.0, (~ex[:-1]).astype(float)]               # decided at the close, applied next day
            sw = np.abs(np.diff(np.r_[1.0, pos]))
            strat = pos * r - sw * COST
            for name, a, z in ERAS:
                m = ((d.date >= a) & (d.date < z)).values
                if m.sum() < 250:
                    continue
                def stats(x):
                    eq = np.cumprod(1 + x[m]); yrs = m.sum() / 252
                    return eq[-1] ** (1 / yrs) - 1, (eq / np.maximum.accumulate(eq) - 1).min()
                (ra, da), (rb, dbb) = stats(strat), stats(r)
                rows.append((s, name, ra, da, rb, dbb, 1 - pos[m].mean(), (sw[m] > 0).sum() / (m.sum() / 252)))
        T = pd.DataFrame(rows, columns=["sym", "era", "cagr", "maxdd", "cagr_hold", "maxdd_hold", "time_out", "switches_yr"])
        out[f"{b:.0%}"] = {e: {k: float(v) for k, v in T[T.era == e].drop(columns=["sym", "era"]).median().items()} | {"stocks": int((T.era == e).sum())}
                          for e, _, _ in ERAS}
    return out


def main():
    X = build()
    print(len(X), X.sym.nunique(), X.date.min(), X.date.max())
    X.to_pickle("timing_X.pkl")
    oos = ~X.insample
    out = {"rows": int(len(X)), "symbols": int(X.sym.nunique()), "signal_share": {}, "forward": {}, "path": {},
           "backdrop": {}, "sector": {}, "era": {}, "decay": {}}
    for k, f in SIGNALS.items():
        out["signal_share"][k] = float(f(X).mean())
    # 1. forward returns, out of sample and in sample
    for k, f in SIGNALS.items():
        out["forward"][k] = {"out_of_sample": forward(X, f(X) & oos), "in_sample": forward(X, f(X) & X.insample)}
    # 2. path
    add = SIGNALS["Add"](X)
    A = X[add & oos]
    q = lambda v: {f"p{p}": float(np.nanpercentile(v, p)) for p in (10, 25, 50, 75, 90, 95)}
    win60 = A[A.fwd60 > 0]
    out["path"]["add_mae"] = {"mae20": q(A.mae20), "mae60": q(A.mae60), "mae120": q(A.mae120),
                              "mae60_of_winners": q(win60.mae60), "share_winners_below": {
                                  f"{k}%": float((win60.mae60 <= -k / 100).mean()) for k in (5, 10, 15, 20, 25, 30)}}
    out["path"]["add_stops_in_sample"] = stops(X, add & X.insample)
    out["path"]["add_stops_out_of_sample"] = stops(X, add & oos)
    E = SIGNALS["Exit (fresh: first day)"](X)
    out["path"]["exit_worst"] = {lab: {f"worst{h}": summ(X.loc[m, f"worst{h}"], X.loc[m, "date"]) for h in (60, 120)}
                                 | {f"xworst{h}": summ(X.loc[m, f"xworst{h}"], X.loc[m, "date"]) for h in (60, 120)}
                                 for lab, m in (("Exit fresh, out of sample", E & oos), ("All days, out of sample", oos),
                                                ("Caution, out of sample", (X.verdict == "CAUTION") & oos))}
    out["path"]["exit_switch"] = exit_switch(X)
    # 3. backdrop (out of sample; 60-day excess)
    vb = pd.cut(X.vix_level, [0, 15, 20, 30, 1000], labels=["VIX < 15", "VIX 15–20", "VIX 20–30", "VIX ≥ 30"])
    BACK = {"S&P above its 200-day": X.spx_above200 == True, "S&P below its 200-day": X.spx_above200 == False,
            **{str(c): vb == c for c in vb.cat.categories},
            "10-yr yield rising (6 mo)": X.rates_rising == True, "10-yr yield falling (6 mo)": X.rates_rising == False,
            "Recession (NBER)": X.recession == True, "No recession": X.recession == False}
    for k in ("Add", "Caution (don't add)", "Exit (fresh: first day)", "Hold"):
        m = SIGNALS[k](X) & oos
        out["backdrop"][k] = {b: {h: summ(X.loc[m & bm, f"x{h}"], X.loc[m & bm, "date"]) for h in (20, 60)}
                              for b, bm in BACK.items()}
    # 4. sector and era
    for k in ("Add", "Caution (don't add)", "Exit (fresh: first day)"):
        m = SIGNALS[k](X)
        out["sector"][k] = {s: {"oos": summ(X.loc[m & oos & (X.sector == s), "x60"], X.loc[m & oos & (X.sector == s), "date"]),
                                "all": summ(X.loc[m & (X.sector == s), "x60"], X.loc[m & (X.sector == s), "date"])}
                            for s in sorted(X.sector.unique())}
        out["era"][k] = {e: {"original 148 names": summ(X.loc[m & (X.era == e) & X.original, "x60"], X.loc[m & (X.era == e) & X.original, "date"]),
                             "added names": summ(X.loc[m & (X.era == e) & ~X.original, "x60"], X.loc[m & (X.era == e) & ~X.original, "date"]),
                             "in_sample": e in ("1995–2002", "2003–2014")}
                         for e, _, _ in ERAS}
    # 5. decay: Add (and Caution / Exit) 60-day excess by year, all names
    for k in ("Add", "Caution (don't add)", "Exit (fresh: first day)"):
        m = SIGNALS[k](X) & X.x60.notna()
        D = X[m]
        yr = D.groupby(D.date.dt.year).agg(mean=("x60", "mean"), n=("x60", "size"))
        roll = {}
        for y0 in range(1965, 2023):
            w = D[(D.date.dt.year >= y0) & (D.date.dt.year < y0 + 5)]
            s = summ(w.x60, w.date)
            if s:
                roll[f"{y0}–{y0 + 4}"] = s
        # trend: yearly means weighted by months with a signal, slope per decade
        mon = D.groupby(D.date.dt.to_period("M")).x60.mean()
        t = np.array([p.year + (p.month - .5) / 12 for p in mon.index]); y = mon.values
        A_ = np.c_[np.ones(len(t)), t - 2000]; beta = np.linalg.lstsq(A_, y, rcond=None)[0]
        resid = y - A_ @ beta; cov = np.linalg.inv(A_.T @ A_) * resid.var(ddof=2)
        out["decay"][k] = {"by_year": {int(a): {"mean": float(b["mean"]), "n": int(b["n"])} for a, b in yr.iterrows()},
                           "rolling5": roll, "trend_per_decade": float(beta[1] * 10),
                           "trend_se": float(np.sqrt(cov[1, 1]) * 10), "months": int(len(mon))}

    def clean(o):
        if isinstance(o, dict): return {str(k): clean(v) for k, v in o.items()}
        if isinstance(o, (float, np.floating)): return None if not np.isfinite(o) else float(o)
        if isinstance(o, (np.integer,)): return int(o)
        if isinstance(o, (np.bool_,)): return bool(o)
        return o
    json.dump(clean(out), open("timing.json", "w"), indent=1)
    print("done")


if __name__ == "__main__":
    main()
