"""Extractor_Service settings, read from the environment at call time."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass

DEFAULT_PROVIDER = "gemini"
DEFAULT_MODEL = {"gemini": "gemini-2.5-flash", "anthropic": "claude-haiku-5-5"}
DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_PDF_PAGES = 100
DEFAULT_MODEL_TIMEOUT_S = 90.0
DEFAULT_CHUNK_CHARS = 12_000
DEFAULT_MAX_CONCURRENCY = 4
DEFAULT_MAX_BATCH = 25


@dataclass(frozen=True)
class Settings:
    provider: str  # EXTRACTOR_PROVIDER, "gemini" (default) or "anthropic"; unknown values kept as given
    gemini_api_key: str  # GEMINI_API_KEY
    anthropic_api_key: str  # ANTHROPIC_API_KEY
    extractor_api_key: str  # EXTRACTOR_API_KEY
    model: str  # EXTRACTOR_MODEL, default depends on the provider when empty
    max_upload_bytes: int  # EXTRACTOR_MAX_UPLOAD_BYTES, default 25 MB
    max_pdf_pages: int  # EXTRACTOR_MAX_PDF_PAGES, default 100
    cors_origins: tuple[str, ...]  # EXTRACTOR_CORS_ORIGINS, comma list, default ()
    model_timeout_s: float  # EXTRACTOR_MODEL_TIMEOUT_S, default 90
    chunk_chars: int  # EXTRACTOR_CHUNK_CHARS, default 12_000
    max_concurrency: int  # EXTRACTOR_MAX_CONCURRENCY, default 4
    max_batch: int  # EXTRACTOR_MAX_BATCH, default 25


def _text(name: str) -> str:
    return os.environ.get(name, "").strip()


def _positive_int(name: str, default: int) -> int:
    """Read a positive integer; an empty, malformed or non-positive value gives the default."""
    raw = _text(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_float(name: str, default: float) -> float:
    """Read a positive finite number; an empty, malformed or non-positive value gives the default."""
    raw = _text(name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if math.isfinite(value) and value > 0 else default


def _origins(name: str) -> tuple[str, ...]:
    """Split a comma list, dropping blanks and duplicates while keeping order."""
    seen: dict[str, None] = {}
    for part in _text(name).split(","):
        origin = part.strip()
        if origin:
            seen.setdefault(origin, None)
    return tuple(seen)


def get_settings() -> Settings:
    """Build Settings from ``os.environ``. Reads the environment on every call."""
    provider = _text("EXTRACTOR_PROVIDER").lower() or DEFAULT_PROVIDER
    return Settings(
        provider=provider,
        gemini_api_key=_text("GEMINI_API_KEY"),
        anthropic_api_key=_text("ANTHROPIC_API_KEY"),
        extractor_api_key=_text("EXTRACTOR_API_KEY"),
        model=_text("EXTRACTOR_MODEL") or DEFAULT_MODEL.get(provider, DEFAULT_MODEL[DEFAULT_PROVIDER]),
        max_upload_bytes=_positive_int("EXTRACTOR_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES),
        max_pdf_pages=_positive_int("EXTRACTOR_MAX_PDF_PAGES", DEFAULT_MAX_PDF_PAGES),
        cors_origins=_origins("EXTRACTOR_CORS_ORIGINS"),
        model_timeout_s=_positive_float("EXTRACTOR_MODEL_TIMEOUT_S", DEFAULT_MODEL_TIMEOUT_S),
        chunk_chars=_positive_int("EXTRACTOR_CHUNK_CHARS", DEFAULT_CHUNK_CHARS),
        max_concurrency=_positive_int("EXTRACTOR_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY),
        max_batch=_positive_int("EXTRACTOR_MAX_BATCH", DEFAULT_MAX_BATCH),
    )
