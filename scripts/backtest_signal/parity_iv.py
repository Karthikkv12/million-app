import sys, pandas as pd, numpy as np
sys.path.insert(0, "/home/user/million-app")
from optionflow.modules.hedge import signal as sg
B = ""   # run from the folder holding the .pkl files
O = pd.read_pickle(B + "O.pkl"); P = pd.read_pickle(B + "prices.pkl"); I = pd.read_pickle(B + "ividx.pkl")
def norm(s):
    s = s.copy(); s.index = (s.index.tz_localize(None) if s.index.tz is not None else s.index).normalize(); return s
V = norm(I["^VIX"])
O["ivr"] = O.iv30 / O.theta
S = O.dropna(subset=["ivr"]).sample(1000, random_state=3)
diffs, gate_agree = [], 0
for _, r in S.iterrows():
    d = P.loc[r.sym]; d = d[d.Close > 0]; d.index = (d.index.tz_localize(None) if d.index.tz is not None else d.index).normalize()
    d = d[d.index <= r.date].iloc[-2600:]; v = V[V.index <= r.date].iloc[-2600:]
    now, base, ratio = sg.iv_model(list(d.Close), list(v), [str(x.date()) for x in d.index], [str(x.date()) for x in v.index])
    diffs.append(abs(ratio - r.ivr)); gate_agree += (ratio >= 1.2) == (r.ivr >= 1.2)
print(f"IV-ratio parity on 1,000 random days: max |diff| {max(diffs):.2e}, gate agrees {gate_agree}/1000")
