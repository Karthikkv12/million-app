"""
Tests for logic/portfolio.py — weekly options portfolio service layer.
"""
import datetime
import pytest
from logic import services
import logic.portfolio as port


# ── helpers ──────────────────────────────────────────────────────────────────

def make_user(name="trader1"):
    return services.create_user(name, "GoodPassword12")


def _monday(offset_weeks=0):
    """Return a date that lands on the Monday of (this week + offset_weeks)."""
    today = datetime.date(2026, 2, 23)  # known Monday
    return today + datetime.timedelta(weeks=offset_weeks)


# ── week CRUD ─────────────────────────────────────────────────────────────────

def test_get_or_create_week_is_idempotent(db_engine_and_session):
    uid = make_user("w1")
    w1 = port.get_or_create_week(user_id=uid, for_date=_monday())
    w2 = port.get_or_create_week(user_id=uid, for_date=_monday())
    assert w1["id"] == w2["id"]


def test_list_weeks_newest_first(db_engine_and_session):
    uid = make_user("w2")
    port.get_or_create_week(user_id=uid, for_date=_monday(0))
    port.get_or_create_week(user_id=uid, for_date=_monday(1))
    port.get_or_create_week(user_id=uid, for_date=_monday(2))
    weeks = port.list_weeks(user_id=uid)
    assert len(weeks) == 3
    # newest (highest week_end) comes first
    ends = [w["week_end"] for w in weeks]
    assert ends == sorted(ends, reverse=True)


def test_update_week_account_value(db_engine_and_session):
    uid = make_user("w3")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    updated = port.update_week(user_id=uid, week_id=w["id"], account_value=98_500.0, notes="good week")
    assert updated["account_value"] == 98_500.0
    assert updated["notes"] == "good week"


def test_week_isolation_between_users(db_engine_and_session):
    u1 = make_user("wi1")
    u2 = make_user("wi2")
    port.get_or_create_week(user_id=u1, for_date=_monday())
    port.get_or_create_week(user_id=u2, for_date=_monday())
    assert len(port.list_weeks(user_id=u1)) == 1
    assert len(port.list_weeks(user_id=u2)) == 1
    # different week ids
    id1 = port.list_weeks(user_id=u1)[0]["id"]
    id2 = port.list_weeks(user_id=u2)[0]["id"]
    assert id1 != id2


# ── position CRUD ─────────────────────────────────────────────────────────────

def _pos_body(**kwargs):
    defaults = dict(
        symbol="AAPL", contracts=1, strike=170.0,
        option_type="PUT", sold_date="2026-02-23",
        expiry_date="2026-03-07", premium_in=1.20,
        is_roll=False, status="ACTIVE",
    )
    defaults.update(kwargs)
    return defaults


def test_create_and_list_positions(db_engine_and_session):
    uid = make_user("p1")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="AAPL"))
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="TSLA", strike=300.0))
    positions = port.list_positions(user_id=uid, week_id=w["id"])
    assert len(positions) == 2
    symbols = {p["symbol"] for p in positions}
    assert symbols == {"AAPL", "TSLA"}


def test_position_net_and_total_premium(db_engine_and_session):
    uid = make_user("p2")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(contracts=2, premium_in=1.50))
    p = port.list_positions(user_id=uid, week_id=w["id"])[0]
    # net_premium = premium_in + premium_out (out is None → 0)
    assert p["net_premium"] == pytest.approx(1.50)
    # total_premium = net_premium × contracts × 100
    assert p["total_premium"] == pytest.approx(1.50 * 2 * 100)


def test_roll_total_premium(db_engine_and_session):
    uid = make_user("p3")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    # premium_in=2.00, premium_out=0.50 (credit roll)
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(contracts=1, premium_in=2.00, premium_out=0.50, is_roll=True))
    p = port.list_positions(user_id=uid, week_id=w["id"])[0]
    assert p["net_premium"] == pytest.approx(2.50)
    assert p["total_premium"] == pytest.approx(2.50 * 100)


def test_update_position_status(db_engine_and_session):
    uid = make_user("p4")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    pos = port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())
    updated = port.update_position(user_id=uid, position_id=pos["id"], data={"status": "CLOSED"})
    assert updated["status"] == "CLOSED"


