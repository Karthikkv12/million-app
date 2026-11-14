"""Round 4 (2026-11-14): more independent evidence and sharper measurement. Run after fetch.py + fetch4.py + feats4.py.

Eras: OLD = 1963–1994 (never seen: no rule was set on it; before 1991 the fear gauge is the modeled VIX, feats4.py),
IS = 1995–2014 (where the rules were chosen), OOS = 2015–2026 (unseen). "Unseen" pooled = OLD + OOS.
1. Precision per round on 2015–2026 (R2 148 → R3 200 → R4 265 names), like accuracy.py.
2. The old era as a hold-out, and pooled with 2015–2026: how much the extra fear episodes narrow each range.
3. Foreign markets (10 indexes, each on its own fear gauge) as a hold-out.
4. The continuous fear score: excess return per score band, and the slope, instead of a yes/no at 0.283.
5. Swing trades measured net of the market (S&P over the same days): what part is the stock.

python round4.py → round4.json
"""
import json
import numpy as np, pandas as pd
import swing as S
from swing3 import SETUPS, EXIT, OLD148
from accuracy import summ, ADDED
from feats4 import FOREIGN

ROUNDS, acc = {}, []
for name, add in ADDED:
    acc = sorted(set(acc) | set(add)); ROUNDS[name] = [s for s in acc if s in S.SYM]
US = [s for s in S.SYM if s not in FOREIGN]


def era(d):
    d = pd.to_datetime(d)
    return np.where(d < "1995", "OLD", np.where(d < "2015", "IS", "OOS"))


# ── swing trades, with entry/exit dates (for the market-adjusted version) ──
def trades(setup, exit_fn):
    rows = []
    for s, a in S.SYM.items():
        sig = np.where(np.isfinite(a["c"]), setup(a), False)
        n, free = len(a["c"]), 0
        for i in np.flatnonzero(sig):
            if i < 252 or i + 1 >= n or i + 1 < free:
                continue
            j0 = i + 1; j, px = exit_fn(a, i, j0)
            rows.append((s, a["dates"][i], a["dates"][j0], a["dates"][j], px / a["o"][j0] - 1 - S.COST, j - j0 + 1))
            free = j + 1
    t = pd.DataFrame(rows, columns=["sym", "date", "d_in", "d_out", "ret", "days"])
    for c in ("date", "d_in", "d_out"):
        t[c] = pd.to_datetime(t[c])
    return t


G = S.SYM["^GSPC"]; gi = pd.to_datetime(G["dates"])
g_open, g_close = pd.Series(G["o"], index=gi), pd.Series(G["c"], index=gi)


