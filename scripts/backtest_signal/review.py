"""Skeptical review of the 2026-11-13 report (2026-11-14). Run after feats.py, ivmodel.py, optsim.py.

Every number in docs/hedge-signal-review.md comes from this file (→ review.json). Thresholds that are CHOSEN here are
chosen on 1995–2014 (IS) only and then read on 2015–2026 (OOS)."""
import json, numpy as np, pandas as pd

F = pd.read_pickle("F.pkl"); O = pd.read_pickle("O.pkl")
OUT = {}
IS, OOS = "IS", "OOS"
F["per"] = np.where(F.date < "2015", IS, OOS); O["per"] = np.where(O.date < "2015", IS, OOS)
F["mon"] = F.date.dt.to_period("M"); O["mon"] = O.date.dt.to_period("M")


def tm(x, mon):
    """t-stat of the mean with month clusters (mean of monthly means)."""
    m = pd.Series(np.asarray(x)).groupby(np.asarray(mon)).mean().dropna()
    return float(m.mean() / (m.std() / np.sqrt(len(m)))) if len(m) > 2 else float("nan")


def r(x, n=2):
    return None if x is None or not np.isfinite(x) else round(float(x), n)


# ── 1. counts ────────────────────────────────────────────────────────────────
c = {"rows": len(F), "rows_IS": int((F.per == IS).sum()), "rows_OOS": int((F.per == OOS).sum()),
     "with_fwd20": int(F.fwd20.notna().sum()), "with_fwd20_IS": int(((F.per == IS) & F.fwd20.notna()).sum()),
     "with_fwd20_OOS": int(((F.per == OOS) & F.fwd20.notna()).sum()), "with_fwd60": int(F.fwd60.notna().sum()),
     "option_rows": len(O), "option_rows_fwd60": int(O.fwd60.notna().sum()), "symbols": int(F.sym.nunique())}
c["no_fwd20_tail"] = c["rows"] - c["with_fwd20"]
OUT["counts"] = c

# excess vs the stock's own average for that period (as in the report)
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
    O[h + "x"] = O[h] - O.groupby(["sym", "per"])[h].transform("mean")
O["ivr"] = O.iv30 / O.theta


# ── 2. mutually exclusive setups ─────────────────────────────────────────────
def buckets(D, gate=None):
    fear = (D.rsi14 < 40) & (D.vix_pct >= .8)
    calm = D.vix_pct < .6
    caution = ~fear & calm & ((D.dd52 <= -.10) | (D.d_ma50.between(.03, .15) & (D.rsi14 > 65)))
    lean = ~fear & ~caution & (D.rsi14 < 40)
    b = pd.Series("HOLD", index=D.index)
    b[lean] = "OVERSOLD_NO_FEAR"; b[caution] = "CAUTION"; b[fear] = "FEAR_DIP"
    if gate is not None:
        b[fear & (D.ivr >= gate)] = "FEAR_DIP_IV_RICH"; b[fear & (D.ivr < gate)] = "FEAR_DIP_IV_NORMAL"
    return b


def stat(D):
    return dict(n=int(len(D)), x20=r(D.fwd20x.mean() * 100), x60=r(D.fwd60x.mean() * 100),
                up20=r((D.fwd20 > 0).mean() * 100, 1), t60=r(tm(D.fwd60x.fillna(0), D.mon)))


Fd = F[F.fwd20.notna()].copy(); Fd["b"] = buckets(Fd)
OUT["buckets"] = {p: {k: stat(Fd[(Fd.per == p) & (Fd.b == k)]) for k in ("FEAR_DIP", "OVERSOLD_NO_FEAR", "CAUTION", "HOLD")}
                  for p in (IS, OOS)}
for p in (IS, OOS):
    OUT["buckets"][p]["sum_n"] = sum(v["n"] for k, v in OUT["buckets"][p].items() if k != "sum_n")

# ── 3 + 5. holding policies: old signal vs new, annual / Sharpe / drawdown ──
F = F.sort_values(["sym", "date"]); F["r1n"] = F.groupby("sym").px.shift(-1) / F.px - 1


def persist(sig, days, D):
    s = pd.Series(np.asarray(sig, float), index=D.index)
    return s.groupby(D.sym.values).transform(lambda x: x.replace(0, np.nan).ffill(limit=days - 1).fillna(0)).values > 0


