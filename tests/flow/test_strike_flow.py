"""Per-strike bought / sold flow: save + restore round trip and the API payload (in-memory DB, no network)."""
import pytest

from optionflow.modules.flow import repo, service, traded

C1 = ("2026-12-18", 100.0, "call")
C2 = ("2026-12-24", 100.0, "call")
P1 = ("2026-12-18", 95.0, "put")


@pytest.fixture(autouse=True)
def _clean(db_engine_and_session):
    traded.clear()
    yield
    traded.clear()


def test_save_load_and_payload_from_saved_day():
    repo.save_strike_sides("XYZ", "2026-11-12", {C1: [1000.0, 200.0, 50000.0, 10000.0], P1: [300.0, 0.0, -9000.0, 0.0]})
    repo.save_strike_sides("XYZ", "2026-11-13", {C1: [10.0, 0.0, 500.0, 0.0], C2: [20.0, 5.0, 800.0, 100.0]})
    repo.save_strike_sides("XYZ", "2026-11-13", {C2: [40.0, 5.0, 1600.0, 100.0]})         # replaces the day
    day, by = repo.load_strike_sides("XYZ")
    assert day == "2026-11-13" and by == {C2: [40.0, 5.0, 1600.0, 100.0]}
    assert repo.load_strike_sides("XYZ", "2026-11-12")[1][P1] == [300.0, 0.0, -9000.0, 0.0]
    assert repo.load_strike_sides("NOPE") is None

    out = service.strike_flow("xyz")                      # nothing live: falls back to the latest saved day
    assert out["live"] is False and out["day"] == "2026-11-13" and out["expiries"] == ["2026-12-24"]
    assert out["rows"][0]["call_delta"] == 1500.0 and out["net_delta"] == 1500.0


def test_payload_sums_expiries_per_strike_and_filters():
    repo.save_strike_sides("XYZ", "2026-11-12", {C1: [1000.0, 200.0, 50000.0, 10000.0], C2: [100.0, 0.0, 2000.0, 0.0],
                                                 P1: [300.0, 0.0, -9000.0, 0.0]})
    out = service.strike_flow("XYZ")
    by = {r["strike"]: r for r in out["rows"]}
    assert by[100.0]["call_bought"] == 1100.0 and by[100.0]["call_delta"] == 42000.0
    assert by[95.0]["put_delta"] == -9000.0                # puts bought: customers added short delta
    assert out["net_delta"] == 33000.0
    one = service.strike_flow("XYZ", expiry="2026-12-24")
    assert [r["strike"] for r in one["rows"]] == [100.0] and one["net_delta"] == 2000.0
