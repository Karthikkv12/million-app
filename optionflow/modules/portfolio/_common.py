"""optionflow/modules/portfolio/_common.py — Shared helpers for the portfolio module: week bounds, serializers, cost basis, parsing."""
from __future__ import annotations
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from database.models import WeeklySnapshot, OptionPosition, StockAssignment


# ── Helpers ───────────────────────────────────────────────────────────────────

def _week_bounds(for_date: datetime | None = None):
    """Return (monday_00:00, friday_23:59:59) UTC for the week containing for_date.
    Accepts either a datetime or a date object."""
    import datetime as _dt
    if for_date is None:
        d = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0, tzinfo=None
        )
    elif isinstance(for_date, _dt.datetime):
        d = for_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
    else:
        # date object — convert to datetime at midnight
        d = datetime(for_date.year, for_date.month, for_date.day, 0, 0, 0)
    monday = d - timedelta(days=d.weekday())          # weekday() 0=Mon
    friday = monday + timedelta(days=4, hours=23, minutes=59, seconds=59)
    return monday, friday


def _pos_to_dict(p: OptionPosition) -> dict:
    intrinsic, extrinsic, moneyness = _compute_moneyness(p)
    return {
        "id":              p.id,
        "week_id":         p.week_id,
        "symbol":          p.symbol,
        "contracts":       p.contracts,
        "strike":          p.strike,
        "option_type":     p.option_type,
        "sold_date":       p.sold_date.isoformat() if p.sold_date else None,
        "buy_date":        p.buy_date.isoformat()  if p.buy_date  else None,
        "expiry_date":     p.expiry_date.isoformat() if p.expiry_date else None,
        "premium_in":      p.premium_in,
        "premium_out":     p.premium_out,
        "spot_price":      p.spot_price,
        "is_roll":         p.is_roll,
        "status":          p.status.value if p.status else "ACTIVE",
        "rolled_to_id":    p.rolled_to_id,
        "carried_from_id": p.carried_from_id,
        "holding_id":      p.holding_id,
        "margin":          p.margin,
        "notes":           p.notes,
        # Computed
        "net_premium":     _net_premium(p),
        "total_premium":   _net_premium(p) * p.contracts * 100,
        # Moneyness / extrinsic value (only when spot_price is provided)
        "intrinsic_value": intrinsic,
        "extrinsic_value": extrinsic,
        "moneyness":       moneyness,   # "ITM" | "ATM" | "OTM" | None
    }


def _net_premium(p: OptionPosition) -> float:
    """Premium in minus any debit paid out (roll debit stored as negative)."""
    inn  = p.premium_in  or 0.0
    out  = p.premium_out or 0.0
    return inn + out   # out is already signed (negative = debit)


def _compute_moneyness(p: OptionPosition):
    """Return (intrinsic_per_share, extrinsic_per_share, moneyness_label).
    intrinsic = the in-the-money component of premium_in (per share).
    extrinsic = premium_in - intrinsic  (the true time/theta value sold).
    moneyness  = 'ITM' | 'ATM' | 'OTM' | None (when spot_price not provided).
    ATM threshold: spot within ±0.5% of strike.
    """
    spot  = p.spot_price
    prem  = p.premium_in or 0.0
    strike = p.strike or 0.0

    if spot is None or spot <= 0 or strike <= 0:
        return None, None, None

    if p.option_type == "CALL":
        raw_intrinsic = max(0.0, spot - strike)
    else:  # PUT
        raw_intrinsic = max(0.0, strike - spot)

    intrinsic = round(min(raw_intrinsic, prem), 4)   # can't exceed premium paid
    extrinsic = round(max(0.0, prem - intrinsic), 4)

    atm_band = strike * 0.005   # ±0.5% of strike
    if abs(spot - strike) <= atm_band:
        moneyness = "ATM"
    elif (p.option_type == "CALL" and spot > strike) or (p.option_type == "PUT" and spot < strike):
        moneyness = "ITM"
    else:
        moneyness = "OTM"

    return intrinsic, extrinsic, moneyness


