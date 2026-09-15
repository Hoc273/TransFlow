"""Build-time downloader for the bundled Piper voices (ADR-CEP Phase A1.2).

Runs during ``docker build`` (COPY + RUN placed before ``COPY app`` for layer
caching) and locally via ``python piper/download_voices.py [target_dir]``.
It is **never** invoked at runtime — Piper synthesis fails fast if a model
is missing instead of downloading on demand.

Downloads the 6 MIT-licensed rhasspy/piper-voices v1.0.0 models referenced by
the Spring Boot V32 system-assets seed (asset_key ↔ model stem mapping in
``app/services/protocol/static_voices.py``). The script is stdlib-only
(urllib) so the build stage needs no extra tooling, and it fails loudly on
truncated or malformed downloads so a broken image never ships.

⚡ AMENDED 2026-08-02 (A1.2 review): the 7 fictional vi voices were removed —
they do not exist in the official repo. Every model below was verified
against piper ``voices.json`` + VOICES.md + MODEL_CARD. URL layout matches the
real repo structure ``{family}/{locale}/{voice_dir}/{quality}/{stem}.onnx``
(``?download=true`` is not required on ``/resolve/`` links).

Checksum pinning is a follow-up hardening option; today the download is
verified by Content-Length equality, a minimum-size gate, and JSON
parseability of the piper config.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

RELEASE = "v1.0.0"
BASE = f"https://huggingface.co/rhasspy/piper-voices/resolve/{RELEASE}"

# (family dir, locale dir, voice dir, quality dir, model stem) — mirrors
# PIPER_VOICE_MODELS and the V32 seed. All verified present upstream.
MODELS: list[tuple[str, str, str, str, str]] = [
    ("vi", "vi_VN", "vais1000", "medium", "vi_VN-vais1000-medium"),
    ("vi", "vi_VN", "25hours_single", "low", "vi_VN-25hours_single-low"),
    ("vi", "vi_VN", "vivos", "x_low", "vi_VN-vivos-x_low"),
    ("en", "en_US", "amy", "medium", "en_US-amy-medium"),
    ("en", "en_US", "joe", "medium", "en_US-joe-medium"),
    ("en", "en_GB", "alan", "medium", "en_GB-alan-medium"),
]

ONNX_MIN_BYTES = 1_000_000
CONFIG_MIN_BYTES = 200


def download(url: str, dest: Path, min_bytes: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "transflow-build/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, open(dest, "wb") as out:
        expected = int(response.headers.get("Content-Length") or 0)
        received = 0
        while True:
            chunk = response.read(1 << 16)
            if not chunk:
                break
            out.write(chunk)
            received += len(chunk)
    if received < min_bytes:
        raise SystemExit(
            f"FAIL: {dest.name} too small ({received} bytes < {min_bytes}) — aborting build"
        )
    if expected and received != expected:
        raise SystemExit(
            f"FAIL: {dest.name} truncated ({received}/{expected} bytes) — aborting build"
        )


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("piper/voices")
    for family, locale, voice_dir, quality, stem in MODELS:
        base = f"{BASE}/{family}/{locale}/{voice_dir}/{quality}/{stem}"
        onnx = target / f"{stem}.onnx"
        config = target / f"{stem}.onnx.json"
        if onnx.is_file() and config.is_file():
            print(f"skip  {stem} (already present)")
            continue
        print(f"fetch {stem}")
        download(f"{base}.onnx", onnx, min_bytes=ONNX_MIN_BYTES)
        download(f"{base}.onnx.json", config, min_bytes=CONFIG_MIN_BYTES)
        try:
            parsed = json.loads(config.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"FAIL: {config.name} is not valid JSON ({exc}) — aborting build")
        if not isinstance(parsed, dict) or "espeak" not in parsed:
            raise SystemExit(f"FAIL: {config.name} is not a piper voice config — aborting build")
        print(f"ok    {stem} ({onnx.stat().st_size} bytes)")
    print(f"Done: {len(MODELS)} models in {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
