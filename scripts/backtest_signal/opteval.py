import pandas as pd, numpy as np
O = pd.read_pickle("O.pkl"); O["mon"] = O.date.dt.to_period("M")
add = (O.rsi14 < 40) & (O.vix_pct >= .8)
calm = O.vix_pct < .6
cau = calm & ((O.dd52 <= -.10) | (O.d_ma50.between(.03, .15) & (O.rsi14 > 65)))
def t_month(x, mon):
    m = x.groupby(mon).mean(); return m.mean() / (m.std() / np.sqrt(len(m)))
rows = []
for col in [c for c in O.columns if c.startswith("o_")]:
    _, D, dl, prem, h = col.split("_")
    base = O.groupby(["sym", "per"])[col].transform("mean")
    x = O[col] - base
    for name, m in (("ADD", add), ("CAUTION", cau), ("ALL", O[col].notna())):
        for per in ("IS", "OOS"):
            mm = m & (O.per == per) & O[col].notna()
            rows.append((int(D), float(dl), prem, int(h), name, per, int(mm.sum()), O.loc[mm, col].mean() * 100, x[mm].mean() * 100,
                         (O.loc[mm, col] > 0).mean() * 100, O.loc[mm, col].quantile(.1) * 100, t_month(x[mm], O.mon[mm]) if name != "ALL" else np.nan))
R = pd.DataFrame(rows, columns=["DTE", "delta", "cost", "h", "set", "per", "n", "ret%", "excess%", "hit%", "p10%", "t"])
R.to_pickle("optR.pkl")
pd.set_option("display.width", 200)
for h in (20, 60):
    S = R[(R.h == h) & (R.set.isin(["ADD", "ALL"]))].pivot_table(index=["cost", "DTE", "delta"], columns=["set", "per"], values=["ret%", "excess%", "hit%", "t"]).round(2)
    cols = [("ret%", "ALL", "OOS"), ("ret%", "ADD", "IS"), ("ret%", "ADD", "OOS"), ("excess%", "ADD", "IS"), ("excess%", "ADD", "OOS"),
            ("hit%", "ADD", "OOS"), ("t", "ADD", "IS"), ("t", "ADD", "OOS")]
    print(f"\n### hold {h} trading days — option return on premium (ALL = every day, ADD = fear-dip days)"); print(S[cols].to_string())
th = {c: O[c].mean() * 100 for c in O.columns if c.startswith("th_")}
print("\n### pure time decay (price & IV unchanged), % of premium lost:"); print({k: round(v, 1) for k, v in th.items()})
