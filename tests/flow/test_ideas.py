"""flow.ideas: one contract per action from the dealer levels, with expiry, strike and how it fits the regime."""
import pandas as pd

from optionflow.modules.flow.ideas import trade_ideas
from tests.strategy.helpers import expiry, price


def chain_df(spot=100.0, iv=0.30, dtes=(3, 28, 49), lo=80, hi=120):
    rows = []
    for d in dtes:
        for k in range(lo, hi + 1):
            for t in ("call", "put"):
                rows.append({"strike": float(k), "expiry": expiry(d), "otype": t, "oi": 100, "volume": 10, "iv": iv,
                             "mid": round(price(spot, k, d, iv, t), 2), "gamma": 0.0, "T": d / 365})
    return pd.DataFrame(rows)


def by_action(ideas):
    return {i["action"]: i for i in ideas}


def test_long_gamma_sells_the_walls_and_buys_at_the_money():
    ideas = trade_ideas(chain_df(), 100.4, net_gex=5e9, zero_gamma=97.0, call_wall=105.0, put_wall=95.0, king=100.0)
    assert [i["action"] for i in ideas] == ["BUY_CALL", "SELL_CALL", "BUY_PUT", "SELL_PUT"]
    a = by_action(ideas)
    assert (a["SELL_CALL"]["strike"], a["SELL_PUT"]["strike"]) == (105.0, 95.0)            # at the walls
    assert a["SELL_CALL"]["expiry"] == a["SELL_PUT"]["expiry"] == expiry(28)                  # nearest 30 days
    assert (a["BUY_CALL"]["strike"], a["BUY_PUT"]["strike"]) == (101.0, 100.0)               # first strike each side
    assert a["BUY_CALL"]["expiry"] == a["BUY_PUT"]["expiry"] == expiry(49)                    # nearest 45 days
    assert a["BUY_CALL"]["target"] == 105.0 and a["BUY_PUT"]["target"] == 95.0
    assert {k: v["fit"] for k, v in a.items()} == {"SELL_CALL": "favored", "SELL_PUT": "favored",
                                                   "BUY_CALL": "against", "BUY_PUT": "against"}
    c = a["BUY_CALL"]
    assert c["dte"] == 49 and c["premium"] > 0 and 0 < c["delta"] < 1 and c["breakeven"] == round(101 + c["premium"], 2)
    assert a["SELL_PUT"]["delta"] < 0 and a["SELL_PUT"]["breakeven"] == round(95 - a["SELL_PUT"]["premium"], 2)


def test_short_gamma_below_the_flip_favours_the_put_and_warns_off_selling_it():
    a = by_action(trade_ideas(chain_df(), 100.4, net_gex=-2e9, zero_gamma=103.0, call_wall=105.0, put_wall=95.0))
    assert a["BUY_PUT"]["fit"] == "favored" and a["SELL_PUT"]["fit"] == "against"
    assert a["BUY_CALL"]["fit"] == a["SELL_CALL"]["fit"] == "neutral"
    a = by_action(trade_ideas(chain_df(), 100.4, net_gex=-2e9, zero_gamma=98.0, call_wall=105.0, put_wall=95.0))
    assert a["BUY_CALL"]["fit"] == "favored" and a["SELL_CALL"]["fit"] == "against"


def test_a_wall_behind_the_price_or_out_of_range_falls_back_to_the_quarter_delta_strike():
    a = by_action(trade_ideas(chain_df(), 100.4, net_gex=1.0, call_wall=99.0, put_wall=81.0, king=110.0))
    assert a["SELL_CALL"]["strike"] > 100.4 and abs(a["SELL_CALL"]["delta"] - 0.25) < 0.05
    assert "through the call wall 99" in a["SELL_CALL"]["reason"]
    assert a["SELL_PUT"]["strike"] > 81 and "too far" in a["SELL_PUT"]["reason"]
    assert a["BUY_CALL"]["target"] == 110.0 and "king" in a["BUY_CALL"]["reason"]            # wall is behind: aim at the king


def test_no_chain_no_ideas_and_dead_quotes_are_skipped():
    assert trade_ideas(pd.DataFrame(), 100.0) == []
    df = chain_df()
    df.loc[df["otype"] == "put", "mid"] = 0.0
    assert [i["action"] for i in trade_ideas(df, 100.4, call_wall=105.0)] == ["BUY_CALL", "SELL_CALL"]


def test_only_weeklies_listed_still_gives_an_expiry_past_the_gamma_trap():
    a = by_action(trade_ideas(chain_df(dtes=(2, 9)), 100.4, call_wall=103.0, put_wall=97.0))
    assert {i["expiry"] for i in a.values()} == {expiry(9)}


def test_buy_reason_says_when_the_wall_is_right_at_the_strike():
    a = by_action(trade_ideas(chain_df(), 100.4, call_wall=101.0, put_wall=100.0))
    assert a["BUY_CALL"]["target"] is None and "right at the call wall 101" in a["BUY_CALL"]["reason"]
    assert "right at the put wall 100" in a["BUY_PUT"]["reason"]
    a = by_action(trade_ideas(chain_df(), 100.4, call_wall=99.0, put_wall=102.0))
    assert "through the call wall 99" in a["BUY_CALL"]["reason"] and "through the put wall 102" in a["BUY_PUT"]["reason"]