def mdd(x):
    eq = (1 + x.fillna(0)).cumprod(); return (eq / eq.cummax() - 1).min()


def policy_stats(F, pols):
    rows = {}
    for per in (IS, OOS):
        m = (F.per == per).values; base = None
        for k, w in pols.items():
            D = F[m].assign(ret=w[m] * F[m].r1n.values).dropna(subset=["ret"])
            g = D.groupby("sym").ret
            ann, vol = g.mean() * 252, g.std() * np.sqrt(252); sh = ann / vol; dd = g.apply(mdd)
            if base is None:
                base = (sh, dd)
            rows[f"{per}|{k}"] = dict(ann=r(ann.mean() * 100, 1), sharpe=r(sh.mean(), 3), d_sharpe=r((sh - base[0]).mean(), 3),
                                      maxdd=r(dd.mean() * 100, 1), worst_maxdd=r(dd.min() * 100, 1), avg_exposure=r(w[m].mean()))
    return rows


add = (F.rsi14 < 40) & (F.vix_pct >= .8)
knife = (F.dd52 <= -.10) & (F.vix_pct < .6)
stretched = (F.vix_pct < .6) & F.d_ma50.between(.03, .15) & (F.rsi14 > 65)
a20, k20, s20 = persist(add, 20, F), persist(knife, 20, F), persist(stretched, 20, F)
POL = {"buy&hold": np.ones(len(F)),
       "OLD signal": np.select([F.p_score >= 25, F.p_score <= -25], [1.5, 0.5], 1.0),
       "NEW signal (1.5 add / 0.5 caution)": np.where(a20, 1.5, np.where(k20 | s20, .5, 1.0)),
       "NEW add-only 20d": np.where(a20, 1.5, 1.0),
       "NEW add-only 60d": np.where(persist(add, 60, F), 1.5, 1.0)}
OUT["policies"] = policy_stats(F, POL)
# old signal verdict buckets (Finding 1)
F["old"] = np.select([F.p_score >= 25, F.p_score <= -25], ["ADD", "TRIM"], "HOLD")
OUT["old_verdicts"] = {p: {k: dict(n=int(len(D)), f20=r(D.fwd20.mean() * 100), x20=r(D.fwd20x.mean() * 100))
                           for k, D in F[(F.per == p) & F.fwd20.notna()].groupby("old")} for p in (IS, OOS)}

# ── 4. LEAPS on fear dips held 20 / 60 days: the full distribution ──────────
fearO = (O.rsi14 < 40) & (O.vix_pct >= .8)


def dist(x):
    x = x.dropna()
    return dict(n=int(len(x)), mean=r(x.mean() * 100, 1), median=r(x.median() * 100, 1), p25=r(x.quantile(.25) * 100, 1),
                p75=r(x.quantile(.75) * 100, 1), p10=r(x.quantile(.1) * 100, 1), pos=r((x > 0).mean() * 100, 1))


OUT["leaps_dist"] = {}
for cost in ("base", "stress"):
    for h in (20, 60):
        col = f"o_365_0.8_{cost}_{h}"
        xx = O[col] - O.groupby(["sym", "per"])[col].transform("mean")
        for p in (IS, OOS):
            m = fearO & (O.per == p)
            OUT["leaps_dist"][f"{cost}|{h}|{p}"] = dict(absolute=dist(O.loc[m, col]), excess=dist(xx[m]),
                                                         all_days=dist(O.loc[O.per == p, col]), t_excess=r(tm(xx[m].fillna(0), O.mon[m])))

# ── 7. IV gate chosen on 1995–2014 only ──────────────────────────────────────
col60 = "o_365_0.8_stress_60"; x60o = O[col60] - O.groupby(["sym", "per"])[col60].transform("mean")
col20 = "o_365_0.8_stress_20"; x20o = O[col20] - O.groupby(["sym", "per"])[col20].transform("mean")
grid = {}
for g in (None, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5):
    row = {}
    for p in (IS, OOS):
        m = fearO & (O.per == p) & O[col60].notna() & ((O.ivr >= g) if g else True)
        row[p] = dict(n=int(m.sum()), x60=r(x60o[m].mean() * 100), t60=r(tm(x60o[m], O.mon[m])), ret60=r(O.loc[m, col60].mean() * 100),
                      x20=r(x20o[m].mean() * 100), t20=r(tm(x20o[m].fillna(0), O.mon[m])), up60=r((O.loc[m, col60] > 0).mean() * 100, 1))
    grid["none" if g is None else str(g)] = row
