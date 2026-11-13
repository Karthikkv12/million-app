"""Builds the data-summary tables from the backtest data (F.pkl: stock features + outcomes, O.pkl: simulated calls).
Every number is recomputed here; each output is {rows, meta} JSON whose meta carries this script."""
import json, math, pandas as pd, numpy as np
CODE = open(__file__).read()
F = pd.read_pickle("F.pkl"); O = pd.read_pickle("O.pkl")
ETF = set("SPY QQQ IWM DIA XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT KRE".split())
F["per"] = np.where(F.date < "2015", "1995–2014", "2015–2026"); O["per"] = np.where(O.date < "2015", "1995–2014", "2015–2026")
for h in ("fwd20", "fwd60"): F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
low = F.groupby("sym").dd52.min(); CR = set(low[low <= -.7].index) - ETF
F["grp"] = np.where(F.sym.isin(ETF), "ETFs", np.where(F.sym.isin(CR), "Crashed stocks", "Other stocks"))
add = (F.rsi14 < 40) & (F.vix_pct >= .8); calm = F.vix_pct < .6
caution = calm & ((F.dd52 <= -.10) | (F.d_ma50.between(.03, .15) & (F.rsi14 > 65)))
F["rb"] = 100 * (np.clip(F.vix_pct * 2 - 1, -1, 1) + np.clip((50 - F.rsi14) / 25, -1, 1) + np.clip(-F.d_ma50 / .15, -1, 1)) / 3
lean = (F.rb.round() >= 50) & (F.rsi14 < 40) & (F.vix_pct < .8)
G = F.dropna(subset=["fwd20"])
r2 = lambda x: None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 2)
def write(name, rows, inputs):
    json.dump({"rows": rows, "meta": [{"label": "summary_data.py", "value": CODE, "type": "code", "lang": "python"},
                                      {"label": "Input", "value": inputs}]}, open(f"summary/{name}.json", "w"), ensure_ascii=False, indent=0)
    print(name, len(rows))
# 1 scope
spy = G[G.sym == "SPY"].set_index("date").vix_pct >= .8
ep = (spy & ~spy.shift(1, fill_value=False)).cumsum()[spy]
write("scope", [
    {"metric": "Symbol-days tested", "value": int(len(F))},
    {"metric": "Symbol-days with a 20-day outcome", "value": int(len(G))},
    {"metric": "Symbols", "value": int(F.sym.nunique())},
    {"metric": "Stocks", "value": int(F.sym.nunique() - len(ETF))},
    {"metric": "ETFs", "value": len(ETF)},
    {"metric": "Stocks that crashed 70%+", "value": len(CR)},
    {"metric": "Years of daily data", "value": round((F.date.max() - F.date.min()).days / 365.25, 1)},
    {"metric": "Rule-setting days (1995–2014)", "value": int((G.per == "1995–2014").sum())},
    {"metric": "Unseen test days (2015–2026)", "value": int((G.per == "2015–2026").sum())},
    {"metric": "Separate market-fear episodes", "value": int(ep.nunique())},
    {"metric": "Option-simulated symbol-days", "value": int(len(O))},
    {"metric": "Option setups simulated", "value": int(sum(c.startswith("o_") for c in O.columns))},
], "F.pkl (148 symbols' daily prices from Yahoo, 1995-01 → 2026-11, with features and forward returns); O.pkl (simulated calls)")
# 2 old signal
F["old"] = np.select([F.p_score >= 25, F.p_score <= -25], ["Add", "Trim"], "Hold")
rows = []
for (per, v), g in F[F.per == "2015–2026"].groupby(["per", "old"]):
    rows.append({"verdict": v, "next20": r2(g.fwd20.mean() * 100), "next60": r2(g.fwd60.mean() * 100), "worst_dip20": r2(g.mdd20.mean() * 100), "cases": int(len(g))})
write("old_signal", sorted(rows, key=lambda r: ["Add", "Hold", "Trim"].index(r["verdict"])), "F.pkl, 2015–2026; the pre-backtest score (trend 20, volume 15, momentum 10)")
# 3 setups
rows = []
for name, m in (("Add: oversold during market fear", add), ("Hold: oversold, VIX under 80th pct", lean & ~add),
                ("Don't add: calm-market weakness", caution & ~add), ("Hold: every other day", ~add & ~caution & ~lean)):
    for per in ("1995–2014", "2015–2026"):
        g = G[m & (G.per == per)]
        rows.append({"setup": name, "period": per, "excess20": r2(g.fwd20x.mean() * 100), "excess60": r2(g.fwd60x.mean() * 100),
                     "up20": r2((g.fwd20 > 0).mean() * 100), "cases": int(len(g))})
