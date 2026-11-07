"""optionflow/modules/portfolio/summary.py — Portfolio and per-symbol summaries."""
from __future__ import annotations
from datetime import datetime
from typing import Any
from optionflow.core.db import get_portfolio_session as _portfolio_session
from database.models import WeeklySnapshot, OptionPosition, OptionPositionStatus
from optionflow.modules.portfolio._common import _net_premium


# ── Portfolio summary ─────────────────────────────────────────────────────────

def portfolio_summary(*, user_id: int) -> dict:
    """
    Aggregate stats across all weeks:
      - Total premium collected (net)
      - Realized P&L (closed + expired positions)
      - Active positions count
      - Monthly account value series (for chart)
      - Capital gains (sum of realized P&L on closed/expired)
    """
    session = _portfolio_session()
    try:
        all_positions = (
            session.query(OptionPosition)
            .filter(OptionPosition.user_id == user_id)
            .all()
        )
        all_weeks = (
            session.query(WeeklySnapshot)
            .filter(WeeklySnapshot.user_id == user_id)
            .order_by(WeeklySnapshot.week_end)
            .all()
        )
        # Build set of week IDs that are open (not yet complete)
        open_week_ids = {w.id for w in all_weeks if not w.is_complete}

        total_premium   = 0.0
        realized_pnl    = 0.0
        active_count    = 0
        assigned_count  = 0
        seen_origin: set[int] = set()

        for p in all_positions:
            # Walk back to the original position to avoid double-counting
            origin_id = p.id
            if p.carried_from_id:
                origin_id = p.carried_from_id

            if origin_id in seen_origin:
                continue
            seen_origin.add(origin_id)

            # Use gross premium_in for total (consistent with Premium tab)
            gross = (p.premium_in or 0.0) * p.contracts * 100
            net   = _net_premium(p) * p.contracts * 100
            total_premium += gross

            if p.status in (OptionPositionStatus.CLOSED, OptionPositionStatus.EXPIRED,
                            OptionPositionStatus.ASSIGNED):
                # ASSIGNED premium is fully realized — you keep it when shares are put to you
                realized_pnl += net
                if p.status == OptionPositionStatus.ASSIGNED:
                    assigned_count += 1
            elif p.status == OptionPositionStatus.ACTIVE:
                active_count += 1

        # Per-week breakdown for the Year tab
        week_premium: dict[int, float] = {w.id: 0.0 for w in all_weeks}
        week_realized: dict[int, float] = {w.id: 0.0 for w in all_weeks}
        week_pos_count: dict[int, int] = {w.id: 0 for w in all_weeks}
        seen_origin2: set[int] = set()

        for p in all_positions:
            origin_id = p.id if not p.carried_from_id else p.carried_from_id
            if origin_id in seen_origin2:
                continue
            seen_origin2.add(origin_id)
            if p.week_id not in week_premium:
                continue
            gross = (p.premium_in or 0.0) * p.contracts * 100
            net   = _net_premium(p) * p.contracts * 100
            # For CLOSED positions (bought back), use net so buyback costs
            # reduce the week's premium total. For active/expired/assigned,
            # use gross (premium_in) as the week contribution.
            week_premium[p.week_id] += net if p.status == OptionPositionStatus.CLOSED else gross
            week_pos_count[p.week_id] += 1
            if p.status in (OptionPositionStatus.CLOSED, OptionPositionStatus.EXPIRED):
                week_realized[p.week_id] += net

        weeks_breakdown = []
        for w in sorted(all_weeks, key=lambda x: x.week_end, reverse=True):
            prem = round(week_premium[w.id], 2)
            weeks_breakdown.append({
                "id":            w.id,
                "week_start":    w.week_start.date().isoformat(),
                "week_end":      w.week_end.date().isoformat(),
                "is_complete":   w.is_complete,
                "account_value": w.account_value,
                "acct_label_1":  w.acct_label_1,
                "acct_val_1":    w.acct_val_1,
                "acct_label_2":  w.acct_label_2,
                "acct_val_2":    w.acct_val_2,
                "acct_label_3":  w.acct_label_3,
                "acct_val_3":    w.acct_val_3,
                "premium":       prem,
                "realized_pnl":  round(week_realized[w.id], 2),
                "position_count": week_pos_count[w.id],
            })

        # Monthly account value series
        monthly: dict[str, float] = {}
        monthly_premium: dict[str, float] = {}
        for w in all_weeks:
            key = w.week_end.strftime("%Y-%m")
            if w.account_value is not None and w.is_complete:
                monthly[key] = w.account_value  # last complete week of the month wins
            monthly_premium[key] = round(
                monthly_premium.get(key, 0.0) + week_premium.get(w.id, 0.0), 2
            )

        # Pad months from January up to (and including) the current month so the chart
        # shows a YTD skeleton without rendering future empty bars.
        import datetime as _dt
        _now = _dt.datetime.utcnow()
        _cy  = _now.year
        _cm  = _now.month
        for _m in range(1, _cm + 1):
            _k = f"{_cy}-{_m:02d}"
            if _k not in monthly_premium:
                monthly_premium[_k] = 0.0
        # Keep chronological order
        monthly_premium = dict(sorted(monthly_premium.items()))

        # Win rate: weeks with positive premium
        complete_weeks = [w for w in all_weeks if w.is_complete]
        winning_weeks = sum(1 for w in complete_weeks if week_premium.get(w.id, 0) > 0)
        win_rate = round(winning_weeks / len(complete_weeks) * 100, 1) if complete_weeks else 0.0

        complete_breakdown = [w for w in weeks_breakdown if w["is_complete"]]
        best_week = max(complete_breakdown, key=lambda x: x["premium"], default=None)
        worst_week = min(complete_breakdown, key=lambda x: x["premium"], default=None)

        # Estimated capital gains tax (short-term: 22% bracket default)
        cap_gains_tax_rate = 0.22
        estimated_tax = max(0.0, realized_pnl * cap_gains_tax_rate)

        return {
            "total_premium_collected": round(total_premium, 2),
            "realized_pnl":            round(realized_pnl, 2),
            "active_positions":        active_count,
            "assigned_positions":      assigned_count,
            "estimated_tax":           round(estimated_tax, 2),
            "cap_gains_tax_rate":      cap_gains_tax_rate,
            "monthly_account_values":  monthly,
            "monthly_premium":         monthly_premium,
            "total_weeks":             len(all_weeks),
            "complete_weeks":          len(complete_weeks),
            "win_rate":                win_rate,
            "best_week":               best_week,
            "worst_week":              worst_week,
            "weeks_breakdown":         weeks_breakdown,
        }
    finally:
        session.close()