OUT["iv_gate_grid"] = grid
# pick: highest IS t on 60-day option excess, among gates that keep ≥ 40% of IS fear days
n_all = grid["none"][IS]["n"]
cands = {k: v for k, v in grid.items() if v[IS]["n"] >= .4 * n_all}
pick = max(cands, key=lambda k: cands[k][IS]["t60"])
OUT["iv_gate_pick_IS"] = dict(gate=pick, IS=grid[pick][IS], OOS=grid[pick][OOS], rule="max IS t60 with ≥40% of IS fear days kept")

# ── 8. multiple testing: 28 option configs on fear dips, OOS ────────────────
cfg = [k for k in O.columns if k.startswith("o_")]
mon_tab = {}
for k in cfg:
    xx = O[k] - O.groupby(["sym", "per"])[k].transform("mean")
    m = fearO & (O.per == OOS) & O[k].notna()
    mon_tab[k] = xx[m].groupby(O.mon[m]).mean()
M = pd.DataFrame(mon_tab).dropna(how="all")
tvals = (M.mean() / (M.std() / np.sqrt(M.count())))
from math import erf, sqrt
p2 = lambda t: 2 * (1 - 0.5 * (1 + erf(abs(t) / sqrt(2))))
ntest = len(cfg)
rng = np.random.default_rng(7)
Mc = (M - M.mean()).fillna(0).values                              # null: zero mean, keep cross-config correlation
B = 5000; maxt = np.empty(B)
for b in range(B):
    idx = rng.integers(0, len(Mc), len(Mc)); s = Mc[idx]
    maxt[b] = np.max(np.abs(s.mean(0) / (s.std(0, ddof=1) / np.sqrt(len(s)))))
OUT["multiple_testing"] = {
    "tests": ntest, "bonferroni_t_crit": 3.12, "maxT_crit_95": r(np.quantile(maxt, .95)),
    "configs": {k: dict(t=r(tvals[k]), p=r(p2(tvals[k]), 4), p_bonf=r(min(1, p2(tvals[k]) * ntest), 4),
                        p_maxT=r((maxt >= abs(tvals[k])).mean(), 4)) for k in cfg}}

