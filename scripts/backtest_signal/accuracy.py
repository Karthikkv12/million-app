"""Accuracy tracker: the same measurements for every universe-growth round, so rounds compare like for like.
Each round = a set of symbols (ROUNDS below; add the new round's names each week). For every signal it reports, on
2015–2026 (unseen when the rules were set):
  n, months, avg (edge), se (month-clustered standard error), ci95 = avg ± 1.96·se, t = avg / se, win rate,
  and for the names a round ADDED: what the previous round predicted vs what those names did (the hold-out test).
"Accuracy" here = how precisely we know each signal's edge (the width of its 95% range), and whether the edge holds
on names that were never used to set it. More names do not change what the rule does; they narrow the range.

python accuracy.py  (prices.pkl / F.pkl of the latest round) → accuracy.json (copy the round into docs/signal-accuracy.md)
"""
import json
import numpy as np, pandas as pd
import swing as S
from swing3 import SETUPS, EXIT, OLD148

# Each round = the names it ADDED (cumulative). Next week: add the names to fetch.py, re-run fetch.py + feats.py, add a
# line here, run this, and append the round to docs/signal-accuracy.md (+ copy accuracy.json to docs/signal-accuracy.json).
ADDED = [
    ("R2 · 148 names · 2026-11-14", sorted(OLD148)),
    ("R3 · 200 names · 2026-11-14", """MRVL ADI NXPI ON MCHP INTU ADSK WDAY ANET SPOT PINS COF USB PNC SPGI ICE CME BX TMO ABT DHR
        ISRG VRTX REGN MDT SYK BKNG CMG LULU ROST TJX MO UNP NOC GD ETN DAL CCL EOG PSX VLO FCX NEM LIN NEE DUK AMT XLU
        XBI EEM EFA GDX""".split()),
]
ROUNDS, _acc = {}, []
for _name, _add in ADDED:
    _acc = sorted(set(_acc) | set(_add)); ROUNDS[_name] = [s for s in _acc if s in S.SYM]


def summ(vals, dates):
    v = pd.Series(np.asarray(vals, float)); d = pd.to_datetime(pd.Series(dates).values)
    ok = v.notna().values; v, d = v[ok], d[ok]
    m = v.groupby(d.to_period("M")).mean()
    se = m.std(ddof=1) / np.sqrt(len(m))
    avg = v.mean()
    # clustered se of the pooled mean: per-month sums, weighted (= the usual cluster-robust se for a mean)
    g = (v - avg).groupby(d.to_period("M")).sum()
    se_c = np.sqrt((g ** 2).sum()) / len(v) * np.sqrt(len(g) / (len(g) - 1))
    naive = v.std(ddof=1) / np.sqrt(len(v))
    return {"n": int(len(v)), "months": int(len(m)), "avg": avg, "se": se_c, "se_if_independent": naive,
            "ci_lo": avg - 1.96 * se_c, "ci_hi": avg + 1.96 * se_c, "t": avg / se_c, "win": float((v > 0).mean()),
            "eff_n": float((v.std(ddof=1) / se_c) ** 2),
            "t_month": float(m.mean() / se)}                    # earlier rounds' t: every month weighted equally       # how many independent trades it is worth


def swing_trades():
    t_all = S.trades(SETUPS["CURRENT: Add or drop5 ≥ 5% above 200"], EXIT)
    look = {s: pd.Series(a["ret5"], index=pd.to_datetime(a["dates"])) for s, a in S.SYM.items()}
    d200 = {s: pd.Series(a["d200"], index=pd.to_datetime(a["dates"])) for s, a in S.SYM.items()}
    t_all["strong"] = [look[s].get(d, np.nan) <= -0.07 and d200[s].get(d, np.nan) > 0 for s, d in zip(t_all.sym, t_all.date)]
    return t_all[t_all.date > S.IS_END]


def daily_rules():
    F = pd.read_pickle("F.pkl").sort_values(["sym", "date"]).reset_index(drop=True)
    F["date"] = pd.to_datetime(F["date"]); F = F[F.date >= "2015"]
    F["fwd60x"] = F.fwd60 - F.groupby("sym").fwd60.transform("mean")
    F["fwd60"] = F.fwd60
    score = np.clip((F.vix_pct - .5) / .5, 0, 1) ** 1.5 * np.clip((50 - F.rsi14) / 30, 0, 1)
    calm = F.vix_pct < .6
    prev = F.groupby("sym").d_ma200.shift(1)
    return F, {"ADD (60d vs holding)": score >= .283,
               "CAUTION (60d vs holding)": calm & ((F.dd52 <= -.10) | ((F.d_ma50 >= .03) & (F.d_ma50 <= .15) & (F.rsi14 > 65))),
               "EXIT (60d vs holding)": calm & (F.d_ma200 < 0) & (prev >= 0)}


if __name__ == "__main__":
    T = swing_trades(); F, R = daily_rules()
    def sig(syms):
        out = {}
        a = T[T.sym.isin(syms)]
        out["Swing buy (per trade)"] = summ(a.ret, a.date)
        b = a[a.strong]; out["Strong swing buy (per trade)"] = summ(b.ret, b.date)
        for k, m in R.items():
            D = F[m & F.sym.isin(syms) & F.fwd60x.notna()]
            out[k] = summ(D.fwd60x, D.date)
        return out
    res, prev = {}, None
    for name, syms in ROUNDS.items():
        r = {"symbols": len(syms), "signals": sig(syms)}
        if prev is not None:
            added = sorted(set(syms) - set(prev))
            r["added"] = added
            r["holdout"] = {k: {"predicted": res[pname]["signals"][k]["avg"], **summ_} for k, summ_ in sig(added).items()}
        res[name] = r; prev, pname = syms, name
    def clean(o):
        if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list): return o
        return round(float(o), 6) if isinstance(o, (float, np.floating)) else o
    json.dump(clean(res), open("accuracy.json", "w"), indent=1)
    for name, r in res.items():
        print("\n", name, r["symbols"])
        for k, s in r["signals"].items():
            print(f"  {k:30} n{s['n']:7d} eff{s['eff_n']:7.0f} avg{s['avg']*100:+6.2f}% se{s['se']*100:5.2f} naive{s['se_if_independent']*100:5.2f} "
                  f"CI[{s['ci_lo']*100:+.2f},{s['ci_hi']*100:+.2f}] t{s['t']:5.2f} tm{s['t_month']:5.2f} win{s['win']*100:5.1f}")
        for k, s in (r.get("holdout") or {}).items():
            print(f"  HOLDOUT {k:30} pred{s['predicted']*100:+6.2f}% got{s['avg']*100:+6.2f}% CI[{s['ci_lo']*100:+.2f},{s['ci_hi']*100:+.2f}] n{s['n']}")