def symbol_summary(*, user_id: int) -> list[dict]:
    """Per-symbol aggregated P&L — powers the searchable stock list."""
    session = _portfolio_session()
    try:
        all_positions = (
            session.query(OptionPosition)
            .filter(OptionPosition.user_id == user_id)
            .all()
        )
        by_symbol: dict[str, dict[str, Any]] = {}
        seen_origin: set[int] = set()

        for p in all_positions:
            origin_id = p.carried_from_id or p.id
            if origin_id in seen_origin:
                continue
            seen_origin.add(origin_id)

            sym = p.symbol
            if sym not in by_symbol:
                by_symbol[sym] = {
                    "symbol": sym,
                    "total_premium": 0.0,
                    "realized_pnl":  0.0,
                    "active":        0,
                    "closed":        0,
                    "expired":       0,
                    "assigned":      0,
                }
            gross = (p.premium_in or 0.0) * p.contracts * 100
            net   = _net_premium(p) * p.contracts * 100
            by_symbol[sym]["total_premium"] += gross
            if p.status in (OptionPositionStatus.CLOSED, OptionPositionStatus.EXPIRED,
                            OptionPositionStatus.ASSIGNED):
                # Premium is fully realized for closed, expired, and assigned positions
                # (assigned = option exercised against you; premium collected is kept)
                by_symbol[sym]["realized_pnl"] += net
                if p.status == OptionPositionStatus.CLOSED:
                    by_symbol[sym]["closed"] += 1
                elif p.status == OptionPositionStatus.EXPIRED:
                    by_symbol[sym]["expired"] += 1
                else:
                    by_symbol[sym]["assigned"] += 1
            elif p.status == OptionPositionStatus.ACTIVE:
                by_symbol[sym]["active"] += 1

        result = list(by_symbol.values())
        result.sort(key=lambda x: x["symbol"])
        for r in result:
            r["total_premium"] = round(r["total_premium"], 2)
            r["realized_pnl"]  = round(r["realized_pnl"],  2)
        return result
    finally:
        session.close()
