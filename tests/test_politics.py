"""Political influence (modules/politics): name matching, lobbying maths, trades, caching, routes. No network."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from optionflow.core.deps import get_current_user
from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.politics import names, service, sources


# ── Names ────────────────────────────────────────────────────────────────────
def test_norm_drops_suffixes_and_punctuation():
    assert names.norm("NVIDIA Corporation") == names.norm("NVIDIA") == "NVIDIA"
    assert names.norm("Apple Inc.") == "APPLE"
    assert names.norm("Johnson & Johnson") == "JOHNSON AND JOHNSON"
    assert names.norm("LOCKHEED MARTIN CORP") == "LOCKHEED MARTIN"
    assert names.norm(None) == ""


def test_exact_matches_only_and_aliases():
    wanted = names.candidates("AAPL", "Apple Inc.")
    assert names.matches("APPLE INC", wanted)
    assert not names.matches("APPLE HOSPITALITY REIT", wanted)       # look-alikes never count
    assert "GOOGLE" in names.candidates("GOOGL", "Alphabet Inc.")


# ── Lobbying ─────────────────────────────────────────────────────────────────
def _filing(reg, client, year, period, income=None, expenses=None, posted="2026-01-01", uuid=None, issues=()):
    return {"filing_uuid": uuid or f"{reg}-{year}-{period}-{posted}", "registrant": {"id": hash(reg) % 1000, "name": reg},
            "client": {"name": client}, "filing_year": year, "filing_period": period, "income": income,
            "expenses": expenses, "dt_posted": posted,
            "lobbying_activities": [{"general_issue_code_display": i, "government_entities": [{"name": "SENATE"}]}
                                    for i in issues]}


def test_lobbying_in_house_report_is_used_alone_and_amendments_replace():
    wanted = names.candidates("NVDA", "NVIDIA Corporation")
    filings = [
        # Q1: in-house report (includes the outside firms) → 1.29M, not 1.29M + 80k
        _filing("NVIDIA CORPORATION", "NVIDIA CORPORATION", 2026, "first_quarter", expenses="1290000.00", issues=["Trade"]),
        _filing("TIBER CREEK GROUP", "NVIDIA CORPORATION", 2026, "first_quarter", income="80000.00", issues=["Defense"]),
        # Q2: outside firms only → summed; the amended report replaces the original
        _filing("BGR", "NVIDIA", 2026, "second_quarter", income="100000.00", posted="2026-07-01"),
        _filing("BGR", "NVIDIA", 2026, "second_quarter", income="120000.00", posted="2026-08-01"),
        _filing("VOGEL", "NVIDIA", 2026, "second_quarter", income="60000.00"),
        # not this company
        _filing("X", "NVIDIA FAN CLUB", 2026, "second_quarter", income="999999.00"),
        _filing("Y", "NVIDIA", 2026, "registration", income="5.00"),
    ]
    out = service.lobbying_summary(filings, wanted)
    assert [(q["period"], q["amount"]) for q in out["quarters"]] == [("2026 Q1", 1290000.0), ("2026 Q2", 180000.0)]
    assert out["total"] == 1470000.0 and out["latest"]["period"] == "2026 Q2" and out["in_house"]
    assert out["firms"][0] == "BGR" and "NVIDIA CORPORATION" not in out["firms"]
    assert {i["name"] for i in out["issues"]} == {"Trade", "Defense"}


def test_lobbying_keeps_the_last_four_quarters():
    wanted = ["ACME"]
    periods = [(2025, p) for p in ("first_quarter", "second_quarter", "third_quarter", "fourth_quarter")] + \
              [(2026, "first_quarter")]
    out = service.lobbying_summary([_filing("F", "ACME", y, p, income="10") for y, p in periods], wanted)
    assert [q["period"] for q in out["quarters"]] == ["2025 Q2", "2025 Q3", "2025 Q4", "2026 Q1"]
    assert service.lobbying_summary([], wanted)["status"] == "none"


# ── Congress ─────────────────────────────────────────────────────────────────
def test_normalise_trade():
    t = service.normalise_trade({"symbol": "nvda", "firstName": "Jane", "lastName": "Doe", "type": "Sale (Partial)",
                                 "amount": "$1,001 - $15,000", "transactionDate": "2026-09-01",
                                 "disclosureDate": "2026-10-10", "owner": "Spouse", "_chamber": "Senate"})
    assert (t["symbol"], t["member"], t["side"], t["days_late"], t["chamber"]) == ("NVDA", "Jane Doe", "sell", 39, "Senate")
    assert service.normalise_trade({"type": "Purchase"})["side"] == "buy"
    assert service.normalise_trade({"type": "Exchange"})["side"] == "exchange"


# ── Profile, cache, summary ──────────────────────────────────────────────────
@pytest.fixture
def fake(monkeypatch, tmp_path, settings_override):
    settings_override(db_dir=str(tmp_path), fmp_api_key="k")
    service.clear()
    calls = {"lda": 0, "usa": 0, "fmp": 0}
    monkeypatch.setattr(service, "company_name", lambda s: {"LMT": "Lockheed Martin Corporation"}.get(s))

    def lda(q, year, max_pages=4):
        calls["lda"] += 1
        return [_filing("LOCKHEED MARTIN CORPORATION", "LOCKHEED MARTIN CORPORATION", year, "third_quarter",
                        expenses="4000000", uuid=f"u{year}", issues=["Defense"])]

    def recipients(name, start, end):
        calls["usa"] += 1
        return [{"name": "LOCKHEED MARTIN CORPORATION", "amount": 5e10}, {"name": "LOCKHEED MARTIN CORP", "amount": 1e9}]

    def agencies(name, start, end):
        return [{"name": "Department of Defense", "amount": 4.9e10}]

    def trades(sym):
        calls["fmp"] += 1
        today = date.today().isoformat()
        return [{"symbol": sym, "firstName": "A", "lastName": "B", "type": "Purchase", "transactionDate": today,
                 "disclosureDate": today, "_chamber": "House"}]

    monkeypatch.setattr(sources, "lda_filings", lda)
    monkeypatch.setattr(sources, "contract_recipients", recipients)
    monkeypatch.setattr(sources, "contract_agencies", agencies)
    monkeypatch.setattr(sources, "congress_trades", trades)
    yield calls
    service.clear()


def test_profile_builds_and_caches(fake):
    p = service.profile("lmt")
    assert p["lobbying"]["status"] == "ok" and p["lobbying"]["latest"]["amount"] == 4000000.0
    assert p["contracts"]["total_12m"] == 5.1e10 and p["contracts"]["agencies"][0]["name"] == "Department of Defense"
    assert p["congress"]["buys_90d"] == 1
    service.profile("LMT")
    assert fake["usa"] == 1                                       # second call served from cache
    service._mem.clear()
    assert service.profile("LMT")["symbol"] == "LMT" and fake["usa"] == 1   # disk cache


def test_contracts_family_vs_look_alikes(fake, monkeypatch):
    wanted = ["LOCKHEED MARTIN"]
    monkeypatch.setattr(sources, "contract_recipients", lambda *a: [
        {"name": "LOCKHEED MARTIN CORPORATION", "amount": 9e9}, {"name": "SIKORSKY AIRCRAFT CORPORATION", "amount": 5e8}])
    out = service._contracts(wanted, date(2026, 11, 13))
    assert out["total_12m"] == 9.5e9 and out["agencies"]                 # 95% exact: the family, subsidiary included
    monkeypatch.setattr(sources, "contract_recipients", lambda *a: [
        {"name": "LOCKHEED MARTIN CORPORATION", "amount": 1e6}, {"name": "LOCKHEED MARTINEZ PLUMBING", "amount": 9e6}])
    out = service._contracts(wanted, date(2026, 11, 13))
    assert out["total_12m"] == 1e6 and out["agencies"] == []             # mostly look-alikes: exact matches only


def test_a_failing_source_keeps_its_last_good_answer(fake, monkeypatch):
    service.profile("LMT")
    monkeypatch.setattr(sources, "contract_recipients", lambda *a: (_ for _ in ()).throw(RuntimeError("down")))
    p = service.profile("LMT", refresh=True)
    assert p["contracts"]["status"] == "ok" and p["contracts"]["stale"] is True
    assert p["lobbying"]["status"] == "ok"


def test_unknown_company_and_not_configured(fake, settings_override, monkeypatch):
    settings_override(fmp_api_key=None)
    monkeypatch.setattr(sources, "congress_trades", lambda sym: sources._fmp("senate-trades", symbol=sym))  # real key check
    p = service.build("ZZZZ")
    assert p["lobbying"]["status"] == p["contracts"]["status"] == "unknown_company"
    assert p["congress"]["status"] == "not_configured"


def test_summary_serves_cache_and_queues_the_rest(fake):
    service.profile("LMT")
    out = service.summary(["LMT", "abc", "ABC"])
    assert [i["symbol"] for i in out["items"]] == ["LMT"] and out["pending"] == ["ABC"]
    assert out["items"][0]["lobbying_last_q"] == 4000000.0 and out["items"][0]["congress_buys_90d"] == 1
    assert service.warm_once(sleep=lambda s: None) == "ABC"
    assert "ABC" in service._mem


def test_routes(fake, monkeypatch):
    monkeypatch.setattr(service, "start_worker", lambda: None)
    app = create_app(Settings(_env_file=None, jwt_secret="t" * 32))
    app.dependency_overrides[get_current_user] = lambda: {"sub": "1"}
    c = TestClient(app)
    r = c.get("/api/v1/politics/LMT")
    assert r.status_code == 200 and r.json()["lobbying"]["latest"]["period"].endswith("Q3")
    assert "_fetched" not in r.json()
    r = c.get("/api/v1/politics/summary", params={"symbols": "LMT,XYZ"})
    assert r.status_code == 200 and r.json()["pending"] == ["XYZ"]
    assert c.get("/api/v1/politics/summary", params={"symbols": ",".join(f"S{i}" for i in range(201))}).status_code == 400
