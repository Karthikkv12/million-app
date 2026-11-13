import pandas as pd, numpy as np, json
F = pd.read_pickle("F.pkl"); F["per"] = np.where(F.date < "2015", "IS", "OOS")
for h in ("fwd20", "fwd60", "fwd20_open"): F[h + "x"] = F[h] - F.groupby(["sym", "per"])["fwd20" if h == "fwd20_open" else h].transform("mean")
ETF = set("SPY QQQ IWM DIA XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT KRE".split())
low = F.groupby("sym").dd52.min(); CR = set(low[low <= -.7].index) - ETF
F["grp"] = np.where(F.sym.isin(ETF), "ETF", np.where(F.sym.isin(CR), "crashed", "other"))
F = F.dropna(subset=["fwd20"])
add = (F.rsi14 < 40) & (F.vix_pct >= .8)
calm = F.vix_pct < .6
caution = calm & ((F.dd52 <= -.10) | (F.d_ma50.between(.03, .15) & (F.rsi14 > 65)))
hold = ~add & ~caution
out = {}
def st(D):
    return dict(n=int(len(D)), syms=int(D.sym.nunique()), days=int(D.date.nunique()), x20=round(D.fwd20x.mean()*100, 2),
                x20_open=round(D.fwd20_openx.mean()*100, 2), x60=round(D.fwd60x.mean()*100, 2), f20=round(D.fwd20.mean()*100, 2),
                hit=round((D.fwd20 > 0).mean()*100, 1), mdd=round(D.mdd20.mean()*100, 1),
                p10=round(D.fwd20.quantile(.1)*100, 1), p90=round(D.fwd20.quantile(.9)*100, 1))
for name, m in (("ADD", add), ("CAUTION", caution), ("HOLD", hold), ("ALL", F.fwd20.notna())):
    out[name] = {p: st(F[m & (F.per == p)]) for p in ("IS", "OOS")}
    out[name]["by_group"] = {g: st(F[m & (F.grp == g)]) for g in ("ETF", "crashed", "other")}
# years
yr = F[add].groupby(F.date.dt.year).agg(n=("fwd20", "size"), x20=("fwd20x", "mean"), x60=("fwd60x", "mean"), hit=("fwd20", lambda x: (x > 0).mean()))
yr[["x20", "x60", "hit"]] *= 100
out["ADD_years"] = yr.round(2).reset_index().rename(columns={"date": "year"}).to_dict("records")
# independent episodes: runs of consecutive market days where VIX ≥ 80th pct (from SPY's row)
spy = F[F.sym == "SPY"].set_index("date").vix_pct >= .8
ep = (spy & ~spy.shift(1, fill_value=False)).cumsum()[spy]
out["fear_episodes"] = int(ep.nunique()); out["fear_days"] = int(spy.sum())
# per-episode ADD outcome (average across stocks in the episode) → share of episodes positive
Fa = F[add].copy(); Fa["ep"] = Fa.date.map(ep)
e = Fa.dropna(subset=["ep"]).groupby("ep").agg(x20=("fwd20x", "mean"), x60=("fwd60x", "mean"), start=("date", "min"), n=("fwd20", "size"))
out["episodes_with_add"] = int(len(e)); out["episodes_pos20"] = int((e.x20 > 0).sum()); out["episodes_pos60"] = int((e.x60 > 0).sum())
worst = e.sort_values("x20").head(5); out["worst_episodes"] = [dict(start=str(r.start.date()), x20=round(r.x20*100, 1), x60=round(r.x60*100, 1), n=int(r.n)) for r in worst.itertuples()]
best = e.sort_values("x20").tail(3); out["best_episodes"] = [dict(start=str(r.start.date()), x20=round(r.x20*100, 1), x60=round(r.x60*100, 1), n=int(r.n)) for r in best.itertuples()]
crises = {"2000-02 dot-com": ("2000-03-01", "2002-10-31"), "2008-09 GFC": ("2007-10-01", "2009-03-31"), "2020 Covid": ("2020-02-15", "2020-04-30"), "2022 bear": ("2022-01-01", "2022-10-31")}
out["crises"] = {k: st(F[add & F.date.between(a, b)]) for k, (a, b) in crises.items()}
out["universe"] = dict(symbols=int(F.sym.nunique()), rows=int(len(pd.read_pickle("F.pkl"))), first=str(F.date.min().date()), last=str(pd.read_pickle("F.pkl").date.max().date()), crashed=len(CR), etfs=len(ETF))
json.dump(out, open("final.json", "w"), indent=1, default=str)
for k in ("ADD", "CAUTION", "HOLD", "ALL"): print(k, out[k]["IS"], "\n   OOS", out[k]["OOS"], "\n   groups", {g: (v["x20"], v["x60"], v["n"]) for g, v in out[k]["by_group"].items()})
print("fear episodes", out["fear_episodes"], "days", out["fear_days"], "| with ADD", out["episodes_with_add"], "pos20", out["episodes_pos20"], "pos60", out["episodes_pos60"])
print("worst", out["worst_episodes"]); print("best", out["best_episodes"])
print("crises", {k: (v["n"], v["x20"], v["x60"], v["hit"], v["mdd"]) for k, v in out["crises"].items()})
print(pd.DataFrame(out["ADD_years"]).to_string(index=False))