def _snap_to_dict(s: WeeklySnapshot) -> dict:
    return {
        "id":            s.id,
        "week_start":    s.week_start.isoformat(),
        "week_end":      s.week_end.isoformat(),
        "account_value": s.account_value,
        "acct_label_1":  s.acct_label_1,
        "acct_val_1":    s.acct_val_1,
        "acct_label_2":  s.acct_label_2,
        "acct_val_2":    s.acct_val_2,
        "acct_label_3":  s.acct_label_3,
        "acct_val_3":    s.acct_val_3,
        "is_complete":   s.is_complete,
        "completed_at":  s.completed_at.isoformat() if s.completed_at else None,
        "notes":         s.notes,
        "label":         s.week_end.strftime("Week of %b %d, %Y"),
    }


def _assignment_to_dict(a: StockAssignment) -> dict:
    additional = json.loads(a.additional_buys or "[]")
    covered    = json.loads(a.covered_calls   or "[]")
    cb         = calc_cost_basis(
        shares_acquired   = a.shares_acquired,
        acquisition_price = a.acquisition_price,
        additional_buys   = additional,
        net_option_premium= a.net_option_premium or 0.0,
    )
    return {
        "id":                 a.id,
        "position_id":        a.position_id,
        "symbol":             a.symbol,
        "shares_acquired":    a.shares_acquired,
        "acquisition_price":  a.acquisition_price,
        "additional_buys":    additional,
        "covered_calls":      covered,
        "net_option_premium": a.net_option_premium,
        "notes":              a.notes,
        **cb,
    }


# ── Cost basis calculator ─────────────────────────────────────────────────────

def calc_cost_basis(
    *,
    shares_acquired: int,
    acquisition_price: float,
    additional_buys: list[dict] | None = None,
    net_option_premium: float = 0.0,
) -> dict:
    """
    Compute blended cost basis and breakeven levels.

    additional_buys: [{shares, price}, ...]
    net_option_premium: total net credit collected on this symbol (reduces basis)
    """
    buys = additional_buys or []

    total_shares = shares_acquired + sum(b.get("shares", 0) for b in buys)
    total_cost   = (
        shares_acquired * acquisition_price
        + sum(b.get("shares", 0) * b.get("price", 0.0) for b in buys)
    )

    if total_shares <= 0:
        return {
            "total_shares":      0,
            "total_cost":        0.0,
            "weighted_avg_cost": 0.0,
            "downside_basis":    0.0,
            "upside_basis":      0.0,
            "downside_breakeven":0.0,
            "upside_breakeven":  0.0,
        }

    weighted_avg = total_cost / total_shares

    # Net premium per share lowers the effective cost basis
    premium_per_share = net_option_premium / total_shares

    # Downside basis  = avg cost minus premium collected
    #   → how low the stock can go before you're underwater
    downside_basis    = weighted_avg - premium_per_share
    # Upside basis    = avg cost (ignoring premium — conservative)
    upside_basis      = weighted_avg

    # Breakeven prices (same values, named for clarity in the UI)
    downside_breakeven = downside_basis   # stock needs to be ABOVE this to not lose
    upside_breakeven   = upside_basis     # covered-call assignment threshold

    return {
        "total_shares":       total_shares,
        "total_cost":         round(total_cost, 2),
        "weighted_avg_cost":  round(weighted_avg, 4),
        "downside_basis":     round(downside_basis, 4),
        "upside_basis":       round(upside_basis, 4),
        "downside_breakeven": round(downside_breakeven, 2),
        "upside_breakeven":   round(upside_breakeven, 2),
    }


# ── Utilities ─────────────────────────────────────────────────────────────────

def parse_dt(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:19], fmt[:len(s[:19])])
        except ValueError:
            continue
    return None


def _float_or_none(val: Any) -> float | None:
    if val is None or str(val).strip() == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
