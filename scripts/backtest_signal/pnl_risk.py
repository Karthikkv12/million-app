"""Per P&L bucket of a held 365-day 0.80Δ call (H3.pkl, from holdsim.py), 2015–2026: odds over the next 60 trading
days, in % of what was paid; and the stock's 60-day excess (to show P&L doesn't predict the stock)."""
import json, numpy as np, pandas as pd
H = pd.read_pickle("H3.pkl"); H = H[H.per == "OOS"]
H["mon"] = H.date.dt.to_period("M")
edges = [(-1.0, -0.5, "<-50%"), (-0.5, -0.25, "-50/-25"), (-0.25, 0, "-25/0"), (0, 0.25, "0/+25"), (0.25, 0.5, "+25/+50"),
         (0.5, 1.0, "+50/+100"), (1.0, 2.0, "+100/+200"), (2.0, 99, ">+200%")]
out = []
for lo, hi, lab in edges:
    D = H[(H.pnl > lo) & (H.pnl <= hi)].dropna(subset=["d_hold"])
    m = D.groupby("mon").fwd60x.mean(); ts = m.mean() / (m.std() / np.sqrt(len(m)))
    out.append({"lo": lo, "hi": hi, "label": lab, "cases": int(len(D)),
                "p_lose_25_paid": round(float((D.d_hold < -0.25).mean()), 3), "p_gain_25_paid": round(float((D.d_hold > 0.25).mean()), 3),
                "p5_paid": round(float(D.d_hold.quantile(.05)), 3), "median_paid": round(float(D.d_hold.median()), 3),
                "time_value": round(float(D.tv_share.mean()), 3), "stock_excess_60": round(float(D.fwd60x.mean()), 4), "t_stock": round(float(ts), 2)})
    print(out[-1])
json.dump(out, open("pnl_risk.json", "w"), indent=1)