def test_delete_position(db_engine_and_session):
    uid = make_user("p5")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    pos = port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())
    port.delete_position(user_id=uid, position_id=pos["id"])
    assert port.list_positions(user_id=uid, week_id=w["id"]) == []


def test_cannot_add_position_to_complete_week(db_engine_and_session):
    uid = make_user("p6")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.mark_week_complete(user_id=uid, week_id=w["id"])
    with pytest.raises(ValueError, match="complete"):
        port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())


def test_position_isolation_between_users(db_engine_and_session):
    u1 = make_user("pi1")
    u2 = make_user("pi2")
    w1 = port.get_or_create_week(user_id=u1, for_date=_monday())
    w2 = port.get_or_create_week(user_id=u2, for_date=_monday())
    port.create_position(user_id=u1, week_id=w1["id"], data=_pos_body(symbol="AAPL"))
    assert port.list_positions(user_id=u2, week_id=w2["id"]) == []


# ── carry-forward ─────────────────────────────────────────────────────────────

def test_mark_complete_carries_active_positions(db_engine_and_session):
    uid = make_user("cf1")
    w = port.get_or_create_week(user_id=uid, for_date=_monday(0))
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="AAPL", status="ACTIVE"))
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="MSFT", status="CLOSED"))
    port.mark_week_complete(user_id=uid, week_id=w["id"], account_value=100_000.0)

    weeks = port.list_weeks(user_id=uid)
    assert len(weeks) == 2  # original + new week
    new_week = [wk for wk in weeks if wk["id"] != w["id"]][0]
    carried = port.list_positions(user_id=uid, week_id=new_week["id"])
    # Only ACTIVE gets carried, not CLOSED
    assert len(carried) == 1
    assert carried[0]["symbol"] == "AAPL"
    assert carried[0]["carried_from_id"] is not None
    assert carried[0]["status"] == "ACTIVE"


def test_mark_complete_sets_is_complete(db_engine_and_session):
    uid = make_user("cf2")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.mark_week_complete(user_id=uid, week_id=w["id"], account_value=99_000.0)
    weeks = port.list_weeks(user_id=uid)
    original = [wk for wk in weeks if wk["id"] == w["id"]][0]
    assert original["is_complete"] is True
    assert original["account_value"] == 99_000.0


def test_double_complete_is_idempotent(db_engine_and_session):
    """Calling mark_week_complete twice should not duplicate carries."""
    uid = make_user("cf3")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())
    port.mark_week_complete(user_id=uid, week_id=w["id"])
    port.mark_week_complete(user_id=uid, week_id=w["id"])  # second call should be no-op
    weeks = port.list_weeks(user_id=uid)
    assert len(weeks) == 2  # still only 2 weeks, not 3


# ── assignment & cost basis ───────────────────────────────────────────────────

def test_create_assignment_marks_position_assigned(db_engine_and_session):
    uid = make_user("a1")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    pos = port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())
    port.create_assignment(user_id=uid, position_id=pos["id"], data={
        "symbol": "AAPL",
        "shares_acquired": 100,
        "acquisition_price": 168.0,
        "net_option_premium": 120.0,
    })
    updated_pos = port.list_positions(user_id=uid, week_id=w["id"])[0]
    assert updated_pos["status"] == "ASSIGNED"


def test_cost_basis_calculation(db_engine_and_session):
    uid = make_user("a2")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    pos = port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())
    asgn = port.create_assignment(user_id=uid, position_id=pos["id"], data={
        "symbol": "AAPL",
        "shares_acquired": 100,
        "acquisition_price": 170.0,
        "net_option_premium": 300.0,  # $3.00 per share × 100
    })
    # weighted_avg_cost = 170.0
    assert asgn["weighted_avg_cost"] == pytest.approx(170.0)
    # downside_basis = 170.0 - (300/100) = 167.0
    assert asgn["downside_basis"] == pytest.approx(167.0)
    # upside_basis = 170.0 (weighted avg, relevant for covered call threshold)
    assert asgn["upside_basis"] == pytest.approx(170.0)
    assert asgn["total_cost"] == pytest.approx(170.0 * 100)
    assert asgn["total_shares"] == 100


