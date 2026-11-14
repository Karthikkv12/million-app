"""Rebuild of the add rule (2026-11-14). Run after review.py. Every threshold here is CHOSEN on 1995–2014 (IS) only.

A. Continuous fear score → add size 0 / half / full (weights and cutoffs picked on IS).
B. Sizing instead of more filters: ≤ 3 tranches ≥ 10 trading days apart, pause after 2 losing tranches in a row.
C. Covered calls on fear dips / calm weakness: skip, 0.15Δ, 0.30Δ (usual), 0.50Δ.
D. Survivorship: how much the edge shrinks if the universe had held names that went to zero.
→ rebuild.json"""
import itertools, json, math, numpy as np, pandas as pd

F = pd.read_pickle("F.pkl").sort_values(["sym", "date"]).reset_index(drop=True)
F["per"] = np.where(F.date < "2015", "IS", "OOS"); F["mon"] = F.date.dt.to_period("M")
for h in ("fwd20", "fwd60"):
    F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
OUT = {}


def tm(x, mon):
    m = pd.Series(np.asarray(x, float)).groupby(np.asarray(mon)).mean().dropna()
    return float(m.mean() / (m.std() / np.sqrt(len(m)))) if len(m) > 2 else float("nan")


def r(x, n=2):
    return None if x is None or not np.isfinite(x) else round(float(x), n)


def stat(D):
    return dict(n=int(len(D)), x20=r(D.fwd20x.mean() * 100), x60=r(D.fwd60x.mean() * 100), up20=r((D.fwd20 > 0).mean() * 100, 1),
                beat60=r((D.fwd60x > 0).mean() * 100, 1), t20=r(tm(D.fwd20x.fillna(0), D.mon)), t60=r(tm(D.fwd60x.fillna(0), D.mon)))


# ── A. continuous fear score ─────────────────────────────────────────────────
fv = np.clip((F.vix_pct - .5) / .5, 0, 1)                 # market fear: 0 at the median VIX, 1 at the year's high
fr = np.clip((50 - F.rsi14) / 30, 0, 1)                   # oversold: 0 at RSI 50, 1 at RSI 20
fd = np.clip(-F.d_ma50 / .20, 0, 1)                       # depth: 0 at the 50-day, 1 at 20% under
D = F[F.fwd60.notna()].copy()
IS_ = D.per == "IS"
best, grid = None, []
for form, (wv, wr, wd) in itertools.product(("sum", "product"), itertools.product((1, 2, 3), (0, 1, 2), (0, 1, 2))):
    if wr == wd == 0:
        continue
    if form == "sum":
        s = (wv * fv + wr * fr + wd * fd) / (wv + wr + wd)
    else:                                                 # fear × stock weakness: no market fear → no score
        s = fv ** (wv / 2) * ((wr * fr + wd * fd) / (wr + wd))
    s = s.loc[D.index]
    cut = s[IS_].quantile(.925)                            # the same 7.5% of days the binary rule fires on
    m = IS_ & (s >= cut)
    t = tm(D.fwd60x[m], D.mon[m])
    grid.append((form, wv, wr, wd, r(t), r(D.fwd60x[m].mean() * 100)))
    if best is None or t > best[0]:
        best = (t, form, wv, wr, wd)
OUT["score_grid_IS"] = grid
_, form, wv, wr, wd = best
F["score"] = ((wv * fv + wr * fr + wd * fd) / (wv + wr + wd)) if form == "sum" else fv ** (wv / 2) * ((wr * fr + wd * fd) / (wr + wd))
D = F[F.fwd60.notna()].copy()
# cutoffs on IS: score deciles of the top 20%; full = lowest cutoff whose IS t60 ≥ 3 and x60 ≥ 2%, half = t60 ≥ 2 and x60 ≥ 1%
qs = np.arange(.80, .995, .005)
cuts = [(q, float(D.score[D.per == "IS"].quantile(q))) for q in qs]
def bucket_ok(lo, need_t, need_x):
    m = (D.per == "IS") & (D.score >= lo)
    return tm(D.fwd60x[m], D.mon[m]) >= need_t and D.fwd60x[m].mean() >= need_x
