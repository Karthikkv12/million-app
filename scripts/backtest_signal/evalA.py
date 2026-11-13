import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl")
F["etf"] = F.sym.isin("SPY QQQ IWM DIA XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT KRE".split())
F["verdict"] = np.select([F.p_score >= 25, F.p_score <= -25], ["ADD", "TRIM"], "HOLD")
H = ["fwd5", "fwd10", "fwd20", "fwd60"]
def table(D, by):
    g = D.groupby(by)
    t = g[H].mean().mul(100).round(2)
    t["hit20"] = g.fwd20.apply(lambda x: (x > 0).mean()).mul(100).round(1)
    t["mdd20"] = g.mdd20.mean().mul(100).round(2)
    t["n"] = g.size()
    return t
for name, D in [("ALL 1995-2026", F), ("IN-SAMPLE 1995-2014", F[F.date < "2015"]), ("OUT-OF-SAMPLE 2015-2026", F[F.date >= "2015"])]:
    print(f"\n== {name}: {len(D):,} symbol-days; baseline fwd20 {D.fwd20.mean()*100:.2f}%, hit {(D.fwd20>0).mean()*100:.1f}%")
    print(table(D, "verdict"))
F["dec"] = F.groupby("date").p_score.transform(lambda x: pd.qcut(x.rank(method="first"), 10, labels=False) if len(x) >= 20 else np.nan)
print("\n== score decile (cross-section per day) → fwd20 / fwd60 %")
print(F.groupby("dec")[["fwd20", "fwd60"]].mean().mul(100).round(2).T)
# per-year rank IC (time-pooled within year)
ic = F.dropna(subset=["fwd20"]).groupby(F.date.dt.year).apply(lambda x: x.p_score.corr(x.fwd20, method="spearman"))
print("\n== yearly Spearman IC p_score→fwd20:", (ic > 0).sum(), "of", len(ic), "years positive; mean", round(ic.mean(), 4))
print(ic.round(3).to_string())