write("setups", rows, "F.pkl; excess = the stock's return minus its own average over the same period")
# 4 add by year
y = G[add].groupby(G.date.dt.year).agg(cases=("fwd20", "size"), excess20=("fwd20x", "mean"), excess60=("fwd60x", "mean"), up20=("fwd20", lambda x: (x > 0).mean()))
write("add_years", [{"year": int(i), "cases": int(r.cases), "excess20": r2(r.excess20 * 100), "excess60": r2(r.excess60 * 100), "up20": r2(r.up20 * 100)} for i, r in y.iterrows()], "F.pkl, Add days (RSI14 < 40, VIX ≥ 80th percentile)")
# 5 robustness
Ga = G[add]; ea = Ga.assign(ep=Ga.date.map(ep)).dropna(subset=["ep"]).groupby("ep").fwd20x.mean()
F["fwd20_openx"] = F.fwd20_open - F.groupby(["sym", "per"]).fwd20.transform("mean")
rows = [{"check": "Bought at the next open (2015–2026)", "value": r2(F[add & (F.per == "2015–2026")].fwd20_openx.mean() * 100), "unit": "% vs holding, 20 days"}]
for grp in ("ETFs", "Crashed stocks", "Other stocks"):
    rows.append({"check": f"{grp}", "value": r2(Ga[Ga.grp == grp].fwd20x.mean() * 100), "unit": "% vs holding, 20 days"})
rows += [{"check": "Fear episodes where Add beat holding", "value": int((ea > 0).sum()), "unit": f"of {len(ea)}"},
         {"check": "Years Add beat holding", "value": int((y.excess20 > 0).sum()), "unit": f"of {len(y)}"}]
for lab, a, b in (("2008 bear market", "2008-01-01", "2008-12-31"), ("2022 bear market", "2022-01-01", "2022-12-31")):
    g = Ga[Ga.date.between(a, b)]; rows.append({"check": lab, "value": r2(g.fwd60x.mean() * 100), "unit": "% vs holding, 60 days"})
write("robustness", rows, "F.pkl, Add days")
# 6 options
rows = []
ivr = O.iv30 / O.theta; oadd = (O.rsi14 < 40) & (O.vix_pct >= .8)
for name, m in (("Add: fear dip, stock IV ≥ 1.2× normal", oadd & (ivr >= 1.2)), ("Fear dip, stock IV normal", oadd & (ivr < 1.2)), ("Every day", O.rsi14.notna())):
    for h in (20, 60):
        col = f"o_365_0.8_stress_{h}"; x = O[col] - O.groupby(["sym", "per"])[col].transform("mean")
        mm = m & (O.per == "2015–2026") & O[col].notna()
        rows.append({"setup": name, "hold_days": h, "excess": r2(x[mm].mean() * 100), "absolute": r2(O.loc[mm, col].mean() * 100),
                     "made_money": r2((O.loc[mm, col] > 0).mean() * 100), "cases": int(mm.sum())})
write("options", rows, "O.pkl: 365-day 0.80Δ calls, Black-Scholes with the IV model, stress costs (+5 vol pts entry, 2% each way), 2015–2026")
# 7 theta curve (analytic)
def N(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def c(S, K, T, r, v):
    d1 = (math.log(S / K) + (r + v * v / 2) * T) / (v * math.sqrt(T)); return S * N(d1) - K * math.exp(-r * T) * N(d1 - v * math.sqrt(T))
rows = []
for D in (60, 90, 120, 150, 180, 240, 365, 540, 730):
    T = D / 365; v = .35; K = 100 * math.exp(-(0.841621 * v * math.sqrt(T)) + (.04 + v * v / 2) * T)
    rows.append({"days_left": D, "lost_per_20d": r2((1 - c(100, K, max(T - 20 / 252, 1e-4), .04, v) / c(100, K, T, .04, v)) * 100)})
write("theta", rows, "Black-Scholes, 0.80Δ call, IV 35%, rate 4%, price and IV unchanged (the curve barely moves with IV)")
