"""Old rule vs new rule (2026-11-14), both periods → compare.json. Run after feats.py / optsim.py.

OLD: ADD = RSI(14) < 40 and VIX ≥ 80th pct of its year; holder goes 1.5× for 60 days.
NEW: ADD = fear score ≥ 0.283, score = clip((vix_pct − .5)/.5, 0, 1)^1.5 × clip((50 − RSI14)/30, 0, 1) (form, weights and
     cutoff chosen on 1995–2014: cutoff = the IS 92.5th percentile, i.e. the same share of days as OLD); holder adds
     one +1/6 tranche per signal, ≥ 10 trading days apart, ≤ 3 open, each held 60 days (max 1.5×)."""
import json, numpy as np, pandas as pd

F = pd.read_pickle("F.pkl").sort_values(["sym", "date"]).reset_index(drop=True)
F["per"] = np.where(F.date < "2015", "IS", "OOS"); F["mon"] = F.date.dt.to_period("M")
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
F["r1n"] = F.groupby("sym").px.shift(-1) / F.px - 1
SCORE_CUT = 0.283
F["score"] = np.clip((F.vix_pct - .5) / .5, 0, 1) ** 1.5 * np.clip((50 - F.rsi14) / 30, 0, 1)
old = ((F.rsi14 < 40) & (F.vix_pct >= .8)).values
new = (F.score >= SCORE_CUT).values


def tm(x, mon):
    m = pd.Series(np.asarray(x, float)).groupby(np.asarray(mon)).mean().dropna()
    return float(m.mean() / (m.std() / np.sqrt(len(m))))


def persist(sig, days):
    s = pd.Series(sig.astype(float), index=F.index)
    return s.groupby(F.sym.values).transform(lambda x: x.replace(0, np.nan).ffill(limit=days - 1).fillna(0)).values > 0


def tranches(sig, max_tr=3, gap=10, hold=60, step=0.5 / 3):
    w = np.ones(len(F))
    for _, idx in F.groupby("sym").indices.items():
        s = sig[idx]; open_ = []; last = -10 ** 9
        for i in range(len(idx)):
            open_ = [o for o in open_ if i - o < hold]
            if s[i] and i - last >= gap and len(open_) < max_tr:
                open_.append(i); last = i
            w[idx[i]] = 1 + step * len(open_)
    return w


def mdd(x):
    eq = (1 + x.fillna(0)).cumprod(); return float((eq / eq.cummax() - 1).min())


spy = F[F.sym == "SPY"].set_index("date").vix_pct >= .8
ep = (spy & ~spy.shift(1, fill_value=False)).cumsum()[spy]
POL = {"OLD": (old, np.where(persist(old, 60), 1.5, 1.0)), "NEW": (new, tranches(new))}
out = {}
for name, (sig, w) in POL.items():
    F["ret"] = w * F.r1n; F["ex"] = (w - 1) * F.r1n
    for p in ("IS", "OOS"):
        m = (F.per == p).values & sig & F.fwd60.notna().values
        D = F[m]
        # episodes: market fear episodes; days outside one count by calendar month
        key = D.date.map(ep).fillna(D.date.dt.to_period("M").astype(str).radd("m"))
        E = D.groupby(key).fwd60x.mean()
        Pp = F[F.per == p].dropna(subset=["ret"]); g = Pp.groupby("sym").ret
        ann, vol = g.mean() * 252, g.std() * np.sqrt(252)
        port_ex = Pp.groupby("date").ex.mean()
        out[f"{name}|{p}"] = dict(
            cases=int(len(D)), x20=round(D.fwd20x.mean() * 100, 2), x60=round(D.fwd60x.mean() * 100, 2),
            t20=round(tm(D.fwd20x, D.mon), 2), t60=round(tm(D.fwd60x, D.mon), 2),
            up20=round((D.fwd20 > 0).mean() * 100, 1), beat60=round((D.fwd60x > 0).mean() * 100, 1),
            worst_episode60=round(E.min() * 100, 1), episodes=int(len(E)), episodes_pos60=round((E > 0).mean() * 100, 1),
            holder_ann=round(ann.mean() * 100, 1), holder_sharpe=round((ann / vol).mean(), 3),
            holder_maxdd=round(g.apply(mdd).mean() * 100, 1), overlay_worst60=round(port_ex.rolling(60).sum().min() * 100, 2),
            y2008=round(F[F.date.between("2007-10-01", "2009-03-31")].groupby("date").ex.mean().sum() * 100, 2) if p == "IS" else None,
            y2022=round(F[F.date.between("2022-01-01", "2022-10-31")].groupby("date").ex.mean().sum() * 100, 2) if p == "OOS" else None)
for p in ("IS", "OOS"):
    Pp = F[F.per == p].dropna(subset=["r1n"]); g = Pp.groupby("sym").r1n
    ann, vol = g.mean() * 252, g.std() * np.sqrt(252)
    out[f"buy&hold|{p}"] = dict(holder_ann=round(ann.mean() * 100, 1), holder_sharpe=round((ann / vol).mean(), 3),
                                holder_maxdd=round(g.apply(mdd).mean() * 100, 1))
json.dump(out, open("compare.json", "w"), indent=1)
for k, v in out.items():
    print(k, v)