def test_get_assignment_for_position(db_engine_and_session):
    uid = make_user("a3")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    pos = port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())
    port.create_assignment(user_id=uid, position_id=pos["id"], data={
        "symbol": "AAPL",
        "shares_acquired": 100,
        "acquisition_price": 165.0,
        "net_option_premium": 200.0,
    })
    fetched = port.get_assignment_for_position(user_id=uid, position_id=pos["id"])
    assert fetched is not None
    assert fetched["symbol"] == "AAPL"
    assert fetched["shares_acquired"] == 100


def test_update_assignment(db_engine_and_session):
    uid = make_user("a4")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    pos = port.create_position(user_id=uid, week_id=w["id"], data=_pos_body())
    asgn = port.create_assignment(user_id=uid, position_id=pos["id"], data={
        "symbol": "AAPL",
        "shares_acquired": 100,
        "acquisition_price": 165.0,
        "net_option_premium": 0.0,
    })
    updated = port.update_assignment(user_id=uid, assignment_id=asgn["id"], data={"acquisition_price": 160.0, "net_option_premium": 500.0})
    assert updated["acquisition_price"] == pytest.approx(160.0)
    assert updated["downside_basis"] == pytest.approx(160.0 - 500.0 / 100)


# ── portfolio summary ─────────────────────────────────────────────────────────

def test_portfolio_summary_counts(db_engine_and_session):
    uid = make_user("s1")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="AAPL", premium_in=1.50, status="ACTIVE"))
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="TSLA", premium_in=2.00, status="CLOSED"))
    summary = port.portfolio_summary(user_id=uid)
    assert summary["active_positions"] == 1
    assert summary["total_weeks"] == 1
    # total premium from closed: 2.00 × 1 × 100 = 200.0
    # active not counted in realized_pnl but in total_premium_collected
    assert summary["total_premium_collected"] >= 200.0


def test_portfolio_summary_skips_carried_duplicates(db_engine_and_session):
    """Carried-forward positions must not double-count premium."""
    uid = make_user("s2")
    w = port.get_or_create_week(user_id=uid, for_date=_monday(0))
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="AAPL", premium_in=2.00, contracts=1, status="ACTIVE"))
    port.mark_week_complete(user_id=uid, week_id=w["id"])

    summary_before = port.portfolio_summary(user_id=uid)
    # The carried position is a copy — total_premium_collected should only count original once
    # We check it equals 2.00 * 1 * 100 = 200.0, not 400.0
    assert summary_before["total_premium_collected"] == pytest.approx(200.0)


def test_estimated_tax_is_22_pct_of_realized_pnl(db_engine_and_session):
    uid = make_user("s3")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(premium_in=2.00, contracts=1, status="CLOSED"))
    summary = port.portfolio_summary(user_id=uid)
    assert summary["cap_gains_tax_rate"] == pytest.approx(0.22)
    assert summary["estimated_tax"] == pytest.approx(summary["realized_pnl"] * 0.22)


# ── symbol summary ────────────────────────────────────────────────────────────

def test_symbol_summary_aggregation(db_engine_and_session):
    uid = make_user("ss1")
    w = port.get_or_create_week(user_id=uid, for_date=_monday())
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="AAPL", premium_in=1.00, contracts=1, status="CLOSED"))
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="AAPL", premium_in=1.50, contracts=2, status="EXPIRED"))
    port.create_position(user_id=uid, week_id=w["id"], data=_pos_body(symbol="TSLA", premium_in=3.00, contracts=1, status="ACTIVE"))
    syms = port.symbol_summary(user_id=uid)
    aapl = next(s for s in syms if s["symbol"] == "AAPL")
    tsla = next(s for s in syms if s["symbol"] == "TSLA")
    assert aapl["closed"] == 1
    assert aapl["expired"] == 1
    assert aapl["active"] == 0
    assert tsla["active"] == 1
    assert tsla["closed"] == 0


def test_symbol_summary_empty_for_new_user(db_engine_and_session):
    uid = make_user("ss2")
    assert port.symbol_summary(user_id=uid) == []