full = next((c for q, c in cuts if bucket_ok(c, 3.0, .02)), cuts[-1][1])
half = next((c for q, c in cuts if bucket_ok(c, 2.0, .01)), full)
F["size"] = np.where(F.score >= full, 1.0, np.where(F.score >= half, .5, 0.0))
D = F[F.fwd60.notna()].copy()
binary = (D.rsi14 < 40) & (D.vix_pct >= .8)
OUT["score"] = dict(form=form, w_vix=wv, w_rsi=wr, w_depth=wd, half=r(half, 3), full=r(full, 3),
                    note="components: vix=clip((vix_pct-.5)/.5), rsi=clip((50-rsi14)/30), depth=clip(-d_ma50/.20), each 0..1")
OUT["score_vs_binary"] = {f"{p}|{k}": stat(D[(D.per == p) & m]) for p in ("IS", "OOS") for k, m in (
    ("binary ADD (RSI<40 & VIX≥80th)", binary), ("score full", D["size"] == 1), ("score half", D["size"] == .5),
    ("score half+full", D["size"] > 0), ("score full, not binary", (D["size"] == 1) & ~binary), ("binary, score 0", binary & (D["size"] == 0)))}

# option outcome for the same sets (365d 0.80Δ, stress)
O = pd.read_pickle("O.pkl").merge(F[["sym", "date", "size"]], on=["sym", "date"], how="left")
O["per"] = np.where(O.date < "2015", "IS", "OOS"); O["mon"] = O.date.dt.to_period("M")
ob = (O.rsi14 < 40) & (O.vix_pct >= .8)
for h in (20, 60):
    c = f"o_365_0.8_stress_{h}"; xx = O[c] - O.groupby(["sym", "per"])[c].transform("mean")
    for p in ("IS", "OOS"):
        for k, m in (("binary", ob), ("score full", O["size"] == 1), ("score half", O["size"] == .5)):
            mm = m & (O.per == p) & O[c].notna()
            OUT.setdefault("score_options", {})[f"{h}|{p}|{k}"] = dict(n=int(mm.sum()), ret=r(O.loc[mm, c].mean() * 100), x=r(xx[mm].mean() * 100),
                                                                     up=r((O.loc[mm, c] > 0).mean() * 100, 1), t=r(tm(xx[mm], O.mon[mm])))


# ── B. sizing: tranches, spacing, pause ──────────────────────────────────────
F["r1n"] = F.groupby("sym").px.shift(-1) / F.px - 1


def tranche_policy(sig, size=None, max_tr=3, gap=10, pause_after=2, pause_days=60, hold=60, step=0.5 / 3):
    """Exposure path per symbol. A signal day adds one tranche (step × size) if ≥ gap days since the last add, < max_tr
    open, and not paused. A tranche lives `hold` days; when it closes, its own return (stock over its life) decides
    win / loss; `pause_after` losses in a row → no adds for `pause_days`. Point-in-time: a loss is known when it closes."""
    w = np.ones(len(F)); sizes = np.ones(len(F)) if size is None else size
    for _, idx in F.groupby("sym").indices.items():
        px = F.px.values[idx]; s = sig[idx]; sz = sizes[idx]
        open_ = []; last = -10 ** 9; losses = 0; paused_until = -1
        for i in range(len(idx)):
            still = []
            for (start, amt) in open_:
                if i - start >= hold:
                    losses = losses + 1 if px[i] < px[start] else 0
                    if pause_after and losses >= pause_after:
                        paused_until = i + pause_days; losses = 0
                else:
                    still.append((start, amt))
            open_ = still
            if s[i] and sz[i] > 0 and i - last >= gap and len(open_) < max_tr and i >= paused_until:
                open_.append((i, step * 3 * sz[i] / max_tr if max_tr else 0)); last = i
            w[idx[i]] = 1 + sum(a for _, a in open_)
    return w


