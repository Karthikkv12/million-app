"""optionflow/modules/politics/service.py — a stock's political profile, sector summaries and the Research feed.

profile(symbol) has three independent sections, each with its own status, so one source failing never hides
the others:
- congress:  disclosed trades by members of Congress (FMP; "not_configured" without FMP_API_KEY).
- lobbying:  the last four quarters of lobbying spend, issues, firms and agencies (lda.gov).
- contracts: federal contract dollars obligated in the last 12 months, and the agencies (USAspending).

Statuses: ok · none (looked, found nothing) · unknown_company (no name to match) · not_configured · unavailable.

Lobbying spend per quarter follows the LDA rules: a company that files its own (in-house) report states expenses
that already include the outside firms it paid, so that figure is used alone; otherwise the quarter is the sum
of the outside firms' reported income from the company. Amended reports replace the originals.

Profiles are cached in memory and on disk (DB_DIR/politics/SYMBOL.json) for CACHE_TTL. summary() never fetches:
it serves what's cached (up to STALE_OK old) and queues the rest for the warm-up worker, which works through the
queue a few seconds apart so the government APIs are never hammered.
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from optionflow.core.settings import get_settings
from optionflow.modules.politics import names, sources

log = logging.getLogger(__name__)

CACHE_TTL = 12 * 3600          # a profile is refetched after 12 h
STALE_OK = 7 * 24 * 3600       # summaries may show a profile this old while a fresh one is queued
FEED_TTL = 30 * 60             # the latest-disclosures feed
WARM_GAP = 4.0                 # seconds between background profile builds
FAMILY_SHARE = 0.9             # contracts: exact-name share of a search above which the search is the company family
QUARTERS = {"first_quarter": 1, "second_quarter": 2, "third_quarter": 3, "fourth_quarter": 4}

_mem: Dict[str, Dict[str, Any]] = {}
_locks: Dict[str, threading.Lock] = {}
_guard = threading.Lock()
_queue: "queue.Queue[str]" = queue.Queue()
_queued: set[str] = set()
_feed_cache: Dict[str, Tuple[float, Any]] = {}


# ── Helpers ──────────────────────────────────────────────────────────────────
def _dir() -> Path:
    d = Path(get_settings().db_dir) / "politics"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _now() -> float:
    return time.time()


def _section(fn: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    try:
        return fn()
    except sources.NotConfigured as e:
        return {"status": "not_configured", "message": str(e)}
    except Exception as e:                       # network, rate limits, a changed response
        log.info("politics source failed: %s", e)
        return {"status": "unavailable", "message": "The source didn't answer; try again later."}


def company_name(symbol: str) -> Optional[str]:
    """The company's name from ticker search (exact symbol match), or None."""
    try:
        from optionflow.modules.market import service as market
        for r in market.search(symbol, 8):
            if (r.get("symbol") or "").upper() == symbol.upper() and r.get("name"):
                return r["name"]
    except Exception as e:
        log.info("politics: no name for %s (%s)", symbol, e)
    return None


