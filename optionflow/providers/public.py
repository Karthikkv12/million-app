"""optionflow/providers/public.py — real-time quotes and option chains from the Public.com Trading API.

Public.com is the default source for option chains (GEX/VEX heatmaps) and for
prices: quotes, last prices, batched last prices and the price fields of
watchlist rows. `PublicFirstMarketData` in market_data.py tries Public first and
falls back to Yahoo on any failure. Price history (daily and intraday bars) and
the option contracts behind the unusual scanner and the catalyst expected move
come from Public too. Search, company data (name, sector, valuation) and the
catalyst fields (earnings, analysts, dividends, news) stay on Yahoo: Public's
instrument API has no name, sector or search.

API (https://public.com/api/docs), all JSON, `Authorization: Bearer <token>`:
  POST /userapiauthservice/personal/access-tokens   {secret, validityInMinutes} → {accessToken}
  GET  /userapigateway/trading/account              → {accounts: [{accountId, accountType, optionsLevel}]}
  POST /userapigateway/marketdata/{acct}/quotes              {instruments: [{symbol, type}]} → {quotes: [...]}
  POST /userapigateway/marketdata/{acct}/option-expirations  {instrument} → {expirations: ["YYYY-MM-DD"]}
  POST /userapigateway/marketdata/{acct}/option-chain        {instrument, expirationDate} → {calls, puts}
  GET  /userapigateway/historicdata/{type}/{symbol}/{period}/{aggregation}
       → {regularMarket: {bars: [{timestamp, open, high, low, close, volume}]}, preMarket, afterMarket, ...}
       Timestamps are ISO with the US/Eastern offset (daily bars at ET midnight); prices are
       strings, volume may be fractional. An unknown symbol is HTTP 200 with no bars. Some
       period/aggregation pairs are refused with 400 (e.g. YEAR + ONE_MINUTE).
Each contract: openInterest, volume, bid, ask (strings), and
optionDetails {strikePrice, midPrice, greeks {gamma, impliedVolatility, ...}} (strings).
Indexes use type INDEX with the bare symbol (Yahoo "^SPX" → "SPX").
Limit: 10 requests/second per account; 429 over it.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pandas as pd

from optionflow.providers.market_data import (
    CHAIN_COLUMNS,
    CONTRACT_COLUMNS,
    ContractChain,
    MarketDataRateLimited,
    OptionChain,
    RateLimitGate,
)

logger = logging.getLogger("optionflow.marketdata.public")

BASE_URL = "https://api.public.com"
TOKEN_MINUTES = 60
MAX_CHAIN_DTE = 60            # same window as Yahoo: expiries within 60 days…
MAX_CHAIN_EXPIRIES = 12       # …at most 12 of them (the board shows 8)
MIN_REQUEST_GAP = 0.125       # seconds between requests: 8/s, under Public's 10/s
EXPIRIES_TTL = 3600.0         # expiry lists change at most daily
QUOTE_TTL = 1.0               # seconds a quote is reused: collapses bursts (hedge loop, pages) into one request
QUOTE_BATCH = 50              # instruments per quotes request
CHAIN_TTL = 20.0              # seconds a raw chain is reused: GEX, the scanner and catalysts share fetches
HISTORY_TTL_INTRADAY = 30.0   # seconds an intraday bar series is reused
HISTORY_TTL_DAILY = 300.0     # seconds a daily-or-longer bar series is reused

GATE = RateLimitGate(first=60.0, maximum=900.0, source="Public.com")   # separate from Yahoo's


class PublicError(Exception):
    """Public.com call failed (auth, bad symbol, server error); the caller falls back to Yahoo."""


def _f(v: Any) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None          # NaN → None


def instrument_for(symbol: str) -> Optional[Dict[str, str]]:
    """Public instrument for a Yahoo-style symbol, or None when Public can't serve it
    (non-US listings with an exchange suffix, futures, FX, indexes Public has refused)."""
    s = symbol.strip().upper()
    if s.startswith("^"):
        inst = {"symbol": s[1:], "type": "INDEX"}
    elif s.endswith("-USD") and s[:-4].isalpha():          # Yahoo crypto pair → Public CRYPTO
        inst = {"symbol": s[:-4], "type": "CRYPTO"}
    elif not s or any(c in s for c in ".=/"):
        return None
    else:
        inst = {"symbol": s, "type": "EQUITY"}
    return None if _key(inst) in _UNSUPPORTED else inst


# Instruments Public refused outright ("No enum constant …Index.TNX"): a request naming one fails
# for the whole batch, so they are dropped from then on and served by Yahoo.
_UNSUPPORTED: set = set()
_ENUM_REJECT = re.compile(r"No enum constant [\w.]*\.(\w+)\.(\w+)")


def _key(inst: Dict[str, str]) -> str:
    return f"{inst['type']}:{inst['symbol']}"


def rejected_instrument(message: str) -> Optional[str]:
    """'INDEX:TNX' from Public's 400 'No enum constant com.….symbology.Index.TNX', else None."""
    m = _ENUM_REJECT.search(message or "")
    return f"{m.group(1).upper()}:{m.group(2).upper()}" if m else None


