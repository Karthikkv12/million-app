import pandas as pd, numpy as np, json
O = pd.read_pickle("O.pkl"); O["mon"] = O.date.dt.to_period("M"); O["ivr"] = O.iv30 / O.theta
add = (O.rsi14 < 40) & (O.vix_pct >= .8); gated = add & (O.ivr >= 1.2)
spy = O[O.sym == "SPY"].set_index("date").vix_pct >= .8
ep = (spy & ~spy.shift(1, fill_value=False)).cumsum()[spy]
out = {}
for lab, m in (("ADD", add), ("ADD gated (IV ≥1.2× normal)", gated), ("fear dip, IV normal", add & (O.ivr < 1.2))):
    for col in ("o_365_0.8_stress_60", "o_365_0.8_stress_20", "fwd60"):
        x = O[col] - O.groupby(["sym", "per"])[col].transform("mean")
        D = O[m & O[col].notna()].assign(x=x)
        yrs = D.groupby(D.date.dt.year).x.mean()
        e = D.assign(ep=D.date.map(ep)).dropna(subset=["ep"]).groupby("ep").x.mean()
        s = {per: dict(n=int((D.per == per).sum()), ret=round(D[D.per == per][col].mean()*100, 2), x=round(D[D.per == per].x.mean()*100, 2),
                       hit=round((D[D.per == per][col] > 0).mean()*100, 1)) for per in ("IS", "OOS")}
        out[f"{lab}|{col}"] = dict(s, years_pos=f"{(yrs > 0).sum()}/{len(yrs)}", episodes_pos=f"{(e > 0).sum()}/{len(e)}")
        print(f"{lab:28s} {col:22s} IS {s['IS']} | OOS {s['OOS']} | years+ {(yrs>0).sum()}/{len(yrs)} | episodes+ {(e>0).sum()}/{len(e)}")
json.dump(out, open("optfinal.json", "w"), indent=1)
