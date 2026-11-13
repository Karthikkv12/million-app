import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl")
F["per"] = np.where(F.date < "2015", "IS", "OOS")
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
ETF = "SPY QQQ IWM DIA XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT KRE".split()
mdd_all = F.groupby("sym").dd52.min()
CRASHED = set(mdd_all[mdd_all <= -0.70].index) - set(ETF)
F["grp"] = np.where(F.sym.isin(ETF), "ETF", np.where(F.sym.isin(CRASHED), "CRASHED", "OTHER"))
print("crashed (≥70% fall at some point):", len(CRASHED), "symbols")
fear, calm = F.vix_pct >= .9, F.vix_pct < .6
up = F.d_ma200 > 0
rules = {
 "fear (VIX ≥90th pct)": fear,
 "dip: ≤-8% under 50d": F.d_ma50 <= -.08,
 "deep dip: ≤-15% under 50d": F.d_ma50 <= -.15,
 "oversold: RSI<30": F.rsi14 < 30,
 "dip & fear": (F.d_ma50 <= -.08) & fear,
 "dip & calm market (stock-specific)": (F.d_ma50 <= -.08) & calm,
 "dip & long uptrend (>200d)": (F.d_ma50 <= -.08) & up,
 "dip & long downtrend (<200d)": (F.d_ma50 <= -.08) & ~up,
 "dip in uptrend & fear": (F.d_ma50 <= -.05) & up & (F.vix_pct >= .8),
 "extended ≥15% over 50d": F.d_ma50 >= .15,
 "calm & extended 3-15% & RSI>65": calm & F.d_ma50.between(.03, .15) & (F.rsi14 > 65),
 "below 200d & SPY below 200d": ~up & (F.spy_trend < 0),
 "ALL DAYS": F.fwd20.notna(),
}
def stats(m):
    D = F[m & F.fwd20.notna()]
    g = D.groupby("per")
    r = pd.DataFrame({"n": g.size(), "x20": g.fwd20x.mean()*100, "x60": g.fwd60x.mean()*100, "f20": g.fwd20.mean()*100,
                      "hit": g.fwd20.apply(lambda x: (x>0).mean())*100, "mdd": g.mdd20.mean()*100}).round(2)
    yrs = D.groupby(D.date.dt.year).fwd20x.mean()
    by = D.groupby("grp").fwd20x.mean()*100
    return r, (yrs > 0).sum(), len(yrs), by.round(2), D.sym.nunique(), D.date.dt.date.nunique()
for k, m in rules.items():
    r, yp, yn, by, ns, nd = stats(m)
    print(f"\n## {k}   [{ns} symbols, {nd:,} distinct days; excess>0 in {yp}/{yn} years]  by group x20: {by.to_dict()}")
    print(r.to_string())