def persist(sig, days):
    s = pd.Series(np.asarray(sig, float), index=F.index)
    return s.groupby(F.sym.values).transform(lambda x: x.replace(0, np.nan).ffill(limit=days - 1).fillna(0)).values > 0


bsig = ((F.rsi14 < 40) & (F.vix_pct >= .8)).values
POL = {"buy&hold": np.ones(len(F)),
       "OLD: ADD → 1.5× for 60d": np.where(persist(bsig, 60), 1.5, 1.0),
       "binary, 3 tranches ≥10d apart": tranche_policy(bsig, pause_after=0),
       "binary, 3 tranches + pause after 2 losses": tranche_policy(bsig),
       "score-sized, 3 tranches + pause": tranche_policy(F["size"].values > 0, F["size"].values)}


def mdd(x):
    eq = (1 + x.fillna(0)).cumprod(); return float((eq / eq.cummax() - 1).min())


crises = {"2008": ("2007-10-01", "2009-03-31"), "2022": ("2022-01-01", "2022-10-31"), "2020": ("2020-02-15", "2020-04-30"),
          "2000-02": ("2000-03-01", "2002-10-31")}
OUT["sizing"] = {}
for k, w in POL.items():
    F["ret"] = w * F.r1n; F["ex"] = (w - 1) * F.r1n                # ex: the overlay's own P&L (vs buy & hold)
    for p in ("IS", "OOS"):
        Dp = F[(F.per == p)].dropna(subset=["ret"]); g = Dp.groupby("sym").ret
        ann, vol = g.mean() * 252, g.std() * np.sqrt(252)
        # worst 60-day window of the overlay's excess, averaged across symbols (portfolio of all symbols, equal weight)
        port = Dp.groupby("date").ex.mean()
        roll = port.rolling(60).sum()
        OUT["sizing"][f"{p}|{k}"] = dict(ann=r(ann.mean() * 100, 1), sharpe=r((ann / vol).mean(), 3), maxdd=r(g.apply(mdd).mean() * 100, 1),
                                        port_maxdd=r(mdd(Dp.groupby("date").ret.mean()) * 100, 1),
                                        overlay_ann=r(port.mean() * 252 * 100, 2), overlay_worst60=r(roll.min() * 100, 2),
                                        avg_exposure=r(w[(F.per == p).values].mean(), 3))
    for c, (a, b) in crises.items():
        m = F.date.between(a, b)
        OUT["sizing"].setdefault(f"crisis|{k}", {})[c] = r(F[m].groupby("date").ex.mean().sum() * 100, 2)


# ── C. covered calls ─────────────────────────────────────────────────────────
coef = np.load("ivcoef.npy"); I = pd.read_pickle("ividx.pkl"); P = pd.read_pickle("prices.pkl")
def norm(s):
    s = s.copy(); s.index = (s.index.tz_localize(None) if s.index.tz is not None else s.index).normalize(); return s
vix = norm(I["^VIX"]); vrel = vix / vix.rolling(252).median(); rate = (norm(I["^IRX"]) / 100).clip(lower=0)
def erf(x):
    s = np.sign(x); x = np.abs(x); t = 1 / (1 + 0.3275911 * x)
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x))
Nf = lambda x: 0.5 * (1 + erf(x / np.sqrt(2)))
def call(S, K, T, rr, v):
    sq = v * np.sqrt(T); d1 = (np.log(S / K) + (rr + v * v / 2) * T) / sq
    return S * Nf(d1) - K * np.exp(-rr * T) * Nf(d1 - sq)