def quote_price(q: Dict[str, Any]) -> Optional[float]:
    """Last trade, else the bid/ask midpoint, else None."""
    last = _f(q.get("last"))
    if last and last > 0:
        return last
    bid, ask = _f(q.get("bid")), _f(q.get("ask"))
    return (bid + ask) / 2 if bid and ask else None


def normalize_quote(symbol: str, q: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A Public quote → {symbol, price, prev_close, change, change_pct, volume} (Yahoo's quote shape
    plus volume), or None when Public has no price for it."""
    if q.get("outcome", "SUCCESS") != "SUCCESS":
        return None
    price = quote_price(q)
    if price is None:
        return None
    prev = _f(q.get("previousClose"))
    change = round(price - prev, 4) if prev is not None else None
    change_pct = round(change / prev * 100, 4) if change is not None and prev else None
    vol = _f(q.get("volume"))
    return {"symbol": symbol, "price": price, "prev_close": prev, "change": change,
            "change_pct": change_pct, "volume": int(vol) if vol else None}


def parse_contracts(exp: str, payload: Dict[str, Any], T: float) -> List[Dict[str, Any]]:
    """One expiry of a Public option-chain response → normalized rows (see CHAIN_COLUMNS).

    Same filters as Yahoo's parser: no strike or no open interest → dropped; no IV
    and no market → dropped (no price signal, and near-zero sigma blows up gamma).
    """
    rows: List[Dict[str, Any]] = []
    for otype, key in (("call", "calls"), ("put", "puts")):
        for c in payload.get(key) or []:
            if c.get("outcome", "SUCCESS") != "SUCCESS":
                continue
            det = c.get("optionDetails") or {}
            greeks = det.get("greeks") or {}
            strike = _f(det.get("strikePrice")) or 0.0
            oi = int(_f(c.get("openInterest")) or 0)
            if strike <= 0 or oi <= 0:
                continue
            iv = _f(greeks.get("impliedVolatility")) or 0.0
            bid, ask = _f(c.get("bid")), _f(c.get("ask"))
            mid = _f(det.get("midPrice"))
            if mid is None:
                mid = ((bid or 0.0) + (ask or 0.0)) / 2.0
            if iv < 0.005 and mid == 0.0:
                continue
            gamma = _f(greeks.get("gamma"))
            rows.append({
                "strike": strike,
                "expiry": exp,
                "otype": otype,
                "oi": oi,
                "volume": int(_f(c.get("volume")) or 0),
                "iv": iv,
                "mid": mid,
                "gamma": gamma if gamma and gamma > 0 else float("nan"),
                "T": T,
            })
    return rows


def parse_contract_rows(exp: str, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """One expiry of a Public option-chain response → every quoted contract (see CONTRACT_COLUMNS).

    Unlike parse_contracts (GEX), contracts with no open interest are kept: the unusual
    scanner looks for volume far above open interest."""
    rows: List[Dict[str, Any]] = []
    for otype, key in (("call", "calls"), ("put", "puts")):
        for c in payload.get(key) or []:
            if c.get("outcome", "SUCCESS") != "SUCCESS":
                continue
            det = c.get("optionDetails") or {}
            strike = _f(det.get("strikePrice")) or 0.0
            if strike <= 0:
                continue
            rows.append({
                "strike": strike, "expiry": exp, "otype": otype,
                "oi": int(_f(c.get("openInterest")) or 0),
                "volume": int(_f(c.get("volume")) or 0),
                "bid": _f(c.get("bid")), "ask": _f(c.get("ask")), "last": _f(c.get("last")),
                "iv": _f((det.get("greeks") or {}).get("impliedVolatility")),
            })
    return rows


# Yahoo-style interval → Public aggregation. Intervals Public lacks (2m, 90m, 5d) go to Yahoo.
AGGREGATIONS = {
    "1m": "ONE_MINUTE", "5m": "FIVE_MINUTES", "15m": "FIFTEEN_MINUTES", "30m": "THIRTY_MINUTES",
    "60m": "ONE_HOUR", "1h": "ONE_HOUR", "1d": "ONE_DAY", "1wk": "ONE_WEEK", "1mo": "ONE_MONTH",
    "3mo": "THREE_MONTHS",
}
INTRADAY_AGGREGATIONS = {"ONE_MINUTE", "FIVE_MINUTES", "FIFTEEN_MINUTES", "THIRTY_MINUTES", "ONE_HOUR"}

# Yahoo-style period → (Public period, trim). trim: ("sessions", n) keeps the last n trading days,
# ("days", n) the last n calendar days, None keeps everything.
_PERIODS: Dict[str, Tuple[str, Optional[Tuple[str, int]]]] = {
    "1d": ("DAY", None), "5d": ("WEEK", ("sessions", 5)), "1mo": ("MONTH", None),
    "3mo": ("QUARTER", None), "6mo": ("HALF_YEAR", None), "1y": ("YEAR", None),
    "2y": ("FIVE_YEARS", ("days", 731)), "5y": ("FIVE_YEARS", None), "10y": ("TEN_YEARS", None),
    "ytd": ("YTD", None), "max": ("ALL", None),
}


def history_request(period: str, interval: str) -> Optional[Tuple[str, str, Optional[Tuple[str, int]]]]:
    """(Public period, aggregation, trim) for a Yahoo-style period/interval, or None when Public
    has no equivalent (the caller uses Yahoo)."""
    agg = AGGREGATIONS.get(interval)
    p = period.strip().lower()
    if agg is None:
        return None
    if p in _PERIODS:
        pub, trim = _PERIODS[p]
        return pub, agg, trim
    if p.endswith("d") and p[:-1].isdigit():
        n = int(p[:-1])
        if n <= 1:
            return "DAY", agg, None
        if n <= 5:
            return "WEEK", agg, ("sessions", n)
        for limit, pub in ((31, "MONTH"), (92, "QUARTER"), (183, "HALF_YEAR"), (366, "YEAR"),
                           (1830, "FIVE_YEARS")):
            if n <= limit:
                return pub, agg, ("days", n)
        return "TEN_YEARS", agg, ("days", n)
    return None


def parse_bars(payload: Dict[str, Any]) -> pd.DataFrame:
    """Regular-session bars of a historicdata response → OHLCV frame with a UTC DatetimeIndex
    (the provider's price_history shape). Pre/after-market bars are left out, like Yahoo's default."""
    recs, idx = [], []
    for b in ((payload.get("regularMarket") or {}).get("bars") or []):
        close = _f(b.get("close"))
        ts = b.get("timestamp")
        if close is None or not ts:
            continue
        idx.append(pd.Timestamp(ts).tz_convert("UTC"))
        recs.append({"open": _f(b.get("open")), "high": _f(b.get("high")), "low": _f(b.get("low")),
                     "close": close, "volume": _f(b.get("volume"))})
    df = pd.DataFrame(recs, index=pd.DatetimeIndex(idx, name="Date"),
                      columns=["open", "high", "low", "close", "volume"])
    return df[~df.index.duplicated(keep="last")].sort_index()


def _trim(df: pd.DataFrame, trim: Optional[Tuple[str, int]]) -> pd.DataFrame:
    if trim is None or df.empty:
        return df
    kind, n = trim
    if kind == "sessions":
        days = pd.Index(df.index.tz_convert("America/New_York").date)
        keep = set(sorted(set(days))[-n:])
        return df[days.isin(keep)]
    cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=n)
    return df[df.index >= cutoff]


class PublicClient:
    """Thin HTTP client: token exchange and refresh, account lookup, request pacing, 429 → gate."""

    def __init__(self, secret: str, account_id: Optional[str] = None,
                 base_url: str = BASE_URL, transport: Optional[httpx.BaseTransport] = None,
                 gate: RateLimitGate = GATE, min_gap: float = MIN_REQUEST_GAP):
        self._secret = secret
        self._account_id = account_id or None
        self._gate = gate
        self._min_gap = min_gap
        self._http = httpx.Client(base_url=base_url, timeout=10.0, transport=transport)
        self._token: Optional[str] = None
        self._token_expires = 0.0
        self._lock = threading.Lock()          # token + account
        self._pace_lock = threading.Lock()
        self._next_slot = 0.0

    # ── plumbing ──────────────────────────────────────────────────────────────
    def _pace(self) -> None:
        with self._pace_lock:
            now = time.monotonic()
            wait = self._next_slot - now
            self._next_slot = max(now, self._next_slot) + self._min_gap
        if wait > 0:
            time.sleep(wait)

    def _send(self, method: str, url: str, **kw) -> httpx.Response:
        self._gate.check()
        self._pace()
        try:
            r = self._http.request(method, url, **kw)
        except httpx.HTTPError as exc:
            raise PublicError(f"{method} {url}: {exc}") from exc
        if r.status_code == 429:
            self._gate.trip()
            raise MarketDataRateLimited(self._gate.remaining(), self._gate.source)
        return r

    def _token_value(self) -> str:
        with self._lock:
            if self._token and time.monotonic() < self._token_expires:
                return self._token
            r = self._send("POST", "/userapiauthservice/personal/access-tokens",
                           json={"secret": self._secret, "validityInMinutes": TOKEN_MINUTES})
            if r.status_code != 200:
                raise PublicError(f"token exchange failed: HTTP {r.status_code}")
            token = (r.json() or {}).get("accessToken")
            if not token:
                raise PublicError("token exchange returned no accessToken")
            self._token = token
            self._token_expires = time.monotonic() + (TOKEN_MINUTES - 5) * 60
            return token

    def _authed(self, method: str, url: str, **kw) -> Dict[str, Any]:
        for attempt in (1, 2):
            r = self._send(method, url, headers={"Authorization": f"Bearer {self._token_value()}"}, **kw)
            if r.status_code == 401 and attempt == 1:
                with self._lock:
                    self._token = None          # expired or revoked early: get a new one, once
                continue
            if r.status_code != 200:
                raise PublicError(f"{method} {url}: HTTP {r.status_code} {r.text[:200]}")
            self._gate.ok()
            return r.json() or {}
        raise PublicError(f"{method} {url}: unauthorized")

    def account_id(self) -> str:
        """Configured account, else the first options-enabled BROKERAGE account."""
        if self._account_id:
            return self._account_id
        accounts = self._authed("GET", "/userapigateway/trading/account").get("accounts") or []
        brokerage = [a for a in accounts if a.get("accountType") == "BROKERAGE"]
        pick = next((a for a in brokerage if (a.get("optionsLevel") or "NONE") != "NONE"), None) \
            or (brokerage[0] if brokerage else None)
        if not pick or not pick.get("accountId"):
            raise PublicError("no BROKERAGE account on this API key")
        self._account_id = pick["accountId"]
        return self._account_id

    # ── market data ───────────────────────────────────────────────────────────
    def quotes(self, instruments: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        """Raw quotes, one request per QUOTE_BATCH instruments."""
        out: List[Dict[str, Any]] = []
        for i in range(0, len(instruments), QUOTE_BATCH):
            batch = [x for x in instruments[i:i + QUOTE_BATCH] if _key(x) not in _UNSUPPORTED]
            for _ in range(3):                      # drop instruments Public refuses, retry the rest
                if not batch:
                    break
                try:
                    data = self._authed("POST", f"/userapigateway/marketdata/{self.account_id()}/quotes",
                                        json={"instruments": batch})
                except PublicError as exc:
                    bad = rejected_instrument(str(exc))
                    if bad is None or bad not in {_key(x) for x in batch}:
                        raise
                    _UNSUPPORTED.add(bad)
                    logger.info("Public.com has no %s; using Yahoo for it from now on", bad)
                    batch = [x for x in batch if _key(x) != bad]
                    continue
                out.extend(data.get("quotes") or [])
                break
        return out

    def last_price(self, instrument: Dict[str, str]) -> Optional[float]:
        for q in self.quotes([instrument]):
            if q.get("outcome", "SUCCESS") == "SUCCESS":
                return quote_price(q)
        return None

    def expirations(self, instrument: Dict[str, str]) -> List[str]:
        data = self._authed("POST", f"/userapigateway/marketdata/{self.account_id()}/option-expirations",
                            json={"instrument": instrument})
        return list(data.get("expirations") or [])

    def chain(self, instrument: Dict[str, str], expiry: str) -> Dict[str, Any]:
        return self._authed("POST", f"/userapigateway/marketdata/{self.account_id()}/option-chain",
                            json={"instrument": instrument, "expirationDate": expiry})

    def bars(self, instrument: Dict[str, str], period: str, aggregation: str) -> Dict[str, Any]:
        params = {"tradingSessionToggle": "REGULAR_HOURS"} if instrument["type"] == "EQUITY" else None
        return self._authed("GET", f"/userapigateway/historicdata/{instrument['type']}/"
                                   f"{instrument['symbol']}/{period}/{aggregation}", params=params)


class PublicQuotes:
    """Batched real-time quotes with a QUOTE_TTL cache, keyed by the caller's (Yahoo-style) symbol."""

    name = "public"
    label = "Public.com"
    gate = GATE

    def __init__(self, client: PublicClient, ttl: float = QUOTE_TTL):
        self.client = client
        self.ttl = ttl
        self._cache: Dict[str, Tuple[float, Optional[Dict[str, Any]]]] = {}
        self._lock = threading.Lock()

    def quotes(self, symbols: List[str]) -> Dict[str, Dict[str, Any]]:
        """{SYMBOL: normalized quote} for every symbol Public could price; others are left out.

        Fresh cache hits cost nothing; the rest go out in one request. Raises PublicError /
        MarketDataRateLimited when that request fails, so the caller can fall back.
        """
        want = list(dict.fromkeys(s.strip().upper() for s in symbols if s and s.strip()))
        now = time.monotonic()
        out: Dict[str, Dict[str, Any]] = {}
        missing: List[Tuple[str, Dict[str, str]]] = []
        with self._lock:
            for sym in want:
                hit = self._cache.get(sym)
                if hit and now - hit[0] < self.ttl:
                    if hit[1] is not None:
                        out[sym] = hit[1]
                    continue
                inst = instrument_for(sym)
                if inst is not None:
                    missing.append((sym, inst))
        if not missing:
            return out
        by_key = {f"{i['type']}:{i['symbol']}": sym for sym, i in missing}
        fetched: Dict[str, Optional[Dict[str, Any]]] = {sym: None for sym, _ in missing}
        for q in self.client.quotes([i for _, i in missing]):
            inst = q.get("instrument") or {}
            sym = by_key.get(f"{inst.get('type')}:{str(inst.get('symbol') or '').upper()}")
            if sym:
                fetched[sym] = normalize_quote(sym, q)
        stamp = time.monotonic()
        with self._lock:
            for sym, q in fetched.items():
                self._cache[sym] = (stamp, q)
        out.update({s: q for s, q in fetched.items() if q is not None})
        return out


class PublicOptionChains:
    """`option_chain()` from Public.com, in the provider's OptionChain shape."""

    name = "public"
    label = "Public.com"
    realtime = True               # the GEX poller refreshes faster while this is serving
    gate = GATE

    def __init__(self, client: PublicClient, chain_ttl: float = CHAIN_TTL):
        self.client = client
        self.chain_ttl = chain_ttl
        self._expiries: Dict[str, Tuple[float, List[str]]] = {}
        self._chains: Dict[Tuple[str, str], Tuple[float, Dict[str, Any]]] = {}
        self._chain_lock = threading.Lock()

    def _chain(self, instrument: Dict[str, str], expiry: str) -> Dict[str, Any]:
        """Raw chain for one expiry, reused for chain_ttl seconds (GEX, scanner and catalysts share it)."""
        key = (f"{instrument['type']}:{instrument['symbol']}", expiry)
        with self._chain_lock:
            hit = self._chains.get(key)
            if hit and time.monotonic() - hit[0] < self.chain_ttl:
                return hit[1]
        payload = self.client.chain(instrument, expiry)
        with self._chain_lock:
            self._chains[key] = (time.monotonic(), payload)
            if len(self._chains) > 512:            # drop expired entries now and then
                now = time.monotonic()
                self._chains = {k: v for k, v in self._chains.items() if now - v[0] < self.chain_ttl}
        return payload

    @staticmethod
    def _instrument(symbol: str) -> Dict[str, str]:
        inst = instrument_for(symbol)
        if inst is None:
            raise PublicError(f"{symbol}: not a Public.com instrument")
        return inst

    def option_expiries(self, symbol: str) -> List[str]:
        """Every listed expiry (YYYY-MM-DD), nearest first."""
        return sorted(set(self._expiries_for(self._instrument(symbol))))

    def option_contracts(self, symbol: str, expiries: Optional[List[str]] = None,
                         max_dte: int = MAX_CHAIN_DTE, max_expiries: int = 4) -> ContractChain:
        """Spot and every quoted contract (see CONTRACT_COLUMNS) for `expiries`, or for the
        nearest `max_expiries` within `max_dte` days. Raises like option_chain."""
        inst = self._instrument(symbol)
        spot = self.client.last_price(inst)
        if expiries is None:
            import zoneinfo
            today = datetime.now(zoneinfo.ZoneInfo("America/New_York")).date()
            expiries = [e for e in self.option_expiries(symbol)
                        if 0 <= (pd.Timestamp(e).date() - today).days <= max_dte][:max_expiries]
        if not expiries:
            return ContractChain(spot, pd.DataFrame(columns=CONTRACT_COLUMNS), self.name)

        def _one(exp: str) -> List[Dict[str, Any]]:
            try:
                return parse_contract_rows(exp, self._chain(inst, exp))
            except PublicError as exc:
                logger.info("Public chain %s %s failed: %s", symbol, exp, exc)
                return []

        rows: List[Dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=4) as pool:
            for part in pool.map(_one, expiries):
                rows.extend(part)
        if not rows:
            raise PublicError(f"{symbol}: empty chain")
        return ContractChain(spot, pd.DataFrame(rows, columns=CONTRACT_COLUMNS), self.name)

    def _expiries_for(self, instrument: Dict[str, str]) -> List[str]:
        key = f"{instrument['type']}:{instrument['symbol']}"
        hit = self._expiries.get(key)
        if hit and time.monotonic() - hit[0] < EXPIRIES_TTL:
            return hit[1]
        exps = self.client.expirations(instrument)
        self._expiries[key] = (time.monotonic(), exps)
        return exps

    def option_chain(self, symbol: str) -> OptionChain:
        """Expiries within MAX_CHAIN_DTE days (at most MAX_CHAIN_EXPIRIES).

        Raises PublicError when Public can't serve the symbol or nothing came back,
        and MarketDataRateLimited on a 429, so the caller can fall back to Yahoo.
        """
        inst = instrument_for(symbol)
        if inst is None:
            raise PublicError(f"{symbol}: not a Public.com instrument")
        spot = self.client.last_price(inst)
        if not spot or spot <= 0:
            raise PublicError(f"{symbol}: no quote")

        import zoneinfo
        today = pd.Timestamp(datetime.now(zoneinfo.ZoneInfo("America/New_York")).date())
        valid: List[Tuple[str, float]] = []
        for exp in sorted(set(self._expiries_for(inst))):
            days = (pd.Timestamp(exp) - today).days
            if 0 <= days <= MAX_CHAIN_DTE:
                valid.append((exp, max(days, 1) / 252.0))   # 0-DTE: one trading day
        valid = valid[:MAX_CHAIN_EXPIRIES]
        if not valid:
            raise PublicError(f"{symbol}: no expiries within {MAX_CHAIN_DTE} days")

        def _one(exp: str, T: float) -> List[Dict[str, Any]]:
            try:
                return parse_contracts(exp, self._chain(inst, exp), T)
            except PublicError as exc:                # one bad expiry shouldn't sink the board
                logger.info("Public chain %s %s failed: %s", symbol, exp, exc)
                return []

        rows: List[Dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=4) as pool:   # requests are paced anyway
            for part in pool.map(lambda v: _one(*v), valid):
                rows.extend(part)
        if not rows:
            raise PublicError(f"{symbol}: empty chain")
        return OptionChain(float(spot), pd.DataFrame(rows, columns=CHAIN_COLUMNS), self.name)


class PublicHistory:
    """`price_history()` from Public.com bars, in the provider's frame shape, briefly cached."""

    name = "public"
    label = "Public.com"
    gate = GATE

    def __init__(self, client: PublicClient):
        self.client = client
        self._cache: Dict[Tuple[str, str, str], Tuple[float, pd.DataFrame]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def supports(symbol: str, period: str, interval: str) -> bool:
        """False for requests Public has no equivalent for (non-US listings, 2m/90m bars): the
        caller goes straight to Yahoo, without counting it as a Public failure."""
        return instrument_for(symbol) is not None and history_request(period, interval) is not None

    def price_history(self, symbol: str, period: str, interval: str) -> pd.DataFrame:
        """Raises PublicError when Public can't serve this symbol / period / interval or returns
        no bars, and MarketDataRateLimited on a 429, so the caller can fall back to Yahoo."""
        inst = instrument_for(symbol)
        req = history_request(period, interval)
        if inst is None or req is None:
            raise PublicError(f"{symbol} {period}/{interval}: no Public.com equivalent")
        pub_period, agg, trim = req
        key = (f"{inst['type']}:{inst['symbol']}", period, interval)
        ttl = HISTORY_TTL_INTRADAY if agg in INTRADAY_AGGREGATIONS else HISTORY_TTL_DAILY
        with self._lock:
            hit = self._cache.get(key)
            if hit and time.monotonic() - hit[0] < ttl:
                return hit[1].copy()
        df = parse_bars(self.client.bars(inst, pub_period, agg))
        if trim and trim[0] == "sessions" and pub_period == "WEEK":
            have = len(set(df.index.tz_convert("America/New_York").date)) if not df.empty else 0
            if have < trim[1]:                    # early in the week: WEEK may hold fewer sessions
                try:
                    df = parse_bars(self.client.bars(inst, "MONTH", agg))
                except PublicError:
                    pass
        df = _trim(df, trim)
        if df.empty:
            raise PublicError(f"{symbol} {period}/{interval}: no bars")
        df.attrs["source"] = self.name
        with self._lock:
            self._cache[key] = (time.monotonic(), df)
            if len(self._cache) > 256:
                self._cache.pop(next(iter(self._cache)))
        return df.copy()
