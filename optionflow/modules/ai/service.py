"""optionflow/modules/ai/service.py — portfolio context, system prompt, streamed chat.

Ported from web/app/api/ai/chat/route.ts. Context now comes from the portfolio
module's services (the old route asked for GET /holdings, which never existed,
so the assistant never saw stock holdings).
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterator, List

from optionflow.providers import ai as ai_provider

logger = logging.getLogger("optionflow.ai")


def build_context(user_id: int) -> Dict[str, Any]:
    """Holdings, current-week positions, summary and premium totals (each best effort)."""
    from optionflow.modules.portfolio import holdings, positions, premium_ledger, summary, weeks

    def _try(fn, default):
        try:
            return fn()
        except Exception as exc:
            logger.warning("AI context: %s failed: %s", getattr(fn, "__name__", fn), exc)
            return default

    all_weeks = _try(lambda: weeks.list_weeks(user_id=user_id), [])
    week = next((w for w in reversed(all_weeks) if not w.get("is_complete")), all_weeks[-1] if all_weeks else None)
    return {
        "holdings": _try(lambda: holdings.list_holdings(user_id=user_id), []),
        "positions": _try(lambda: positions.list_positions(user_id=user_id, week_id=week["id"]), []) if week else [],
        "summary": _try(lambda: summary.portfolio_summary(user_id=user_id), None),
        "premium_dashboard": _try(lambda: premium_ledger.get_premium_dashboard(user_id=user_id), None),
    }


def _money(v) -> str:
    return f"{v:.2f}" if isinstance(v, (int, float)) else "?"


def system_prompt(ctx: Dict[str, Any], today: date | None = None) -> str:
    today = today or datetime.now(timezone.utc).date()
    holding_lines = "\n".join(
        f"  - {h.get('symbol')}: {h.get('shares')} shares @ ${_money(h.get('cost_basis'))} cost basis, "
        f"live adj basis ${_money(h.get('live_adj_basis'))}"
        for h in ctx["holdings"]) or "  (none)"

    def _dte(exp):
        try:
            return (datetime.fromisoformat(str(exp)[:10]).date() - today).days
        except Exception:
            return "?"
    position_lines = "\n".join(
        f"  - {p.get('symbol')} ${p.get('strike')} {p.get('option_type')} x{p.get('contracts')} [{p.get('status')}] "
        f"prem=${p.get('premium_in') if p.get('premium_in') is not None else '?'} DTE={_dte(p.get('expiry_date'))}"
        for p in ctx["positions"]) or "  (none)"
    s = ctx["summary"]
    summary_text = (f"Total premium collected: ${_money(s.get('total_premium_collected'))}, "
                    f"Win rate: {(s.get('win_rate') or 0) * 100:.1f}%, Active positions: {s.get('active_positions')}"
                    ) if s else "(not available)"
    g = (ctx["premium_dashboard"] or {}).get("grand_total")
    prem_text = (f"Realized: ${_money(g.get('realized_premium'))}, In-flight: ${_money(g.get('unrealized_premium'))}, "
                 f"Total sold: ${_money(g.get('total_premium_sold'))}") if g else "(not available)"
    return f"""You are an AI trading assistant embedded in OptionFlow, a personal options trading journal and analytics app.

The user trades weekly options — primarily cash-secured puts (CSPs) and covered calls (CCs) — as a premium income strategy to reduce cost basis on stock holdings.

## Current Portfolio Context

### Holdings (stocks owned):
{holding_lines}

### Current Week Positions (options):
{position_lines}

### Portfolio Summary:
{summary_text}

### Premium Ledger:
{prem_text}

## Your Role
- Analyze positions, suggest roll/close decisions, flag risk
- Answer questions about P&L, ROI, DTE urgency, coverage
- Suggest new strikes/expirations given their portfolio
- Be concise and specific — use the data above, not generic advice
- Always acknowledge you can't see real-time market prices unless told
- Never recommend specific buy/sell orders as financial advice — frame as analysis only

Today's date: {today.isoformat()}"""


def chat(user_id: int, messages: List[dict]) -> Iterator[str]:
    """Stream the assistant's reply to `messages` ([{role, content}]) for this user."""
    return ai_provider.chat_stream(system_prompt(build_context(user_id)), messages)
