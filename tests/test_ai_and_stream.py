"""AI chat module (moved from Next.js) and the flow SSE stream (plan step 6)."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.ai import service as ai_service
from optionflow.modules.auth import service as auth
from optionflow.modules.flow import service as flow_service
from optionflow.modules.flow.gamma import GEXResult
from optionflow.providers import ai as ai_provider


# ── Helpers ───────────────────────────────────────────────────────────────────
def _app():
    return TestClient(create_app(Settings(_env_file=None, enabled_modules="auth,flow,ai")))


def _token(client):
    auth.create_user("ana", "AnaPassword1234")
    return client.post("/api/v1/auth/login", json={"username": "ana", "password": "AnaPassword1234"}).json()["access_token"]


def _sse(*texts):
    return "".join(f"data: {json.dumps(t)}\n\n" for t in texts).encode()


@pytest.fixture
def transport(settings_override):
    calls = []
    routes = {}

    def handler(request: httpx.Request):
        calls.append(request)
        key = request.url.params.get("key") or request.headers.get("authorization", "")
        status, body = routes.get(key, (500, b"{}"))
        return httpx.Response(status, content=body)

    ai_provider.use_transport(httpx.MockTransport(handler))
    yield routes, calls
    ai_provider.use_transport(None)


def _gemini_chunk(text):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def _openai_chunk(text):
    return {"choices": [{"delta": {"content": text}}]}


# ── AI provider ───────────────────────────────────────────────────────────────
def test_gemini_streams_text(transport, settings_override):
    routes, calls = transport
    settings_override(gemini_api_key="g1")
    routes["g1"] = (200, _sse(_gemini_chunk("Hello"), _gemini_chunk(" there")))
    assert "".join(ai_provider.chat_stream("sys", [{"role": "user", "content": "hi"}])) == "Hello there"
    body = json.loads(calls[0].content)
    assert body["systemInstruction"]["parts"][0]["text"] == "sys" and body["contents"][0]["role"] == "user"


def test_gemini_rotates_keys_on_quota_then_falls_back_to_openai(transport, settings_override):
    routes, calls = transport
    settings_override(gemini_api_key="g1", gemini_api_key_2="g2", openai_api_key="sk-o")
    routes["g1"] = (429, b"{}")
    routes["g2"] = (429, b"{}")
    routes["Bearer sk-o"] = (200, _sse(_openai_chunk("from openai")) + b"data: [DONE]\n\n")
    assert "".join(ai_provider.chat_stream("sys", [{"role": "user", "content": "hi"}])) == "from openai"
    assert [c.url.params.get("key") for c in calls[:2]] == ["g1", "g2"]


def test_all_gemini_keys_over_quota_without_openai_is_429(transport, settings_override):
    routes, _ = transport
    settings_override(gemini_api_key="g1")
    routes["g1"] = (429, b"{}")
    with pytest.raises(Exception) as exc:
        ai_provider.chat_stream("sys", [{"role": "user", "content": "hi"}])
    assert exc.value.status_code == 429


def test_openai_quota_error_message(transport, settings_override):
    routes, _ = transport
    settings_override(openai_api_key="sk-o")
    routes["Bearer sk-o"] = (429, json.dumps({"error": {"code": "insufficient_quota"}}).encode())
    with pytest.raises(Exception) as exc:
        ai_provider.chat_stream("sys", [{"role": "user", "content": "hi"}])
    assert exc.value.status_code == 429 and "billing" in exc.value.message


# ── AI module ─────────────────────────────────────────────────────────────────
def test_system_prompt_includes_holdings_and_positions(user_id):
    from optionflow.modules.portfolio import holdings, positions, weeks
    holdings.create_holding(user_id=user_id, data={"symbol": "AAPL", "shares": 100, "cost_basis": 150.0})
    w = weeks.get_or_create_week(user_id=user_id)
    positions.create_position(user_id=user_id, week_id=w["id"], data={"symbol": "AAPL", "contracts": 1, "strike": 160,
                              "option_type": "CALL", "premium_in": 2.5, "expiry_date": "2026-11-20T00:00:00"})
    prompt = ai_service.system_prompt(ai_service.build_context(user_id))
    assert "AAPL: 100.0 shares @ $150.00 cost basis" in prompt          # the old route never had holdings
    assert "AAPL $160.0 CALL x1 [ACTIVE] prem=$2.5" in prompt


def test_chat_endpoint_streams_and_errors(db_engine_and_session, transport, settings_override):
    routes, _ = transport
    no_keys = _app()
    tok = _token(no_keys)
    h = {"Authorization": f"Bearer {tok}"}
    r = no_keys.post("/api/v1/ai/chat", headers=h, json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503 and r.json()["error"]["code"] == "unavailable"
    assert no_keys.post("/api/v1/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 401
    assert no_keys.post("/api/v1/ai/chat", headers=h, json={"messages": []}).status_code == 422

    settings_override(gemini_api_key="g1")     # runtime settings (create_app only picks modules)
    with_key = no_keys
    routes["g1"] = (200, _sse(_gemini_chunk("Roll the "), _gemini_chunk("AAPL call.")))
    r = with_key.post("/api/v1/ai/chat", headers=h, json={"messages": [{"role": "user", "content": "advice?"}]})
    assert r.status_code == 200 and r.text == "Roll the AAPL call." and r.headers["content-type"].startswith("text/plain")


def test_ai_module_is_off_by_default():
    app = create_app(Settings(_env_file=None))
    assert "ai" not in app.state.enabled_modules
    assert TestClient(app).post("/api/v1/ai/chat", json={}).status_code == 404


# ── Flow stream ───────────────────────────────────────────────────────────────
def test_flow_stream_sends_gex_event(db_engine_and_session, monkeypatch):
    monkeypatch.setattr(flow_service, "compute_gamma_exposure",
                        lambda s: GEXResult(symbol=s, spot=512.5, expiries=[], call_premium=1.0, put_premium=1.0))
    monkeypatch.setattr("optionflow.workers.backfill.start_backfill", lambda s: None)
    flow_service.clear_cache()
    client = _app()
    tok = _token(client)
    assert client.get("/api/v1/flow/SPY/stream").status_code == 401
    with client.stream("GET", "/api/v1/flow/spy/stream", params={"access_token": tok, "limit": 1}) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        text = "".join(r.iter_text())
    assert text.startswith("retry: 5000")
    event = [block for block in text.split("\n\n") if block.startswith("event: gex")][0]
    data = json.loads(event.split("data: ", 1)[1])
    assert data["symbol"] == "SPY" and data["spot"] == 512.5
    assert "SPY" in flow_service.active_symbols()                         # streaming keeps the symbol watched
    flow_service.clear_cache()
