import pandas as pd, numpy as np
H = pd.read_pickle("H.pkl"); H["per"] = np.where(H.date < "2015", "IS", "OOS"); H["mon"] = H.date.dt.to_period("M")
H["x"] = H.hold60 - H.groupby(["sym", "per"]).hold60.transform("mean")
F = pd.read_pickle("F.pkl"); F["per"] = np.where(F.date < "2015", "IS", "OOS")
F["fwd60x"] = F.fwd60 - F.groupby(["sym", "per"]).fwd60.transform("mean")
H = H.merge(F[["sym", "date", "fwd60x"]], on=["sym", "date"], how="left")
bins = [-1.01, -.5, -.25, 0, .25, .5, 1, 2, 99]; labs = ["<-50%", "-50/-25", "-25/0", "0/+25", "+25/+50", "+50/+100", "+100/+200", ">+200%"]
H["b"] = pd.cut(H.pnl, bins, labels=labs)
def t(x, mon):
    m = x.groupby(mon).mean(); return m.mean() / (m.std() / np.sqrt(len(m))) if len(m) > 5 else np.nan
print("### 1. Next 60 days, by the position's P&L (excess = vs the average check on that stock and period)")
rows = []
for b in labs:
    for per in ("IS", "OOS"):
        D = H[(H.b == b) & (H.per == per)]
        rows.append((b, per, len(D), D.hold60.mean()*100, D.x.mean()*100, t(D.x, D.mon), D.fwd60x.mean()*100, D.delta.mean(), D.tv_share.mean()*100))
R = pd.DataFrame(rows, columns=["pnl", "per", "n", "call_ret%", "call_excess%", "t", "stock_excess%", "delta", "time_value%"]).round(2)
print(R.pivot(index="pnl", columns="per").reindex(labs)[["n", "call_excess%", "t", "stock_excess%", "delta", "time_value%"]].to_string())
print("\n### 2. Does P&L change the fear-dip edge? stock 60d excess (OOS) by P&L, fear dip vs not")
H["fear"] = (H.rsi14 < 40) & (H.vix_pct >= .8)
print(H[H.per == "OOS"].groupby(["b", "fear"], observed=True).agg(n=("x", "size"), stock_x=("fwd60x", "mean"), call_x=("x", "mean")).mul([1, 100, 100]).round(2).unstack("fear").to_string())
print("\n### 3. Delta-matched roll into a fresh 365d 0.80Δ call (difference banked) vs holding, next 60 days")
for cost in (0.01, 0.02):
    H["roll60"] = (H.pt * (1 - cost) - H.q * H.pn * (1 + cost) + H.q * H.pnf) / H.pt - 1
    H["adv"] = H.roll60 - H.hold60
    out = []
    for b in labs:
        for per in ("IS", "OOS"):
            D = H[(H.b == b) & (H.per == per)]
            out.append((b, per, len(D), D.adv.mean()*100, (D.adv > 0).mean()*100, D.hold60.quantile(.05)*100, D.roll60.quantile(.05)*100,
                        D.hold60.std()*100, D.roll60.std()*100, t(D.adv, D.mon)))
    Q = pd.DataFrame(out, columns=["pnl", "per", "n", "roll_minus_hold%", "roll_better%", "hold_p5%", "roll_p5%", "hold_sd%", "roll_sd%", "t"]).round(2)
    print(f"\n-- costs {cost:.0%} each way"); print(Q.pivot(index="pnl", columns="per").reindex(labs)[["roll_minus_hold%", "t", "roll_better%", "hold_p5%", "roll_p5%", "hold_sd%", "roll_sd%"]].to_string())
H.to_pickle("H2.pkl")
