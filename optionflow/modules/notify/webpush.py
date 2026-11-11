"""optionflow/modules/notify/webpush.py — Web Push without extra dependencies.

Implements the two standards a push service needs, with `cryptography` (already a dependency):
- RFC 8291 message encryption ("aes128gcm" content coding, RFC 8188), one record.
- RFC 8292 VAPID: an ES256 JWT for the push service's origin, signed with the server's P-256 key.

Keys are base64url (no padding), the format browsers and every Web Push library use:
- private key: the 32-byte P-256 scalar; public key: the 65-byte uncompressed point.
"""
from __future__ import annotations

import base64
import json
import os
import struct
import time
from dataclasses import dataclass
from typing import Optional, Tuple
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

RECORD_SIZE = 4096


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def encrypt(plaintext: bytes, ua_public: bytes, auth_secret: bytes, *,
            as_private: Optional[ec.EllipticCurvePrivateKey] = None, salt: Optional[bytes] = None) -> bytes:
    """RFC 8291 §3: the body to POST to the push endpoint. `as_private` / `salt` are only fixed in tests."""
    as_private = as_private or ec.generate_private_key(ec.SECP256R1())
    salt = salt or os.urandom(16)
    as_public = _public_bytes(as_private.public_key())
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    ecdh = as_private.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, ecdh, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    record = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)          # 0x02 = last record, no padding
    return salt + struct.pack("!IB", RECORD_SIZE, len(as_public)) + as_public + record


def decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth_secret: bytes) -> bytes:
    """The browser's side, for tests: undo `encrypt`."""
    salt, rs, idlen = body[:16], *struct.unpack("!IB", body[16:21])
    as_public = body[21:21 + idlen]
    ua_public = _public_bytes(ua_private.public_key())
    ecdh = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    ikm = _hkdf(auth_secret, ecdh, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    out = AESGCM(cek).decrypt(nonce, body[21 + idlen:], None)
    return out[:out.rindex(b"\x02")]


# ── VAPID ─────────────────────────────────────────────────────────────────────
def private_key_from_b64(raw: str) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(unb64u(raw), "big"), ec.SECP256R1())


def public_key_b64(priv: ec.EllipticCurvePrivateKey) -> str:
    return b64u(_public_bytes(priv.public_key()))


def generate_keys() -> Tuple[str, str]:
    """(private, public) base64url, for PUSH_VAPID_PRIVATE_KEY / PUSH_VAPID_PUBLIC_KEY."""
    priv = ec.generate_private_key(ec.SECP256R1())
    return b64u(priv.private_numbers().private_value.to_bytes(32, "big")), public_key_b64(priv)


def vapid_header(endpoint: str, priv: ec.EllipticCurvePrivateKey, contact: str, ttl_s: int = 12 * 3600) -> str:
    u = urlparse(endpoint)
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64u(json.dumps({"aud": f"{u.scheme}://{u.netloc}", "exp": int(time.time()) + ttl_s, "sub": contact},
                             separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    r, s = decode_dss_signature(priv.sign(signing_input, ec.ECDSA(hashes.SHA256())))
    token = f"{header}.{claims}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
    return f"vapid t={token}, k={public_key_b64(priv)}"


@dataclass
class SendResult:
    status: int
    gone: bool                      # 404 / 410: the subscription is dead, delete it


def send(endpoint: str, p256dh: str, auth: str, payload: dict, priv: ec.EllipticCurvePrivateKey, contact: str,
         ttl: int = 3600, urgency: str = "high", client: Optional[httpx.Client] = None) -> SendResult:
    body = encrypt(json.dumps(payload, separators=(",", ":")).encode(), unb64u(p256dh), unb64u(auth))
    headers = {"Authorization": vapid_header(endpoint, priv, contact), "Content-Encoding": "aes128gcm",
               "Content-Type": "application/octet-stream", "TTL": str(ttl), "Urgency": urgency}
    c = client or httpx.Client(timeout=10)
    try:
        r = c.post(endpoint, content=body, headers=headers)
    finally:
        if client is None:
            c.close()
    return SendResult(r.status_code, r.status_code in (404, 410))


if __name__ == "__main__":                 # python -m optionflow.modules.notify.webpush  → new key pair
    priv_b64, pub_b64 = generate_keys()
    print(f"PUSH_VAPID_PRIVATE_KEY={priv_b64}\nPUSH_VAPID_PUBLIC_KEY={pub_b64}")
