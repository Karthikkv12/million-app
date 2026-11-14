"""Swing round 3 (2026-11-14): 200 symbols (the 148 + 52 new, never used to pick a rule). Can the drop leg of the
swing rule be made sharper? Candidates chosen on 1995–2014 by month-clustered t AND average trade; 2015–2026 read once.
The 52 new names are a second hold-out: a rule that only works on the names it was tuned on fails there.

python swing3.py  (prices.pkl, vix.pkl, F.pkl from fetch.py + feats.py on the 200 names) → swing3.json
"""
import json
import numpy as np, pandas as pd
import swing as S

OLD148 = set("""AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO ORCL CRM ADBE AMD INTC QCOM TXN MU AMAT LRCX KLAC ASML TSM NFLX
NOW SNOW PLTR SHOP UBER ABNB PYPL COIN MSTR ZM DOCU TWLO NET CRWD DDOG MDB OKTA PANW FTNT ZS SMCI ARM DELL HPQ IBM CSCO
BABA JD PDD BIDU NIO XPEV LI SE MELI NBIS IONQ RGTI SOFI HOOD AFRM UPST RIVN LCID CHWY ETSY EBAY PARA DIS CMCSA T VZ JPM
BAC WFC C GS MS SCHW AXP V MA BRK-B BLK KRE XOM CVX OXY COP SLB HAL DVN FANG MPC JNJ PFE MRK ABBV LLY UNH CVS MRNA BIIB
GILD AMGN BMY WMT COST TGT HD LOW NKE SBUX MCD KO PEP PG CL KHC BA CAT DE GE HON LMT RTX UPS FDX F GM SPY QQQ IWM DIA
XLK XLF XLE XLV XLY XLP XLI SMH ARKK GLD SLV TLT""".split())

# SPY's 5-day return on each symbol's dates (stock-specific part of a drop)
spy = S.SYM["SPY"]
spy_r5 = pd.Series(spy["c"], index=pd.to_datetime(spy["dates"])).pct_change(5)
for s, a in S.SYM.items():
    a["spy_r5"] = spy_r5.reindex(pd.to_datetime(a["dates"])).values
    a["z5"] = a["ret5"] / (a["hv20"] * np.sqrt(5 / 252))          # the 5-day move in units of the stock's own vol

ADD = S.SETUPS["Add (fear score ≥ 0.283)"]
up = lambda a: a["d200"] > 0
SETUPS = {
    "CURRENT: Add or drop5 ≥ 5% above 200":  lambda a: ADD(a) | ((a["ret5"] <= -0.05) & up(a)),
    "Add or z5 ≤ −1.25 above 200":           lambda a: ADD(a) | ((a["z5"] <= -1.25) & up(a)),
    "Add or z5 ≤ −1.5 above 200":            lambda a: ADD(a) | ((a["z5"] <= -1.5) & up(a)),
    "Add or z5 ≤ −2 above 200":              lambda a: ADD(a) | ((a["z5"] <= -2.0) & up(a)),
    "Add or (drop5 ≥ 5% & z5 ≤ −1.25) above 200": lambda a: ADD(a) | ((a["ret5"] <= -0.05) & (a["z5"] <= -1.25) & up(a)),
    "Add or (drop5 ≥ 5% & z5 ≤ −1.5) above 200":  lambda a: ADD(a) | ((a["ret5"] <= -0.05) & (a["z5"] <= -1.5) & up(a)),
    "Add or stock-only drop ≥ 5% above 200": lambda a: ADD(a) | ((a["ret5"] - a["spy_r5"] <= -0.05) & up(a)),
    "Add or (drop5 ≥ 5% & stock-only ≥ 3%) above 200": lambda a: ADD(a) | ((a["ret5"] <= -0.05) & (a["ret5"] - a["spy_r5"] <= -0.03) & up(a)),
    "Add or drop5 ≥ 5% above 200, off high ≤ 25%": lambda a: ADD(a) | ((a["ret5"] <= -0.05) & up(a) & (a["dd52"] > -0.25)),
    "Add or drop5 ≥ 5% above 200, SPY above 200": lambda a: ADD(a) | ((a["ret5"] <= -0.05) & up(a) & (a["spy_trend"] > 0)),
}
EXIT = S.ex_ma("ma10", 20)


def row(t):
    a, b = S.split(t)
    new = t[~t.sym.isin(OLD148)]
    return {"is": a, "oos": b, "oos_new52": S.stats(new[new.date > S.IS_END]),
            "is_new52": S.stats(new[new.date <= S.IS_END])}


if __name__ == "__main__":
    out = {}
    fm = lambda x: f"{x['trades']:6d} {x['avg']:+5.2f}% {x['win']:4.1f}% {x['worst5']:+5.1f} t{x['t']:5.2f}" if x else "-"
    print(f"{'setup':48} | IS 1995–2014                   | OOS 2015–2026                  | OOS new 52 names")
    for sn, sf in SETUPS.items():
        t = S.trades(sf, EXIT)
        out[sn] = r = row(t)
        print(f"{sn:48} | {fm(r['is'])} | {fm(r['oos'])} | {fm(r['oos_new52'])}", flush=True)
    json.dump(out, open("swing3.json", "w"), indent=1)
