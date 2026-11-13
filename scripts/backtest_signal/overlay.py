"""Holder test: hold the stock at 1.0; a verdict sets exposure for the next day (decided at close t, applied t+1).
ADD → 1.5, TRIM/CAUTION → 0.5, HOLD → 1.0. Verdicts persist HOLD_DAYS once fired. Compare with buy & hold."""
import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl").sort_values(["sym", "date"])
F["r1n"] = F.groupby("sym").px.shift(-1) / F.px - 1          # next day's return (exposure decided at today's close)
ETF = set("SPY QQQ IWM DIA XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT KRE".split())
HOLD_DAYS = 20
def policies(D):
    old = np.select([D.p_score >= 25, D.p_score <= -25], [1.5, 0.5], 1.0)
    add = (D.rsi14 < 40) & (D.vix_pct >= .8)
    knife = (D.dd52 <= -.10) & (D.vix_pct < .6)
    stretched = (D.vix_pct < .6) & D.d_ma50.between(.03, .15) & (D.rsi14 > 65)
    def persist(sig):                                      # fire → stay on for HOLD_DAYS
        s = pd.Series(sig.astype(float).values, index=D.index)
        return s.groupby(D.sym.values).transform(lambda x: x.replace(0, np.nan).ffill(limit=HOLD_DAYS - 1).fillna(0)).values > 0
    a, k, st = persist(add), persist(knife), persist(stretched)
    new = np.where(a, 1.5, np.where(k | st, 0.5, 1.0))
    new_add_only = np.where(a, 1.5, 1.0)
    return {"buy&hold": np.ones(len(D)), "OLD signal": old, "NEW signal": new, "NEW add-only": new_add_only}
P = policies(F)
rows = []
for per, m in (("1995-2014", F.date < "2015"), ("2015-2026", F.date >= "2015"), ("ALL", F.date.notna())):
    for name, w in P.items():
        D = F[m].assign(ret=(w[m.values] * F[m].r1n)).dropna(subset=["ret"])
        # per symbol: annual return and Sharpe; then compare with buy&hold
        g = D.groupby("sym").ret
        ann = g.mean() * 252; vol = g.std() * np.sqrt(252); sh = ann / vol
        avg_exp = w[m.values].mean()
        rows.append((per, name, ann.mean()*100, vol.mean()*100, sh.mean(), (ann / avg_exp).mean()*100, avg_exp, sh))
R = pd.DataFrame(rows, columns=["period", "policy", "ann%", "vol%", "sharpe", "ann_per_exposure%", "avg_exposure", "sh"])
for per in ("1995-2014", "2015-2026", "ALL"):
    S = R[R.period == per].set_index("policy")
    base = S.loc["buy&hold", "sh"]
    S["beats_B&H_sharpe_%syms"] = [(s > base).mean()*100 for s in S.sh]
    print(f"\n### {per}  (average over symbols)")
    print(S.drop(columns=["period", "sh"]).round(3).to_string())
# how often each fires
add = (F.rsi14 < 40) & (F.vix_pct >= .8); knife = (F.dd52 <= -.10) & (F.vix_pct < .6)
st = (F.vix_pct < .6) & F.d_ma50.between(.03, .15) & (F.rsi14 > 65)
print(f"\nfire rate per symbol-day: ADD {add.mean():.1%}, KNIFE {knife.mean():.1%}, STRETCHED {st.mean():.1%}; OLD ADD {(F.p_score>=25).mean():.1%}, OLD TRIM {(F.p_score<=-25).mean():.1%}")
