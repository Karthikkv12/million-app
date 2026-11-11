"""Shared helpers: a Black-Scholes-priced chain so deltas and premiums are consistent."""
import math
from datetime import date, timedelta

from optionflow.modules.hedge import bs
from optionflow.modules.hedge.suggest import Quote


def price(S, K, dte, iv, otype, r=bs.R_DEFAULT):
    T = dte / 365
    d1 = (math.log(S / K) + (r + iv * iv / 2) * T) / (iv * math.sqrt(T))
    d2 = d1 - iv * math.sqrt(T)
    N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))   # noqa: E731
    if otype == "call":
        return S * N(d1) - K * math.exp(-r * T) * N(d2)
    return K * math.exp(-r * T) * N(-d2) - S * N(-d1)


def expiry(dte, today=None):
    return ((today or date.today()) + timedelta(days=int(dte))).isoformat()


def chain(spot=100.0, iv=0.40, dtes=(5, 30), lo=70, hi=130, step=1.0):
    out = []
    for dte in dtes:
        e = expiry(dte)
        k = lo
        while k <= hi:
            for t in ("call", "put"):
                m = round(price(spot, k, dte, iv, t), 2)
                if m > 0.01:
                    q = Quote(float(k), t, iv, round(m * 0.97, 2), round(m * 1.03, 2), m, float(dte), e)
                    q.delta = bs.delta(spot, k, bs.year_fraction(dte), iv, t)
                    out.append(q)
            k += step
    return out


def rows(spot=100.0, iv=0.40, dtes=(30,), lo=70, hi=130, oi=500):
    """Chain rows as the provider's option_contracts returns them."""
    out = []
    for q in chain(spot, iv, dtes, lo, hi):
        out.append({"strike": q.strike, "expiry": q.expiry, "otype": q.otype, "oi": oi, "volume": 10,
                    "bid": q.bid, "ask": q.ask, "last": q.mid, "iv": q.iv})
    return out
