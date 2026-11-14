"""Swing round 2: the two setups that cleared the baseline in round 1 (Add, sharp 5-day drop above the 200-day),
their variants and union, against more exits. Chosen on 1995–2014 only; 2015–2026 read once. Also: excess over the
same-day average of every symbol (is it timing or picking?), per year, and the bear markets.

python swing2.py  (after swing.py's data) → swing2.json
"""
import json
import numpy as np, pandas as pd
import swing as S

def drop(th, above=True):
    return lambda a: (a["ret5"] <= -th) & ((a["d200"] > 0) if above else np.isfinite(a["d200"]))

ADD = S.SETUPS["Add (fear score ≥ 0.283)"]
SETUPS = {
    "Add": ADD,
    "drop5 ≥ 3%, above 200": drop(0.03), "drop5 ≥ 5%, above 200": drop(0.05),
    "drop5 ≥ 7%, above 200": drop(0.07), "drop5 ≥ 10%, above 200": drop(0.10),
    "drop5 ≥ 5%, any trend": drop(0.05, above=False),
    "Add or drop5 ≥ 5% above 200": lambda a: ADD(a) | drop(0.05)(a),
}

def ex_target(pct, nmax):
    def f(a, i, j0):
        last = min(j0 + nmax - 1, len(a["c"]) - 1)
        lvl = a["o"][j0] * (1 + pct)
        for j in range(j0, last + 1):
            if a["h"][j] >= lvl:
                return j, max(lvl, a["o"][j]) if j > j0 else lvl
        return last, a["c"][last]
    f.__name__ = f"+{pct:.0%} target (max {nmax}d)"; return f

def ex_prior_close(nmax):
    """Exit at the first close back above the close 5 days before entry (the drop recovered), else after nmax."""
    def f(a, i, j0):
        ref = a["c"][i - 5] if i >= 5 else a["c"][i]
        last = min(j0 + nmax - 1, len(a["c"]) - 1)
        for j in range(j0, last + 1):
            if a["c"][j] >= ref:
                return j, a["c"][j]
        return last, a["c"][last]
    f.__name__ = f"drop recovered (max {nmax}d)"; return f

EXITS = [S.ex_time(5), S.ex_time(10), S.ex_time(15), S.ex_time(20), S.ex_ma("ma10", 20),
         ex_target(0.05, 20), ex_target(0.08, 20), ex_prior_close(20)]

# same-day baseline: average hold-N return of every symbol entered the same day (for excess)
def base_by_day(n):
    rows = []
    for s, a in S.SYM.items():
        o, c, d = a["o"], a["c"], a["dates"]
        k = len(c)
        for i in range(252, k - n - 1):
            rows.append((d[i], c[i + n] / o[i + 1] - 1))
    b = pd.DataFrame(rows, columns=["date", "r"]); b["date"] = pd.to_datetime(b["date"])
    return b.groupby("date").r.mean()

if __name__ == "__main__":
    out = {"grid": [], "years": {}}
    BASE = {n: base_by_day(n) for n in (5, 10, 20)}
    print(f"{'setup':30} {'exit':26} | IS n avg win days per-day t xs | OOS n avg win days per-day t xs")
    keep = {}
    for sn, sf in SETUPS.items():
        for ef in EXITS:
            t = S.trades(sf, ef)
            n = {"hold 5d": 5, "hold 10d": 10, "hold 20d": 20}.get(ef.__name__)
            if n:
                t["xs"] = t.ret - t.date.map(BASE[n]).fillna(0) + S.COST
            a, b = S.split(t)
            for x, part in ((a, t[t.date <= S.IS_END]), (b, t[t.date > S.IS_END])):
                if x is not None and "xs" in t:
                    x["excess"] = round(part["xs"].mean() * 100, 2)
            out["grid"].append({"setup": sn, "exit": ef.__name__, "is": a, "oos": b})
            keep[(sn, ef.__name__)] = t
            fm = lambda x: (f"{x['trades']:6d} {x['avg']:+5.2f}% {x['win']:4.1f}% {x['days']:4.1f} {x['per_day']:+.3f} {x['t']:5.2f} "
                            f"{x.get('excess', float('nan')):+.2f}") if x else "-"
            print(f"{sn:30} {ef.__name__:26} | {fm(a)} | {fm(b)}", flush=True)
    for (sn, en), t in keep.items():
        if en in ("hold 10d", "drop recovered (max 20d)", "close > 10-day avg (max 20d)"):
            y = t.groupby(t.date.dt.year).ret.agg(["mean", "count"])
            out["years"][f"{sn} | {en}"] = {int(k): [round(v["mean"] * 100, 2), int(v["count"])] for k, v in y.iterrows()}
    json.dump(out, open("swing2.json", "w"), indent=1)
    print("done")
