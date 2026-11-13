import pandas as pd, numpy as np
F = pd.read_pickle("F.pkl")
F = F[~F.sym.isin(["^VIX"])]
feats = ["p_score","p_trend","p_volume","p_momentum","d_ma20","d_ma50","d_ma100","d_ma200","ma50_200","slope200","ret5","ret20","ret60",
         "ret120","ret252","mom12_1","rsi14","rsi2","rv","obv20","upvol20","hv20","hv_ratio","hv_pct","dd52","up52","stoch20",
         "rs60","rs120","spy_trend","vix","vix_rel","vix_pct"]
def rankcorr(a, b):
    m = a.notna() & b.notna()
    return np.corrcoef(a[m].rank(), b[m].rank())[0, 1] if m.sum() > 50 else np.nan
rows = []
for per, D in [("IS", F[F.date < "2015"]), ("OOS", F[F.date >= "2015"])]:
    D = D.dropna(subset=["fwd20"])
    # timing IC: within each symbol, demeaned by symbol → pooled rank corr; also yearly sign stability
    for tgt in ("fwd20", "fwd60", "mdd20"):
        y = D[tgt]
        for f in feats:
            ts = np.nanmean([rankcorr(g[f], g[tgt]) for _, g in D.groupby("sym")])
            rows.append((per, tgt, f, ts))
R = pd.DataFrame(rows, columns=["per", "tgt", "feat", "ic"]).pivot_table(index="feat", columns=["tgt", "per"], values="ic").round(3)
R = R[[("fwd20","IS"),("fwd20","OOS"),("fwd60","IS"),("fwd60","OOS"),("mdd20","IS"),("mdd20","OOS")]]
print("TIMING IC (rank corr within each stock over time, averaged over 148 stocks). mdd20: + = smaller drawdowns ahead")
print(R.sort_values(("fwd20","OOS")).to_string())
R.to_pickle("ic_timing.pkl")
