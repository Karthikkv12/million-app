import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl"); F["per"] = np.where(F.date < "2015", "IS", "OOS")
for h in ("fwd20", "fwd60"): F[h + "x"] = F[h] - F.groupby(["sym", "per"])[h].transform("mean")
F = F.dropna(subset=["fwd20"]); F["mon"] = F.date.dt.to_period("M")
V = pd.read_pickle("vix.pkl"); V = V.iloc[:, 0] if isinstance(V, pd.DataFrame) else V
vmax5 = V.rolling(5).max(); F["vix_off_peak"] = (F.date.map(V) / F.date.map(vmax5) - 1)     # ≤ −x: fear already easing
add = (F.rsi14 < 40) & (F.vix_pct >= .8)
variants = {
  "ADD (base)": add,
  "ADD & SPY > 200d": add & (F.spy_trend > 0),
  "ADD & SPY < 200d": add & (F.spy_trend <= 0),
  "ADD & stock > 200d": add & (F.d_ma200 > 0),
  "ADD & VIX ≥ 95th": add & (F.vix_pct >= .95),
  "ADD & VIX off 5d peak ≥10%": add & (F.vix_off_peak <= -.10),
  "ADD & SPY<200d & VIX off peak ≥10%": add & (F.spy_trend <= 0) & (F.vix_off_peak <= -.10),
}
crisis = F.date.between("2007-10-01", "2009-03-31") | F.date.between("2022-01-01", "2022-10-31") | F.date.between("2000-09-01", "2002-10-31")
for k, m in variants.items():
    r = []
    for per in ("IS", "OOS"):
        D = F[m & (F.per == per)]; mm = D.groupby("mon").fwd20x.mean(); t = mm.mean() / (mm.std() / np.sqrt(len(mm)))
        r.append(f"{per}: n {len(D):6d} x20 {D.fwd20x.mean()*100:5.2f} x60 {D.fwd60x.mean()*100:5.2f} hit {(D.fwd20>0).mean()*100:4.1f} t {t:4.2f}")
    C = F[m & crisis]
    print(f"{k:38s} | " + " | ".join(r) + f" | bear-mkts: n {len(C)} x20 {C.fwd20x.mean()*100:5.2f} x60 {C.fwd60x.mean()*100:5.2f}")
