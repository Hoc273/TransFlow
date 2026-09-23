import hashlib
import hmac

from app.core.config import settings


def sign_payload(timestamp: str, raw_body: bytes) -> str:
    """Sign the canonical ``<timestamp>.<rawBody>`` callback payload."""
    secret = settings.callback_secret.encode("utf-8")
    payload = timestamp.encode("utf-8") + b"." + raw_body
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def sign_request(raw_body: bytes) -> tuple[str, str]:
    timestamp = str(int(__import__("time").time()))
    return timestamp, sign_payload(timestamp, raw_body)
