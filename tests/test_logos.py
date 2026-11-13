"""Logo tiles: normalising images, the disk cache, misses, and the public endpoint."""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from optionflow.core.settings import Settings
from optionflow.main import create_app
from optionflow.modules.market import logos


def _png(color, size=(120, 60), mode="RGBA"):
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, "PNG")
    return buf.getvalue()


def _transparent_with(color):
    im = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    im.paste(Image.new("RGBA", (40, 20), color), (30, 40))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _corner(png):
    return Image.open(io.BytesIO(png)).convert("RGB").getpixel((1, 1))


def test_clean():
    assert logos.clean("aapl") == "AAPL" and logos.clean("BRK.B") == "BRK.B" and logos.clean("AAPL.png") == "AAPL"
    assert logos.clean("../etc") is None and logos.clean("") is None and logos.clean("A" * 20) is None


def test_tiles_are_64_square_with_contrasting_background():
    opaque = Image.open(io.BytesIO(logos.tile(_png((200, 30, 30, 255)))))
    assert opaque.size == (64, 64)
    assert _corner(logos.tile(_transparent_with((20, 20, 20, 255)))) == (255, 255, 255)   # dark logo → white tile
    assert _corner(logos.tile(_transparent_with((250, 250, 250, 255)))) == (24, 28, 36)   # white logo → dark tile


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(logos, "_dir", lambda: tmp_path)
    return tmp_path


def test_cache_and_miss(store, monkeypatch):
    calls = []
    monkeypatch.setattr(logos, "_fetch", lambda s: calls.append(s) or (logos.tile(_png((0, 0, 255, 255))) if s == "AAPL" else None))
    assert logos.get("AAPL", now=1e9) and logos.get("AAPL", now=1e9) and calls == ["AAPL"]       # fetched once
    assert logos.get("ZZZZ", now=1e9) is None and logos.get("ZZZZ", now=1e9) is None
    assert calls.count("ZZZZ") == 1                                                            # miss remembered


def test_network_error_serves_stale(store, monkeypatch):
    (store / "MSFT.png").write_bytes(b"old")
    import os
    os.utime(store / "MSFT.png", (0, 0))                                                       # older than KEEP
    def boom(_):
        raise RuntimeError("down")
    monkeypatch.setattr(logos, "_fetch", boom)
    assert logos.get("MSFT", now=1e9) == b"old"


def test_endpoint_is_public(store, monkeypatch, settings_override):
    monkeypatch.setattr(logos, "_fetch", lambda s: logos.tile(_png((0, 128, 0, 255))) if s == "NVDA" else None)
    c = TestClient(create_app(Settings(_env_file=None)))
    r = c.get("/api/v1/logos/nvda")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and "max-age" in r.headers["cache-control"]
    assert c.get("/api/v1/logos/NOPE").status_code == 404
    assert c.get("/api/v1/logos/bad%20sym").status_code == 404