Z = {"0.15": -1.036433, "0.30": -0.524401, "0.50": 0.0}
CYC, T = 21, 30 / 365
rows = []
for s in P.index.get_level_values(0).unique():
    d = P.loc[s]; d = d[d.Close > 0]; d.index = (d.index.tz_localize(None) if d.index.tz is not None else d.index).normalize()
    c = d.Close; lr = np.log(c).diff(); hv = {n: lr.rolling(n).std() * np.sqrt(252) for n in (20, 60, 252)}
    iv = np.exp(coef[0] + coef[1] * np.log(hv[20]) + coef[2] * np.log(hv[60]) + coef[3] * np.log(hv[252]) + coef[4] * np.log(vrel.reindex(c.index).ffill()))
    rr = rate.reindex(c.index).ffill()
    df = pd.DataFrame({"S": c, "iv": iv, "r": rr}).dropna()
    out = pd.DataFrame(index=df.index); out["sym"] = s
    def cycle(k, delta):                                       # covered-call cycle starting k cycles after t: $ P&L per $1 of S_t
        S0, v, r0 = df.S.shift(-k * CYC), df.iv.shift(-k * CYC), df.r.shift(-k * CYC)
        S1 = df.S.shift(-(k + 1) * CYC)
        if delta == "skip":
            return (S1 - S0) / df.S
        K = S0 * np.exp(-Z[delta] * v * np.sqrt(T) + (r0 + v * v / 2) * T)
        prem = call(S0, K, T, r0, v) * 0.97                    # sold at 3% under model mid
        return (np.minimum(S1, K) - S0 + prem) / df.S
    for dlt in ("skip", "0.15", "0.30", "0.50"):
        out[f"cc20_{dlt}"] = cycle(0, dlt)
        out[f"cc60_{dlt}"] = cycle(0, dlt) + cycle(1, "0.30") + cycle(2, "0.30")   # the choice is the first month only
    rows.append(out)
C = pd.concat(rows).reset_index().rename(columns={"index": "date", "Date": "date"})
C = C.merge(F[["sym", "date", "rsi14", "vix_pct", "dd52", "d_ma50", "size"]], on=["sym", "date"], how="inner")
C["per"] = np.where(C.date < "2015", "IS", "OOS"); C["mon"] = C.date.dt.to_period("M")
fear = (C.rsi14 < 40) & (C.vix_pct >= .8)
caution = ~fear & (C.vix_pct < .6) & ((C.dd52 <= -.10) | (C.d_ma50.between(.03, .15) & (C.rsi14 > 65)))
OUT["covered"] = {}
for setn, m in (("fear dip", fear), ("calm weakness", caution), ("all days", C.rsi14.notna())):
    for h in (20, 60):
        for p in ("IS", "OOS"):
            mm = m & (C.per == p)
            base = C.loc[mm, f"cc{h}_0.30"]
            row = {"0.30 (usual) %": r(base.mean() * 100)}
            for dlt in ("skip", "0.15", "0.50"):
                diff = C.loc[mm, f"cc{h}_{dlt}"] - base
                row[f"{dlt} minus 0.30"] = r(diff.mean() * 100); row[f"t {dlt}"] = r(tm(diff.fillna(0), C.mon[mm]))
            row["n"] = int(mm.sum())
            OUT["covered"][f"{setn}|{h}d|{p}"] = row


# ── D. survivorship estimate ─────────────────────────────────────────────────
D = F[F.fwd60.notna()]; a = (D.rsi14 < 40) & (D.vix_pct >= .8)
per_sym = D[a & (D.per == "OOS")].groupby("sym").fwd60x.mean()
low = F.groupby("sym").dd52.min()
crashed = set(low[low <= -.7].index)
bot = per_sym[per_sym <= per_sym.quantile(.1)].mean()
edge = D[a & (D.per == "OOS")].fwd60x.mean()
OUT["survivorship"] = dict(edge60_oos=r(edge * 100), crashed_names=len(crashed),
                           edge60_crashed=r(D[a & (D.per == "OOS") & D.sym.isin(crashed)].fwd60x.mean() * 100),
                           edge60_other=r(D[a & (D.per == "OOS") & ~D.sym.isin(crashed)].fwd60x.mean() * 100),
                           bottom_decile_symbols=r(bot * 100),
                           shrunk={f"{int(sh*100)}% dead names": r(((1 - sh) * edge + sh * bot) * 100) for sh in (.05, .10, .20)})
json.dump(OUT, open("rebuild.json", "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in OUT.items() if k != "score_grid_IS"}, indent=1, default=str))
