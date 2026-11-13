import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl")
F["per"] = np.where(F.date < "2015", "IS", "OOS")
for h in ("fwd20", "fwd60"): F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
F["rb"] = 100 * (np.clip(F.vix_pct * 2 - 1, -1, 1) + np.clip((50 - F.rsi14) / 25, -1, 1) + np.clip(-F.d_ma50 / 0.15, -1, 1)) / 3
F["b"] = pd.cut(F.rb, [-101, -50, -25, 0, 25, 50, 101], labels=["<-50", "-50/-25", "-25/0", "0/25", "25/50", ">50"])
t = F.dropna(subset=["fwd20"]).groupby(["b", "per"], observed=True).agg(n=("fwd20", "size"), x20=("fwd20x", "mean"), x60=("fwd60x", "mean"),
      hit=("fwd20", lambda x: (x > 0).mean()), mdd=("mdd20", "mean")).unstack("per")
for c in ("x20", "x60", "hit", "mdd"): t[c] = (t[c] * 100).round(2)
print(t.to_string())
yrs = F[F.rb >= 25].dropna(subset=["fwd20"]).groupby(F.date.dt.year).fwd20x.mean()
print("rebound ≥25: excess>0 in", (yrs > 0).sum(), "of", len(yrs), "years")