def main():
    out = {"rounds": {}, "eras": {}, "foreign": {}, "score": {}, "swing_net": {}}
    T = trades(SETUPS["CURRENT: Add or drop5 ≥ 5% above 200"], EXIT)
    T["era"] = era(T.date)
    look = {s: (pd.Series(a["ret5"], index=pd.to_datetime(a["dates"])), pd.Series(a["d200"], index=pd.to_datetime(a["dates"])))
            for s, a in S.SYM.items()}
    T["strong"] = [bool(look[s][0].get(d, np.nan) <= -0.07 and look[s][1].get(d, np.nan) > 0) for s, d in zip(T.sym, T.date)]
    T["mkt"] = g_close.reindex(T.d_out).values / g_open.reindex(T.d_in).values - 1
    T["net"] = T.ret - T.mkt

    F = pd.read_pickle("F.pkl"); F["date"] = pd.to_datetime(F["date"])
    F = F[["sym", "date", "vix_pct", "rsi14", "dd52", "d_ma50", "d_ma200", "fwd20", "fwd60"]].copy()
    F["era"] = era(F.date)
    for h in ("fwd20", "fwd60"):
        F[h + "x"] = F[h] - F.groupby(["sym", "era"])[h].transform("mean")
    F["score"] = np.clip((F.vix_pct - .5) / .5, 0, 1) ** 1.5 * np.clip((50 - F.rsi14) / 30, 0, 1)
    calm = F.vix_pct < .6
    prev = F.groupby("sym").d_ma200.shift(1)
    RULES = {"ADD (60d vs holding)": F.score >= .283,
             "CAUTION (60d vs holding)": calm & ((F.dd52 <= -.10) | ((F.d_ma50 >= .03) & (F.d_ma50 <= .15) & (F.rsi14 > 65))),
             "EXIT (60d vs holding)": calm & (F.d_ma200 < 0) & (prev >= 0)}

    def sig(syms, eras):
        o = {}
        a = T[T.sym.isin(syms) & T.era.isin(eras)]
        o["Swing buy (per trade)"] = summ(a.ret, a.date)
        b = a[a.strong]; o["Strong swing buy (per trade)"] = summ(b.ret, b.date)
        for k, m in RULES.items():
            D = F[m & F.sym.isin(syms) & F.era.isin(eras) & F.fwd60x.notna()]
            o[k] = summ(D.fwd60x, D.date)
        return o

    prev_syms = None
    for name, syms in ROUNDS.items():
        r = {"symbols": len(syms), "signals": sig(syms, ["OOS"])}
        if prev_syms is not None:
            added = sorted(set(syms) - set(prev_syms))
            r["holdout"] = sig(added, ["OOS"])
        out["rounds"][name] = r; prev_syms = syms
    allsyms = list(S.SYM)
    out["eras"] = {"OLD 1963–1994": sig(US, ["OLD"]), "IS 1995–2014": sig(US, ["IS"]), "OOS 2015–2026": sig(US, ["OOS"]),
                   "Unseen pooled (OLD + OOS)": sig(US, ["OLD", "OOS"])}
    fx = sorted(FOREIGN & set(S.SYM))
    out["foreign"] = {"OLD + OOS": sig(fx, ["OLD", "OOS"]), "all years": sig(fx, ["OLD", "IS", "OOS"])}

    # continuous score: bands and the slope (fit on IS, read on unseen)
    bands = [(-.01, 0.0001, "0 (no fear or not oversold)"), (0.0001, .1, "0–0.10"), (.1, .2, "0.10–0.20"),
             (.2, .283, "0.20–0.283"), (.283, .45, "0.283–0.45 (Add)"), (.45, 1.01, "0.45+ (Add)")]
    for eras, lab in ((["IS"], "IS 1995–2014"), (["OLD", "OOS"], "Unseen (1963–94 + 2015–26)")):
        D = F[F.era.isin(eras) & F.fwd60x.notna() & F.score.notna() & F.sym.isin(US)]
        rows = {}
        for lo, hi, nm in bands:
            m = (D.score > lo) & (D.score <= hi)
            rows[nm] = summ(D.fwd60x[m], D.date[m])
        # slope: fwd60x on score, month-clustered (score-weighted mean ratio = OLS through the origin on demeaned data)
        x = D.score.values.astype(float); y = D.fwd60x.values.astype(float)
        xc = x - x.mean(); beta = (xc * y).sum() / (xc ** 2).sum()
        resid = y - y.mean() - beta * xc
        mon = D.date.dt.to_period("M").astype(str).to_numpy()
        g = pd.Series(xc * resid).groupby(mon).sum()
        se = np.sqrt((g ** 2).sum()) / (xc ** 2).sum()
        rows["slope per +0.1 score"] = {"beta": beta * 0.1, "se": se * 0.1, "t": beta / se, "n": int(len(x)),
                                        "eff_note": "every day counts; the slope is the dose-response"}
        out["score"][lab] = rows

    # swing net of the market
    for eras, lab in ((["OOS"], "OOS 2015–2026"), (["OLD", "OOS"], "Unseen pooled")):
        a = T[T.sym.isin(US) & T.era.isin(eras) & T.net.notna()]
        drop_only = a[[bool(look[s][0].get(d, np.nan) <= -0.05 and look[s][1].get(d, np.nan) > 0) for s, d in zip(a.sym, a.date)]]
        out["swing_net"][lab] = {"all raw": summ(a.ret, a.date), "all net of market": summ(a.net, a.date),
                                 "drop leg raw": summ(drop_only.ret, drop_only.date),
                                 "drop leg net of market": summ(drop_only.net, drop_only.date),
                                 "strong raw": summ(a[a.strong].ret, a[a.strong].date),
                                 "strong net of market": summ(a[a.strong].net, a[a.strong].date)}

    def clean(o):
        if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list): return o
        if isinstance(o, (float, np.floating)): return float(o)
        if isinstance(o, (np.integer,)): return int(o)
        return o
    json.dump(clean(out), open("round4.json", "w"), indent=1)
    p = lambda s: f"n{s['n']:8d} eff{s.get('eff_n', 0):6.0f} avg{s['avg']*100:+6.2f}% se{s['se']*100:5.2f} CI[{s['ci_lo']*100:+.2f},{s['ci_hi']*100:+.2f}] t{s['t']:5.2f}"
    for sec in ("rounds", "eras", "foreign"):
        print("\n==", sec)
        for k, v in out[sec].items():
            print(" ", k)
            for kk, s in (v.get("signals", v)).items():
                if isinstance(s, dict) and "n" in s: print(f"    {kk:30} {p(s)}")
            for kk, s in (v.get("holdout") or {}).items():
                print(f"    HOLDOUT {kk:22} {p(s)}")
    print("\n== score")
    for k, v in out["score"].items():
        print(" ", k)
        for kk, s in v.items():
            print(f"    {kk:30}", p(s) if "ci_lo" in s else f"{s['beta']*100:+.2f}% ± {s['se']*100:.2f} t{s['t']:.2f} n{s['n']}")
    print("\n== swing net")
    for k, v in out["swing_net"].items():
        print(" ", k)
        for kk, s in v.items(): print(f"    {kk:26} {p(s)}")


if __name__ == "__main__":
    main()
