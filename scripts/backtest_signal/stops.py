import pandas as pd, numpy as np
P = pd.read_pickle("prices.pkl")
F = pd.read_pickle("F.pkl").sort_values(["sym", "date"]).set_index(["sym", "date"])
F["per"] = np.where(F.index.get_level_values(1) < pd.Timestamp("2015"), "IS", "OOS")
for h in ("fwd20", "fwd60"): F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
g = F.groupby(level=0)
prev_low20 = (F.px / (1 + F.ret5 * 0)).groupby(level=0).transform(lambda x: x.shift(1).rolling(20).min())   # prior 20 closes' min
F["brk20"] = (F.px < prev_low20 * 0.99)
F["brk50"] = (F.d_ma50 < 0) & (g.d_ma50.shift(1) >= 0)
F["brk200"] = (F.d_ma200 < 0) & (g.d_ma200.shift(1) >= 0)
for k in ("brk20", "brk50", "brk200"):
    for fear in (False, True):
        m = F[k] & ((F.vix_pct >= .8) == fear)
        D = F[m].dropna(subset=["fwd20"])
        t = D.groupby("per").agg(n=("fwd20", "size"), x20=("fwd20x", "mean"), x60=("fwd60x", "mean"),
                                 hit=("fwd20", lambda x: (x > 0).mean()), mdd=("mdd20", "mean"))
        t[["x20", "x60", "hit", "mdd"]] = (t[["x20", "x60", "hit", "mdd"]] * 100).round(2)
        print(f"\n## close breaks {k} ({'market FEAR' if fear else 'market calm'})"); print(t.to_string())
