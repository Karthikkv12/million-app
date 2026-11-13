import pandas as pd, numpy as np
H = pd.read_pickle("H2.pkl")
H["p0"] = H.pt / (1 + H.pnl)
H["d_hold"] = (H.pf - H.pt) / H.p0                     # next-60-day P&L change, as a share of the original premium
H["xh"] = H.d_hold - H.groupby(["sym", "per"]).d_hold.transform("mean")
labs = ["<-50%", "-50/-25", "-25/0", "0/+25", "+25/+50", "+50/+100", "+100/+200", ">+200%"]
def t(x, mon):
    m = x.dropna().groupby(mon).mean(); return m.mean() / (m.std() / np.sqrt(len(m))) if len(m) > 5 else np.nan
print("### Next 60 days by the position's P&L — stock vs holding it, and the call in % of what you paid")
out = []
for b in labs:
    r = [b]
    for per in ("IS", "OOS"):
        D = H[(H.b == b) & (H.per == per)]
        r += [len(D), round(D.fwd60x.mean()*100, 2), round(t(D.fwd60x, D.mon), 2), round(D.d_hold.mean()*100, 1), round(D.xh.mean()*100, 1), round(t(D.xh, D.mon), 2),
              round((D.d_hold < -0.25).mean()*100, 1)]
    out.append(r)
cols = ["pnl"] + [f"{k}_{p}" for p in ("IS", "OOS") for k in ("n", "stock_x%", "t_stock", "call_chg%paid", "call_x%paid", "t_call", "P(lose>25%paid)")]
print(pd.DataFrame(out, columns=cols).set_index("pnl").to_string())
print("\n### Delta-matched roll vs hold, next 60 days, in % of what you paid (2% costs each way)")
c = 0.02
H["roll_chg"] = (H.pt * (1 - c) - H.q * H.pn * (1 + c) + H.q * H.pnf - H.pt) / H.p0
H["adv"] = H.roll_chg - H.d_hold
out = []
for b in labs:
    r = [b]
    for per in ("IS", "OOS"):
        D = H[(H.b == b) & (H.per == per)]
        r += [round(D.adv.mean()*100, 2), round(t(D.adv, D.mon), 1), round(D.d_hold.quantile(.05)*100, 1), round(D.roll_chg.quantile(.05)*100, 1)]
    out.append(r)
print(pd.DataFrame(out, columns=["pnl"] + [f"{k}_{p}" for p in ("IS", "OOS") for k in ("roll-hold%paid", "t", "hold_p5", "roll_p5")]).set_index("pnl").to_string())
print("\n### Fear dip × P&L: stock 60d excess, all years")
H["fear"] = (H.rsi14 < 40) & (H.vix_pct >= .8)
G = H.groupby(["b", "fear"], observed=True).agg(n=("fwd60x", "size"), stock_x=("fwd60x", "mean")).unstack("fear")
G[("stock_x", False)] *= 100; G[("stock_x", True)] *= 100
print(G.round(2).reindex(labs).to_string())
H.to_pickle("H3.pkl")