def _d(s: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


# ── Congress ─────────────────────────────────────────────────────────────────
def _side(raw: str) -> str:
    t = (raw or "").lower()
    return "buy" if "purchase" in t or t == "buy" else "sell" if "sale" in t or t == "sell" else \
        "exchange" if "exchange" in t else "other"


def normalise_trade(t: Dict[str, Any]) -> Dict[str, Any]:
    member = " ".join(x for x in (t.get("firstName"), t.get("lastName")) if x) or t.get("representative") \
        or t.get("office") or "Unknown member"
    traded, disclosed = _d(t.get("transactionDate")), _d(t.get("disclosureDate"))
    return {
        "symbol": (t.get("symbol") or "").upper() or None,
        "chamber": t.get("_chamber") or ("Senate" if t.get("senator") else "House"),
        "member": member.strip(),
        "district": t.get("district") or None,
        "owner": t.get("owner") or None,
        "side": _side(t.get("type") or t.get("transactionType") or ""),
        "type": t.get("type") or t.get("transactionType") or None,
        "amount": t.get("amount") or None,
        "asset": t.get("assetDescription") or None,
        "transaction_date": traded.isoformat() if traded else None,
        "disclosure_date": disclosed.isoformat() if disclosed else None,
        "days_late": (disclosed - traded).days if traded and disclosed else None,
        "link": t.get("link") or None,
    }


def _congress(symbol: str, today: date) -> Dict[str, Any]:
    trades = [normalise_trade(t) for t in sources.congress_trades(symbol)]
    year_ago = today - timedelta(days=365)
    trades = [t for t in trades if t["transaction_date"] and date.fromisoformat(t["transaction_date"]) >= year_ago]
    trades.sort(key=lambda t: (t["transaction_date"], t["disclosure_date"] or ""), reverse=True)
    recent = [t for t in trades if date.fromisoformat(t["transaction_date"]) >= today - timedelta(days=90)]
    return {
        "status": "ok" if trades else "none",
        "trades": trades[:50],
        "buys_90d": sum(t["side"] == "buy" for t in recent),
        "sells_90d": sum(t["side"] == "sell" for t in recent),
        "members_90d": len({t["member"] for t in recent}),
        "trades_12m": len(trades),
    }


# ── Lobbying ─────────────────────────────────────────────────────────────────
def lobbying_summary(filings: List[Dict[str, Any]], wanted: List[str], quarters: int = 4) -> Dict[str, Any]:
    """Quarterly spend, issues, firms and agencies from raw LDA filings (see the module note)."""
    latest: Dict[Tuple[Any, int, int], Dict[str, Any]] = {}
    for f in filings:
        q = QUARTERS.get(f.get("filing_period") or "")
        if not q or not names.matches((f.get("client") or {}).get("name"), wanted):
            continue
        key = ((f.get("registrant") or {}).get("id"), int(f.get("filing_year") or 0), q)
        if key not in latest or (f.get("dt_posted") or "") > (latest[key].get("dt_posted") or ""):
            latest[key] = f                      # amendments replace the original
    by_q: Dict[Tuple[int, int], List[Dict[str, Any]]] = defaultdict(list)
    for (_, y, q), f in latest.items():
        by_q[(y, q)].append(f)
    keep = sorted(by_q, reverse=True)[:quarters]

    def money(x: Any) -> float:
        try:
            return float(x or 0)
        except (TypeError, ValueError):
            return 0.0

    rows, issues, agencies, firms = [], Counter(), Counter(), Counter()
    in_house_any = False
    for y, q in sorted(keep):
        fs = by_q[(y, q)]
        own = [f for f in fs if names.matches((f.get("registrant") or {}).get("name"), wanted)]
        outside = [f for f in fs if f not in own]
        amount = sum(money(f.get("expenses")) for f in own) if own else sum(money(f.get("income")) for f in outside)
        in_house_any = in_house_any or bool(own)
        rows.append({"period": f"{y} Q{q}", "amount": round(amount, 2), "filings": len(fs)})
        for f in outside:
            firms[(f.get("registrant") or {}).get("name") or "?"] += money(f.get("income"))
        for f in fs:
            for a in f.get("lobbying_activities") or []:
                if a.get("general_issue_code_display"):
                    issues[a["general_issue_code_display"]] += 1
                for g in a.get("government_entities") or []:
                    if g.get("name"):
                        agencies[g["name"]] += 1
    total = round(sum(r["amount"] for r in rows), 2)
    return {
        "status": "ok" if rows else "none",
        "quarters": rows,
        "total": total,
        "latest": rows[-1] if rows else None,
        "issues": [{"name": k, "count": v} for k, v in issues.most_common(8)],
        "firms": [k for k, _ in firms.most_common(8)],
        "agencies": [k for k, _ in agencies.most_common(6)],
        "in_house": in_house_any,
    }


def _lobbying(wanted: List[str], today: date) -> Dict[str, Any]:
    filings: List[Dict[str, Any]] = []
    for query in wanted[:3]:
        for year in (today.year, today.year - 1):
            filings.extend(sources.lda_filings(query, year))
    seen, unique = set(), []
    for f in filings:
        if f.get("filing_uuid") not in seen:
            seen.add(f.get("filing_uuid"))
            unique.append(f)
    return lobbying_summary(unique, wanted)


# ── Contracts ────────────────────────────────────────────────────────────────
def _contracts(wanted: List[str], today: date) -> Dict[str, Any]:
    """USAspending's name search also returns a company's subsidiaries (it links recipients to their parent:
    Lockheed brings Sikorsky). When exact name matches hold nearly all (FAMILY_SHARE) of what the search found,
    the whole result is the company's family and its total and agencies are used; otherwise (a common name like
    "Apple" pulling in unrelated recipients) only exact matches count and agencies are left out."""
    start = today - timedelta(days=365)
    rows: Dict[str, float] = defaultdict(float)
    exact = 0.0
    for query in wanted[:2]:
        for r in sources.contract_recipients(query, start, today):
            amt = float(r.get("amount") or 0)
            name = r.get("name") or "?"
            rows[name] += amt
            if names.matches(name, wanted):
                exact += amt
    found = sum(rows.values())
    family = exact > 0 and found > 0 and exact / found >= FAMILY_SHARE
    kept = rows if family else {k: v for k, v in rows.items() if names.matches(k, wanted)}
    total = round(sum(kept.values()), 2)
    agencies: List[Dict[str, Any]] = []
    if family:
        agencies = [{"name": a.get("name"), "amount": round(float(a.get("amount") or 0), 2)}
                    for a in sources.contract_agencies(wanted[0], start, today)[:5] if a.get("name")]
    return {
        "status": "ok" if total > 0 else "none",
        "total_12m": total,
        "recipients": [{"name": k, "amount": round(v, 2)} for k, v in sorted(kept.items(), key=lambda x: -x[1])[:5]],
        "agencies": agencies,
        "window": f"{start.isoformat()} to {today.isoformat()}",
    }


# ── Profiles ─────────────────────────────────────────────────────────────────
def _load(symbol: str) -> Optional[Dict[str, Any]]:
    hit = _mem.get(symbol)
    if hit:
        return hit
    p = _dir() / f"{symbol}.json"
    if p.exists():
        try:
            data = json.loads(p.read_text())
            _mem[symbol] = data
            return data
        except Exception:
            return None
    return None


def _save(symbol: str, data: Dict[str, Any]) -> None:
    _mem[symbol] = data
    try:
        (_dir() / f"{symbol}.json").write_text(json.dumps(data))
    except Exception as e:
        log.info("politics: can't write cache for %s (%s)", symbol, e)


def _age(data: Dict[str, Any]) -> float:
    return _now() - float(data.get("_fetched", 0))


def build(symbol: str, today: Optional[date] = None) -> Dict[str, Any]:
    """Fetch all three sections now (no cache)."""
    sym = symbol.upper()
    today = today or datetime.now(timezone.utc).date()
    company = company_name(sym)
    wanted = names.candidates(sym, company)
    unknown = {"status": "unknown_company", "message": "Couldn't find this ticker's company name to match."}
    return {
        "symbol": sym,
        "company": company,
        "matched_names": wanted,
        "congress": _section(lambda: _congress(sym, today)),
        "lobbying": _section(lambda: _lobbying(wanted, today)) if wanted else unknown,
        "contracts": _section(lambda: _contracts(wanted, today)) if wanted else unknown,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "_fetched": _now(),
    }


def profile(symbol: str, refresh: bool = False) -> Dict[str, Any]:
    """The cached profile if fresh, else a new one (one build per symbol at a time)."""
    sym = symbol.upper()
    hit = _load(sym)
    if hit and not refresh and _age(hit) < CACHE_TTL:
        return hit
    with _guard:
        lock = _locks.setdefault(sym, threading.Lock())
    with lock:
        hit = _load(sym)
        if hit and not refresh and _age(hit) < CACHE_TTL:
            return hit
        data = build(sym)
        # keep a section's last good answer when the source is down this time
        if hit:
            for k in ("congress", "lobbying", "contracts"):
                if data[k].get("status") == "unavailable" and hit.get(k, {}).get("status") in ("ok", "none"):
                    data[k] = {**hit[k], "stale": True}
        _save(sym, data)
        return data


def public(data: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in data.items() if not k.startswith("_")}


# ── Summaries (sectors) ──────────────────────────────────────────────────────
def compact(data: Dict[str, Any]) -> Dict[str, Any]:
    c, l, k = data.get("congress", {}), data.get("lobbying", {}), data.get("contracts", {})
    return {
        "symbol": data["symbol"],
        "congress_buys_90d": c.get("buys_90d") if c.get("status") in ("ok", "none") else None,
        "congress_sells_90d": c.get("sells_90d") if c.get("status") in ("ok", "none") else None,
        "lobbying_last_q": (l.get("latest") or {}).get("amount") if l.get("status") in ("ok", "none") else None,
        "lobbying_period": (l.get("latest") or {}).get("period"),
        "lobbying_4q": l.get("total") if l.get("status") in ("ok", "none") else None,
        "contracts_12m": k.get("total_12m") if k.get("status") in ("ok", "none") else None,
    }


def enqueue(symbol: str) -> None:
    sym = symbol.upper()
    with _guard:
        if sym in _queued:
            return
        _queued.add(sym)
    _queue.put(sym)


def summary(symbols: List[str]) -> Dict[str, Any]:
    """Compact figures for every symbol with a usable cached profile; the rest are queued (`pending`)."""
    items, pending = [], []
    for s in dict.fromkeys(x.strip().upper() for x in symbols if x.strip()):
        hit = _load(s)
        if hit and _age(hit) < STALE_OK:
            items.append(compact(hit))
            if _age(hit) >= CACHE_TTL:
                enqueue(s)
        else:
            pending.append(s)
            enqueue(s)
    return {"items": items, "pending": pending}


def warm_once(sleep: Callable[[float], None] = time.sleep) -> Optional[str]:
    """Build the next queued profile (blocks until one is queued). Returns its symbol."""
    sym = _queue.get()
    try:
        profile(sym)
    except Exception as e:
        log.info("politics warm %s failed: %s", sym, e)
    finally:
        with _guard:
            _queued.discard(sym)
    sleep(WARM_GAP)
    return sym


def start_worker() -> threading.Thread:
    def loop() -> None:
        while True:
            warm_once()
    t = threading.Thread(target=loop, daemon=True, name="politics-warm")
    t.start()
    return t


# ── Research feed ────────────────────────────────────────────────────────────
def feed(symbols: Optional[List[str]] = None, days: int = 30) -> Dict[str, Any]:
    """Latest congressional disclosures (optionally only `symbols`) and the newest lobbying quarter per symbol."""
    wanted = [s.strip().upper() for s in symbols or [] if s.strip()]

    def _latest() -> Dict[str, Any]:
        hit = _feed_cache.get("latest")
        if hit and _now() - hit[0] < FEED_TTL:
            return hit[1]
        trades = [normalise_trade(t) for t in sources.congress_latest(100)]
        trades.sort(key=lambda t: (t["disclosure_date"] or "", t["transaction_date"] or ""), reverse=True)
        out = {"status": "ok" if trades else "none", "trades": trades}
        _feed_cache["latest"] = (_now(), out)
        return out

    congress = _section(_latest)
    if congress.get("status") == "ok":
        cutoff = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
        trades = [t for t in congress["trades"] if (t["disclosure_date"] or "") >= cutoff
                  and (not wanted or t["symbol"] in wanted)]
        congress = {**congress, "trades": trades[:200], "status": "ok" if trades else "none"}

    lobbying, pending = [], []
    for s in wanted:
        hit = _load(s)
        if not hit or _age(hit) >= STALE_OK:
            pending.append(s)
            enqueue(s)
            continue
        l = hit.get("lobbying", {})
        if l.get("status") == "ok" and l.get("latest"):
            lobbying.append({"symbol": s, "company": hit.get("company"), "period": l["latest"]["period"],
                             "amount": l["latest"]["amount"], "total_4q": l.get("total"),
                             "issues": [i["name"] for i in l.get("issues", [])[:3]]})
    lobbying.sort(key=lambda x: -(x["amount"] or 0))
    return {"congress": congress, "lobbying": lobbying, "pending": pending,
            "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def clear() -> None:
    _mem.clear()
    _feed_cache.clear()
    with _guard:
        _queued.clear()
    while not _queue.empty():
        _queue.get_nowait()
