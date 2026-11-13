"""Rows for the dashboard from probs.py's output (probs.json); Add also shown conservatively, as the desk does."""
import json
P = json.load(open("probs.json"))
add, fear = P["ADD"], P["TRIM"]
names = [("ADD", "Add (IV-gated, as backtested)"), ("ADD_CONS", "Add as the desk shows it (conservative)"),
         ("FEAR_IV_NORMAL", "Fear dip, stock IV normal"), ("LEAN", "Oversold, market not scared"),
         ("CAUTION", "Don't add"), ("HOLD", "Hold (everything else)"), ("TRIM", "Take profit on puts (fear dip)")]
P["ADD_CONS"] = {k: (min(add[k], fear[k]) if k.startswith("p_") and add[k] is not None else fear[k]) for k in add}
rows = []
for k, label in names:
    v = P[k]
    rows.append({"signal": label, "p_up_60": round(v["p_up_60"] * 100, 1), "p_beat_60": None if k == "TRIM" else round(v["p_beat_60"] * 100, 1),
                 "p_option_profit_60": None if k == "TRIM" else round(v["p_option_profit_60"] * 100, 1),
                 "edge_60": round(v["edge_60"] * 100, 2), "edge_lo": round(v["edge_lo"] * 100, 2), "edge_hi": round(v["edge_hi"] * 100, 2),
                 "p_edge_positive": round(v["p_edge_positive"] * 100, 1), "cases": v["cases"], "months": v["months"]})
json.dump({"rows": rows, "meta": [{"label": "probs.py", "value": open("probs.py").read(), "type": "code", "lang": "python"},
                                  {"label": "prob_rows.py", "value": open(__file__).read(), "type": "code", "lang": "python"},
                                  {"label": "Input", "value": "F.pkl / O.pkl, 2015–2026 (unseen when the rules were set)"}]},
          open("summary/probabilities.json", "w"), ensure_ascii=False)
for r in rows: print(r)
