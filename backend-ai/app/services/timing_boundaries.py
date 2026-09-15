"""Shared temporal boundaries for transcript and presentation planning."""

from __future__ import annotations


# This is the existing degraded-pacing silence boundary. A gap below it is
# natural continuity; a gap at or above it is a meaningful presentation break.
SILENCE_BOUNDARY_MS = 2_000
