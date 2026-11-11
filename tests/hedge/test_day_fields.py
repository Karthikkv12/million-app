"""Hedge books / holdings: day change vs extended-hours change (C-54)."""
import pytest

from optionflow.modules.hedge import service


def _q(**kw):
    return lambda sym: kw


def test_overnight_day_change_is_last_session_and_ext_is_live(monkeypatch):
    monkeypatch.setattr(service, "_quote", _q(prev_close=40.87, change_pct=12.48, session="overnight",
                                              regular_close=45.97, regular_close_date="2026-11-06"))
    d = service._day_fields("SOXL", 45.05)
    assert d["day_change"] == pytest.approx(0.1248)                  # Friday's move ("Today")
    assert d["ext_change"] == pytest.approx(-0.92)                    # from the live 1 s spot
    assert d["ext_change_pct"] == pytest.approx(-2.0013, abs=1e-3)
    assert d["session"] == "overnight" and d["regular_close_date"] == "2026-11-06"


def test_regular_session_day_change_from_spot(monkeypatch):
    monkeypatch.setattr(service, "_quote", _q(prev_close=45.97, change_pct=1.0, session="regular", regular_close=45.97))
    d = service._day_fields("SOXL", 46.43)
    assert d["day_change"] == pytest.approx(0.01, abs=1e-4) and d["ext_change"] is None


def test_yahoo_quote_without_session(monkeypatch):
    monkeypatch.setattr(service, "_quote", _q(prev_close=100.0))
    d = service._day_fields("X", 101.0)
    assert d["day_change"] == pytest.approx(0.01) and d["session"] is None and d["ext_change"] is None
