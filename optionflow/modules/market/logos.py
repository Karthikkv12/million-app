"""optionflow/modules/market/logos.py — company / fund logos as small square tiles, cached on disk.

GET /logos/{symbol} returns a 64×64 PNG. The source image comes from Financial Modeling Prep's free logo images
(no key; stocks and ETFs). The server fetches each symbol once and keeps the tile under DB_DIR/logos, so the
browser never calls the third party, and the provider only ever sees a ticker, never a user.

Tiles are normalised so every logo reads the same in light and dark mode:
- an opaque source (a square brand image) fills the tile;
- a transparent source is trimmed and centred on a white tile, or on a dark tile when the logo itself is light
  (e.g. a white wordmark), so it never vanishes into its background.
A symbol with no logo is remembered for a day (404), and the web shows the ticker's first letter instead.
"""
from __future__ import annotations

import io
import logging
import re
import threading
import time
from pathlib import Path
from typing import Optional

import httpx
from PIL import Image

from optionflow.core.settings import get_settings

log = logging.getLogger(__name__)

SOURCE = "https://financialmodelingprep.com/image-stock/{symbol}.png"
SIZE = 64
PAD = 8                                   # transparent logos sit inside an 8 px margin
MISS_TTL = 24 * 3600                      # retry a missing logo after a day
KEEP = 30 * 24 * 3600                     # refresh a cached logo after 30 days
SYMBOL = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
WHITE, DARK = (255, 255, 255, 255), (24, 28, 36, 255)

_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def clean(symbol: str) -> Optional[str]:
    s = (symbol or "").strip().upper().removesuffix(".PNG")
    return s if SYMBOL.match(s) else None


def _dir() -> Path:
    d = Path(get_settings().db_dir) / "logos"
    d.mkdir(parents=True, exist_ok=True)
    return d


def tile(raw: bytes) -> bytes:
    """Any logo image → a 64×64 PNG tile (see the module note)."""
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    alpha = im.getchannel("A")
    clear = sum(alpha.histogram()[:128]) / (im.width * im.height)
    if clear < 0.02:                                   # opaque: fill the tile
        out = im.resize((SIZE, SIZE), Image.LANCZOS)
        buf = io.BytesIO()
        out.save(buf, "PNG", optimize=True)
        return buf.getvalue()

    box = alpha.point(lambda a: 255 if a > 16 else 0).getbbox()
    if box:
        im = im.crop(box)
    # Light logo (mean luminance of its visible pixels) → dark tile.
    px = [p for p in im.getdata() if p[3] > 128]
    lum = sum(0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b, _ in px) / (255 * len(px)) if px else 0.0
    bg = DARK if lum > 0.82 else WHITE
    inner = SIZE - 2 * PAD
    im.thumbnail((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE), bg)
    out.alpha_composite(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2))
    buf = io.BytesIO()
    out.convert("RGB").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def _fetch(symbol: str) -> Optional[bytes]:
    r = httpx.get(SOURCE.format(symbol=symbol), timeout=15, follow_redirects=True,
                  headers={"User-Agent": "optionflow/1.0"})
    if r.status_code == 404 or not r.headers.get("content-type", "").startswith("image/"):
        return None
    r.raise_for_status()
    return tile(r.content)


def get(symbol: str, now: Optional[float] = None) -> Optional[bytes]:
    """The tile for a symbol, or None when there is no logo. Network errors serve a stale tile if one exists."""
    now = time.time() if now is None else now
    d = _dir()
    png, miss = d / f"{symbol}.png", d / f"{symbol}.none"
    if png.exists() and now - png.stat().st_mtime < KEEP:
        return png.read_bytes()
    if miss.exists() and now - miss.stat().st_mtime < MISS_TTL:
        return None
    with _guard:
        lock = _locks.setdefault(symbol, threading.Lock())
    with lock:                                         # one fetch per symbol at a time
        if png.exists() and now - png.stat().st_mtime < KEEP:
            return png.read_bytes()
        try:
            data = _fetch(symbol)
        except Exception as e:
            log.info("logo %s: fetch failed (%s)", symbol, e)
            return png.read_bytes() if png.exists() else None
        if data is None:
            miss.touch()
            png.unlink(missing_ok=True)
            return None
        png.write_bytes(data)
        miss.unlink(missing_ok=True)
        return data
