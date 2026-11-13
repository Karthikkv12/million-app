import sys, pandas as pd, numpy as np
sys.path.insert(0, "/home/user/million-app")
from optionflow.modules.hedge import signal as sg
B = ""   # run from the folder holding prices.pkl / vix.pkl / F.pkl
F = pd.read_pickle(B + "F.pkl"); P = pd.read_pickle(B + "prices.pkl"); V = pd.read_pickle(B + "vix.pkl")
V = V.iloc[:, 0] if isinstance(V, pd.DataFrame) else V
rng = np.random.default_rng(7); S = F.sample(3000, random_state=7)
agree = 0; bad = []
for _, r in S.iterrows():
    d = P.loc[r.sym]; d = d[(d.Close > 0) & (d.Volume > 0)]; d = d[d.index <= r.date].iloc[-260:]
    vx = V[V.index <= r.date].iloc[-252:]
    t = sg.Tape(float(d.Close.iloc[-1]), list(d.Close), list(d.Volume), list(d.High), list(d.Low), today_bar=True, vix=list(vx))
    s = sg.evaluate(t, 1.0)
    fear_dip = (r.rsi14 < 40) and (r.vix_pct >= .8)
    calm = r.vix_pct < .6
    exp = "ADD" if fear_dip else "CAUTION" if (calm and (r.dd52 <= -.10 or (0.03 <= r.d_ma50 <= .15 and r.rsi14 > 65))) else "HOLD"
    if s.verdict == exp: agree += 1
    else: bad.append((r.sym, r.date.date(), exp, s.verdict, round(r.rsi14, 2), round(r.vix_pct, 3), round(s.vix_pct or -1, 3)))
print(f"parity: {agree}/{len(S)} identical verdicts"); print(bad[:10])
