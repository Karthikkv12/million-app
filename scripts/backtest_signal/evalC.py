import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl")
F["per"] = np.where(F.date < "2015", "IS", "OOS")
# excess vs just holding that stock in the same period
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
def buck(col, bins, labels):
    F["b"] = pd.cut(F[col], bins, labels=labels)
    t = F.groupby(["b", "per"], observed=True).agg(n=("fwd20", "size"), f20=("fwd20", "mean"), x20=("fwd20x", "mean"),
                                                   x60=("fwd60x", "mean"), hit=("fwd20", lambda x: (x > 0).mean()),
                                                   mdd=("mdd20", "mean")).unstack("per")
    for c in ("f20", "x20", "x60", "hit", "mdd"): t[c] = (t[c] * 100).round(2)
    print(f"\n### {col}"); print(t.to_string())
buck("dd52", [-1, -.5, -.35, -.25, -.15, -.08, -.03, 0.001], ["<-50", "-50/-35", "-35/-25", "-25/-15", "-15/-8", "-8/-3", "-3/0"])
buck("d_ma50", [-1, -.15, -.08, -.03, 0, .03, .08, .15, 5], ["<-15", "-15/-8", "-8/-3", "-3/0", "0/3", "3/8", "8/15", ">15"])
buck("vix_pct", [-.01, .2, .4, .6, .8, .9, 1.01], ["<20", "20-40", "40-60", "60-80", "80-90", ">90"])
buck("rsi14", [0, 25, 35, 45, 55, 65, 75, 100], ["<25", "25-35", "35-45", "45-55", "55-65", "65-75", ">75"])
buck("p_score", [-101, -50, -25, 0, 25, 50, 101], ["<-50", "-50/-25", "-25/0", "0/25", "25/50", ">50"])
