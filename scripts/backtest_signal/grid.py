import pandas as pd, numpy as np, itertools
F = pd.read_pickle("F.pkl")
F["per"] = np.where(F.date < "2015", "IS", "OOS")
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
F = F[F.fwd20.notna()]
F["mon"] = F.date.dt.to_period("M")
def tstat(D, col):            # cluster by month: average the rule's excess per month, t over months
    m = D.groupby("mon")[col].mean()
    return m.mean() / (m.std(ddof=1) / np.sqrt(len(m))) if len(m) > 5 else np.nan, len(m)
res = []
tried = 0
for dip_feat, dips in (("d_ma50", [-.03, -.05, -.08, -.10, -.15]), ("dd52", [-.10, -.15, -.20, -.30]), ("rsi14", [40, 35, 30, 25])):
    for a, b in itertools.product(dips, [.6, .7, .8, .9]):
        tried += 1
        dip = F[dip_feat] < a if dip_feat == "rsi14" else F[dip_feat] <= a
        for side, m in (("ADD", dip & (F.vix_pct >= b)), ("KNIFE", dip & (F.vix_pct < b))):
            for per in ("IS", "OOS"):
                D = F[m & (F.per == per)]
                t20, nm = tstat(D, "fwd20x"); t60, _ = tstat(D, "fwd60x")
                res.append((side, dip_feat, a, b, per, len(D), D.fwd20x.mean()*100, D.fwd60x.mean()*100, (D.fwd20 > 0).mean()*100, t20, t60, nm))
R = pd.DataFrame(res, columns=["side","feat","dip","vix","per","n","x20","x60","hit","t20","t60","months"])
W = R.pivot_table(index=["side","feat","dip","vix"], columns="per", values=["n","x20","x60","hit","t20","t60"]).round(2)
W.columns = [f"{a}_{b}" for a, b in W.columns]
print("combos tried:", tried, "(×2 sides)")
for side in ("ADD", "KNIFE"):
    S = W.loc[side].copy()
    key = "t20_IS" if side == "ADD" else "t60_IS"
    S = S.sort_values(key, ascending=(side == "KNIFE"))
    print(f"\n### {side}: top 10 chosen on IN-SAMPLE ({key}), with their OUT-OF-SAMPLE result")
    print(S[["n_IS","x20_IS","x60_IS","hit_IS","t20_IS","t60_IS","n_OOS","x20_OOS","x60_OOS","hit_OOS","t20_OOS","t60_OOS"]].head(10).to_string())
R.to_pickle("grid.pkl")
