"""Today's desk read for four holdings, from the live signal (optionflow.modules.hedge), each held as one 0.80Δ-ish
call ~400 days out (the decay column is for that sample contract, not the account's own legs)."""
import json, logging, sys
from datetime import date, timedelta
logging.disable(logging.CRITICAL)
sys.path.insert(0, "/home/user/million-app")
from optionflow.modules.hedge import service as sv
from optionflow.modules.hedge.signal import rsi, sma
from optionflow.modules.hedge.suggest import Leg
CODE = open(__file__).read()
rows = []
for sym, k in (("BABA", 80), ("NBIS", 95), ("NOW", 85), ("NVDA", 135)):
    b = sv.build_book(sym, [Leg("option", 1, 20.0, "call", float(k), str(date.today() + timedelta(days=400)))], None, ["x"], None)
    g = b["signal"]; leg = g["legs"][0] if g["legs"] else {}
    rsi_v = next((r["value"] for r in g["reads"] if r["key"] == "momentum"), "")
    dip = next((r["value"] for r in g["reads"] if r["key"] == "dip"), "")
    rows.append({"ticker": sym, "price": b["spot"], "rsi": float(rsi_v.split()[-1]) if rsi_v else None,
                 "vs_50day": float(dip.split("%")[0]) if dip else None, "vix_pct": round(g["vix_pct"] * 100) if g["vix_pct"] is not None else None,
                 "iv_vs_normal": g["iv_ratio"], "verdict": g["verdict"].title(), "headline": g["headline"],
                 "sample_leg_decay20": round(leg["decay_20d"] * 100, 1) if leg else None, "as_of": str(date.today())})
    print(rows[-1])
json.dump({"rows": rows, "meta": [{"label": "holdings_data.py", "value": CODE, "type": "code", "lang": "python"},
                                  {"label": "Input", "value": "Live prices, option chains, VIX and 10 years of daily bars at the close of " + str(date.today())}]},
          open(sys.argv[1], "w"), ensure_ascii=False)
