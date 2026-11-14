"""Roll trigger, tested directly (2026-11-14): a held 365-day 0.80Δ call checked every 21 trading days up to 231 days
held (holdsim_roll.py → Hroll.pkl). At each check: next-60-day P&L of holding it vs a delta-matched roll into a fresh
365-day 0.80Δ call (difference banked), in % of what was paid, by DAYS LEFT on the held call. Costs each way: 2% / 4%."""
import json, numpy as np, pandas as pd
H = pd.read_pickle("Hroll.pkl")
H["per"] = np.where(H.date < "2015", "IS", "OOS"); H["mon"] = H.date.dt.to_period("M")
H["left"] = 365 - (H.date - H.entry).dt.days
H["p0"] = H.pt / (1 + H.pnl); H["d_hold"] = (H.pf - H.pt) / H.p0
bins = [0, 90, 120, 150, 180, 210, 240, 270, 300, 400]
H["bucket"] = pd.cut(H.left, bins)
def t(x, mon):
    m = x.dropna().groupby(mon).mean(); return float(m.mean() / (m.std() / np.sqrt(len(m)))) if len(m) > 5 else float("nan")
out = {}
for c in (0.02, 0.04):
    H["adv"] = (H.pt * (1 - c) - H.q * H.pn * (1 + c) + H.q * H.pnf - H.pt) / H.p0 - H.d_hold
    for b, D in H.groupby("bucket", observed=True):
        for per in ("IS", "OOS"):
            E = D[D.per == per]
            out[f"cost{c}|{b}|{per}"] = dict(n=int(len(E)), roll_minus_hold=round(E.adv.mean() * 100, 2), t=round(t(E.adv, E.mon), 2),
                                             share_roll_better=round((E.adv > 0).mean() * 100, 1))
            print(c, b, per, out[f"cost{c}|{b}|{per}"])
json.dump(out, open("roll.json", "w"), indent=1)
