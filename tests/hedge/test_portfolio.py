"""/broker portfolio: account snapshots, activity upsert, holdings P&L, income buckets."""
from datetime import date, timedelta

import pytest

from tests.hedge.test_api import TOKEN, _login, client  # noqa: F401  (fixture re-use)

H = {"X-Hedge-Ingest-Token": TOKEN}
EXP = (date.today() + timedelta(days=5)).isoformat()


def body(day, total, activity=()):
    return {"username": "owner", "positions": [
        {"account": "Trading ••8453", "symbol": "UPST", "kind": "stock", "quantity": 100, "avg_price": 20.0},
        {"account": "Trading ••8453", "symbol": "UPST", "kind": "option", "quantity": -1, "avg_price": 0.59,
         "option_type": "call", "strike": 22.5, "expiry": EXP},
        {"account": "Roth IRA ••3792", "symbol": "MP", "kind": "stock", "quantity": 50, "avg_price": 30.0},
    ], "accounts": [
        {"account": "Trading ••8453", "day": day, "total_value": total, "cash": 1000, "buying_power": 5000},
        {"account": "Roth IRA ••3792", "day": day, "total_value": 1500, "cash": 0, "buying_power": 0},
    ], "activity": list(activity)}


FILL = {"ext_id": "leg-1", "account": "Trading ••8453", "kind": "option_fill", "ts": "2026-11-06T20:04:45Z",
        "symbol": "upst", "side": "sell", "position_effect": "open", "option_type": "call", "strike": 22.5,
        "expiry": "2026-11-13", "quantity": 1, "price": 0.59, "amount": 59.0, "strategy": "short_call"}
CLOSE = {**FILL, "ext_id": "leg-2", "ts": "2026-11-05T15:11:03Z", "side": "buy", "position_effect": "close",
         "price": 0.74, "amount": -74.0}
WIN = {"ext_id": "r-1", "account": "Trading ••8453", "kind": "realized", "ts": "2026-10-30T17:00:00Z",
       "symbol": "GOOG", "side": "sell", "quantity": 25, "price": 280.1, "realized_gain": 10.12}
LOSS = {**WIN, "ext_id": "r-2", "symbol": "SOFI", "ts": "2026-11-02T15:00:00Z", "realized_gain": -99.0}


def test_snapshots_history_and_day_change(client):
    c, fake = client
    fake.last_price = lambda s: {"UPST": 22.0, "MP": 33.0}[s]
    fake.quote = lambda s: {"symbol": s, "price": None, "prev_close": {"UPST": 21.0, "MP": 33.0}[s]}
    r1 = c.post("/api/v1/hedge/ingest", json=body("2026-11-05", 9000), headers=H).json()
    r2 = c.post("/api/v1/hedge/ingest", json=body("2026-11-06", 10000), headers=H).json()
    c.post("/api/v1/hedge/ingest", json=body("2026-11-06", 10100), headers=H)       # same day → updated, not added
    assert r1["accounts"] == 2 and r2["count"] == 3
    auth = _login(c, "owner")
    p = c.get("/api/v1/broker/portfolio", headers=auth).json()
    assert p["total_value"] == 11600 and p["day_change"] == 1100 and p["cash"] == 1000
    upst = next(h for h in p["holdings"] if h["symbol"] == "UPST")
    assert upst["market_value"] == 2200 and upst["unrealized"] == pytest.approx(200)
    assert upst["unrealized_pct"] == pytest.approx(0.1) and upst["day_change_pct"] == pytest.approx(22 / 21 - 1)
    assert upst["covered_pct"] == 1.0
    opt = p["options"][0]
    assert opt["premium"] == pytest.approx(59.0) and opt["moneyness"] == "OTM" and opt["dte"] in (4, 5, 6)
    roth = c.get("/api/v1/broker/portfolio", params={"account": "Roth IRA ••3792"}, headers=auth).json()
    assert roth["total_value"] == 1500 and [h["symbol"] for h in roth["holdings"]] == ["MP"] and roth["options"] == []
    hist = c.get("/api/v1/broker/history", params={"days": 3650}, headers=auth).json()
    assert [h["day"] for h in hist] == ["2026-11-05", "2026-11-06"] and hist[1]["total_value"] == 11600
    assert c.get("/api/v1/broker/portfolio", headers=_login(c, "other")).json()["holdings"] == []


def test_activity_upserts_and_income(client):
    c, fake = client
    fake.last_price = lambda s: 22.0
    r = c.post("/api/v1/hedge/ingest", json=body("2026-11-06", 10000, [FILL, CLOSE, WIN, LOSS]), headers=H).json()
    assert r["activity_new"] == 4 and r["activity_total"] == 4
    r = c.post("/api/v1/hedge/ingest", json=body("2026-11-06", 10000, [FILL, {**WIN, "realized_gain": 11.0}]), headers=H).json()
    assert r["activity_new"] == 0 and r["activity_total"] == 4                       # deduped by ext_id
    auth = _login(c, "owner")
    inc = c.get("/api/v1/broker/income", headers=auth).json()
    assert inc["premium_total"] == pytest.approx(59 - 74)
    assert inc["collected_total"] == 59 and inc["bought_back_total"] == 74
    assert inc["realized_total"] == pytest.approx(11.0 - 99.0)
    assert inc["trades"] == 2 and inc["win_rate"] == 0.5
    assert {m["period"] for m in inc["monthly"]} == {"2026-10", "2026-11"}
    assert inc["weekly"][-1]["period"] == "2026-11-02"                                # Monday of the ET week
    acts = c.get("/api/v1/broker/activity", headers=auth).json()
    assert [a["ext_id"] for a in acts] == ["leg-1", "leg-2", "r-2", "r-1"] and acts[0]["symbol"] == "UPST"
    assert c.get("/api/v1/broker/activity", headers=_login(c, "other")).json() == []


def test_income_keeps_long_options_out_of_premium(client):
    """Buying calls/puts you own is not a buy-back: it must not drag net premium down."""
    c, fake = client
    fake.last_price = lambda s: 22.0
    long_buy = {**FILL, "ext_id": "leg-L1", "ts": "2026-11-04T15:00:00Z", "side": "buy", "position_effect": "open",
                "strike": 25, "expiry": "2027-01-15", "quantity": 10, "price": 14.0, "amount": -14000.0, "strategy": "long_call"}
    long_sell = {**long_buy, "ext_id": "leg-L2", "ts": "2026-11-05T15:00:00Z", "side": "sell", "position_effect": "close", "amount": 500.0}
    spread_short = {**FILL, "ext_id": "leg-S1", "ts": "2026-11-03T15:00:10Z", "option_type": "put", "strike": 20, "amount": 120.0, "strategy": "short_put"}
    spread_long = {**spread_short, "ext_id": "leg-S2", "side": "buy", "strike": 18, "amount": -40.0, "strategy": "long_put"}
    c.post("/api/v1/hedge/ingest", json=body("2026-11-06", 10000, [FILL, CLOSE, long_buy, long_sell, spread_short, spread_long]), headers=H)
    inc = c.get("/api/v1/broker/income", headers=_login(c, "owner")).json()
    assert inc["premium_total"] == pytest.approx(59 - 74 + 120 - 40)              # spread's long leg stays in
    assert inc["long_paid_total"] == 14000
    wk = inc["weekly"][-1]
    assert wk["period"] == "2026-11-02" and wk["long_paid"] == 14000 and wk["long_received"] == 500
    assert inc["this_week"] and len(inc["this_week"]) == 10