# ── 9. theta curve, the edge, and the roll crossover ────────────────────────
import math
def Nn(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def bsc(S, K, T, rr, v):
    d1 = (math.log(S / K) + (rr + v * v / 2) * T) / (v * math.sqrt(T)); return S * Nn(d1) - K * math.exp(-rr * T) * Nn(d1 - v * math.sqrt(T))
def decay20(D, v=.35, rr=.04):
    T = D / 365; K = 100 * math.exp(-(0.841621 * v * math.sqrt(T)) + (rr + v * v / 2) * T)
    return 1 - bsc(100, K, max(T - 28 / 365, 1e-4), rr, v) / bsc(100, K, T, rr, v)
curve = {D: r(decay20(D) * 100, 2) for D in range(60, 400, 10)}
OUT["decay_curve_iv35"] = curve
OUT["decay_curve_iv50"] = {D: r(decay20(D, .5) * 100, 2) for D in range(60, 400, 10)}
# the edge per DTE: 20-day excess on fear-dip days for each simulated DTE (stress), IS and OOS
OUT["edge_by_dte"] = {}
for D in (90, 180, 365, 540):
    for h in (20, 60):
        k = f"o_{D}_0.8_stress_{h}"
        if k not in O: continue
        xx = O[k] - O.groupby(["sym", "per"])[k].transform("mean")
        OUT["edge_by_dte"][f"{D}|{h}"] = {p: dict(x=r(xx[fearO & (O.per == p)].mean() * 100), ret=r(O.loc[fearO & (O.per == p), k].mean() * 100),
                                                   hold_all=r(O.loc[(O.per == p), k].mean() * 100)) for p in (IS, OOS)}

# ── 11. long puts: simulated, not assumed ───────────────────────────────────
def Nv(x): return 0.5 * (1 + np.vectorize(math.erf)(x / math.sqrt(2)))
KAPPA = float(np.load("kappa.npy")[0])
g_ = lambda T: (1 - np.exp(-KAPPA * T)) / (KAPPA * T)
ivT = lambda iv30, th, T: th + (iv30 - th) * g_(np.maximum(T, 1 / 12)) / g_(1 / 12)
def bs_put(S, K, T, rr, v):
    T = np.maximum(T, 1e-6); sq = v * np.sqrt(T); d1 = (np.log(S / K) + (rr + v * v / 2) * T) / sq
    return K * np.exp(-rr * T) * Nv(-(d1 - sq)) - S * Nv(-d1)
OUT["puts"] = {}
Os = O.sample(frac=.25, random_state=3) if len(O) > 300000 else O               # 25% sample: erf vectorised is slow
fs = (Os.rsi14 < 40) & (Os.vix_pct >= .8)
for D, dl in ((365, -.5), (180, -.5), (90, -.5)):
    T = D / 365; z = -0.0                                                         # Δ −0.5 → d1 = 0
    v0 = ivT(Os.iv30, Os.theta, T) + .05
    K = Os.S * np.exp((Os.r + v0 ** 2 / 2) * T)                                  # d1 = 0
    p0 = bs_put(Os.S, K, T, Os.r, v0) * 1.02
    for h in (20, 60):
        T1 = T - h / 252
        if T1 <= .02: continue
        p1 = bs_put(Os[f"S{h}"], K, T1, Os[f"r{h}"], ivT(Os[f"iv30_{h}"], Os[f"theta{h}"], T1)) * .98
        ret = p1 / p0 - 1
        xx = ret - ret.groupby([Os.sym, Os.per]).transform("mean")
        OUT["puts"][f"{D}d Δ-0.5 {h}d"] = {p: dict(fear_ret=r(ret[fs & (Os.per == p)].mean() * 100), all_ret=r(ret[Os.per == p].mean() * 100),
                                                    fear_excess=r(xx[fs & (Os.per == p)].mean() * 100),
                                                    t=r(tm(xx[fs & (Os.per == p)].fillna(0), Os.mon[fs & (Os.per == p)])),
                                                    fear_pos=r((ret[fs & (Os.per == p)] > 0).mean() * 100, 1)) for p in (IS, OOS)}

# ── 12. regimes, episodes, losing streaks ───────────────────────────────────
Fd = F[F.fwd20.notna()].copy()
addd = (Fd.rsi14 < 40) & (Fd.vix_pct >= .8)
OUT["regime"] = {f"{p}|{lab}": stat(Fd[addd & (Fd.per == p) & m]) for p in (IS, OOS)
                 for lab, m in (("SPY>200d", Fd.spy_trend > 0), ("SPY<200d", Fd.spy_trend <= 0))}
spy = Fd[Fd.sym == "SPY"].set_index("date").vix_pct >= .8
ep = (spy & ~spy.shift(1, fill_value=False)).cumsum()[spy]
E = Fd[addd].assign(ep=Fd[addd].date.map(ep)).dropna(subset=["ep"])
E = E.groupby("ep").agg(start=("date", "min"), n=("fwd20", "size"), x20=("fwd20x", "mean"), x60=("fwd60x", "mean"),
                        spy_trend=("spy_trend", "first")).sort_values("start")
def streak(s):
    best = cur = 0
    for v in s:
        cur = cur + 1 if v < 0 else 0; best = max(best, cur)
    return best
OUT["episodes"] = {"n": int(len(E)), "pos20": int((E.x20 > 0).sum()), "pos60": int((E.x60 > 0).sum()),
                   "max_losing_streak60": streak(E.x60.dropna()), "max_losing_streak20": streak(E.x20.dropna()),
                   "worst60": [dict(start=str(a.start.date()), x60=r(a.x60 * 100, 1), n=int(a.n)) for a in E.nsmallest(5, "x60").itertuples()],
                   "by_regime": {lab: dict(n=int(m.sum()), pos60=int((E.x60[m] > 0).sum()), mean60=r(E.x60[m].mean() * 100))
                                 for lab, m in (("SPY>200d", E.spy_trend > 0), ("SPY<200d", E.spy_trend <= 0))}}
E.assign(start=E.start.astype(str)).to_csv("episodes.csv")

json.dump(OUT, open("review.json", "w"), indent=1, default=str)
print(json.dumps({k: OUT[k] for k in ("counts", "buckets", "iv_gate_pick_IS", "episodes")}, indent=1, default=str))
