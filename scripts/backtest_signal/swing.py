"""Swing trades (1 week – 1 month) from the signal's ingredients: entry on a setup at the close, bought at the NEXT
open, sold by an exit rule; absolute trade returns after costs, one trade at a time per symbol (no overlapping
entries). Rules are chosen on 1995–2014 (IS) and read once on 2015–2026 (OOS).

Run in the folder with prices.pkl, vix.pkl, F.pkl (fetch.py, feats.py):  python swing.py  → swing.json + printed tables
"""
import json, sys
import numpy as np, pandas as pd

COST = 0.002                 # round trip: 0.1% each side (commission-free, but spread + slippage on a next-open fill)
IS_END = "2014-12-31"
P = pd.read_pickle("prices.pkl")
F = pd.read_pickle("F.pkl")
F["date"] = pd.to_datetime(F["date"])


def rsi(c, n):
    d = c.diff(); up = d.clip(lower=0).rolling(n).mean(); dn = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


# ── per-symbol arrays ────────────────────────────────────────────────────────
SYM = {}
for s, d in P.groupby(level=0):
    d = d.droplevel(0)
    d.index = pd.to_datetime(d.index)
    f = F[F.sym == s].set_index("date").reindex(d.index)
    c = d.Close
    SYM[s] = dict(dates=d.index.values, o=d.Open.values, h=d.High.values, l=d.Low.values, c=c.values,
                  ma5=c.rolling(5).mean().values, ma10=c.rolling(10).mean().values,
                  hi20=d.High.rolling(20).max().values,
                  rsi2=rsi(c, 2).values, rsi3=rsi(c, 3).values, rsi14=f.rsi14.values,
                  d200=f.d_ma200.values, d50=f.d_ma50.values, vix_pct=f.vix_pct.values, ret5=f.ret5.values,
                  dd52=f.dd52.values, hv20=f.hv20.values, spy_trend=f.spy_trend.values,
                  dollar_vol=f.dollar_vol.values)


def fear(vp, r14):
    return np.clip((vp - 0.5) / 0.5, 0, 1) ** 1.5 * np.clip((50 - r14) / 30, 0, 1)


SETUPS = {
    "all days (baseline)":              lambda a: np.isfinite(a["c"]),
    "Add (fear score ≥ 0.283)":         lambda a: fear(a["vix_pct"], a["rsi14"]) >= 0.283,
    "RSI(2) < 10":                      lambda a: a["rsi2"] < 10,
    "RSI(2) < 10, above 200-day":       lambda a: (a["rsi2"] < 10) & (a["d200"] > 0),
    "RSI(2) < 5, above 200-day":        lambda a: (a["rsi2"] < 5) & (a["d200"] > 0),
    "RSI(2) < 10, under 200-day":       lambda a: (a["rsi2"] < 10) & (a["d200"] <= 0),
    "RSI(2) < 10, VIX ≥ 60th pct":      lambda a: (a["rsi2"] < 10) & (a["vix_pct"] >= 0.6),
    "RSI(2) < 10, above 200, VIX ≥ 60": lambda a: (a["rsi2"] < 10) & (a["d200"] > 0) & (a["vix_pct"] >= 0.6),
    "5-day drop ≥ 5%, above 200-day":   lambda a: (a["ret5"] <= -0.05) & (a["d200"] > 0),
    "RSI(3) < 15, above 200-day":       lambda a: (a["rsi3"] < 15) & (a["d200"] > 0),
}


def ex_time(n):
    def f(a, i, j0):                      # j0 = entry day index (open); exit at close j0+n-1
        j = min(j0 + n - 1, len(a["c"]) - 1)
        return j, a["c"][j]
    f.__name__ = f"hold {n}d"; return f


def ex_ma(key, nmax):
    def f(a, i, j0):                      # first close above the moving average, else after nmax days
        last = min(j0 + nmax - 1, len(a["c"]) - 1)
        for j in range(j0, last + 1):
            if a["c"][j] > a[key][j]:
                return j, a["c"][j]
        return last, a["c"][last]
    f.__name__ = f"close > {key[2:]}-day avg (max {nmax}d)"; return f


def ex_stop(inner, stop):
    def f(a, i, j0):                      # intraday stop at entry × (1 − stop), filled at the stop (or the open if gapped)
        j, px = inner(a, i, j0)
        lvl = a["o"][j0] * (1 - stop)
        for k in range(j0, j + 1):
            if a["l"][k] <= lvl:
                return k, min(lvl, a["o"][k]) if k > j0 else lvl
        return j, px
    f.__name__ = f"{inner.__name__} + {stop:.0%} stop"; return f


EXITS = [ex_time(5), ex_time(10), ex_time(20), ex_ma("ma5", 10), ex_ma("ma5", 20), ex_ma("ma10", 20),
         ex_stop(ex_ma("ma5", 10), 0.05), ex_stop(ex_ma("ma5", 10), 0.10), ex_stop(ex_time(10), 0.07)]


def trades(setup, exit_fn):
    rows = []
    for s, a in SYM.items():
        sig = setup(a)
        sig = np.where(np.isfinite(a["c"]), sig, False)
        n, i = len(a["c"]), 0
        idx = np.flatnonzero(sig)
        free = 0                                  # first day index a new entry may use
        for i in idx:
            if i < 252 or i + 1 >= n or i + 1 < free:
                continue
            j0 = i + 1
            j, px = exit_fn(a, i, j0)
            r = px / a["o"][j0] - 1 - COST
            rows.append((s, a["dates"][i], r, j - j0 + 1))
            free = j + 1
    t = pd.DataFrame(rows, columns=["sym", "date", "ret", "days"])
    t["date"] = pd.to_datetime(t["date"])
    return t


def stats(t):
    if len(t) == 0:
        return None
    m = t.groupby(t.date.dt.to_period("M")).ret.mean()          # month-clustered t-stat (same-day trades correlate)
    tt = m.mean() / (m.std(ddof=1) / np.sqrt(len(m))) if len(m) > 2 else np.nan
    return {"trades": int(len(t)), "avg": round(t.ret.mean() * 100, 2), "median": round(t.ret.median() * 100, 2),
            "win": round((t.ret > 0).mean() * 100, 1), "days": round(t.days.mean(), 1),
            "per_day": round(t.ret.mean() / t.days.mean() * 100, 3), "worst5": round(t.ret.quantile(0.05) * 100, 1),
            "t": round(float(tt), 2)}


def split(t):
    return stats(t[t.date <= IS_END]), stats(t[t.date > IS_END])


if __name__ == "__main__":
    out = {"cost_round_trip": COST, "grid": []}
    print(f"{'setup':36} {'exit':38} | IS: n avg win days t | OOS: n avg win days t")
    for sn, sf in SETUPS.items():
        for ef in EXITS:
            t = trades(sf, ef)
            a, b = split(t)
            out["grid"].append({"setup": sn, "exit": ef.__name__, "is": a, "oos": b})
            fm = lambda x: f"{x['trades']:6d} {x['avg']:+5.2f}% {x['win']:4.1f}% {x['days']:4.1f} {x['t']:5.2f}" if x else "-"
            print(f"{sn:36} {ef.__name__:38} | {fm(a)} | {fm(b)}", flush=True)
    json.dump(out, open("swing.json", "w"), indent=1)
