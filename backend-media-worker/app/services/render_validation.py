"""Render technical validation (Phase A2.2a — docs/93 v7, Q-M-TTS-15).

Runs inside the RENDER worker after ffmpeg produces the final video, before
upload. Emits a `RenderValidationReport`; `passed` is derived from the checks
(an ERROR check with FAIL status fails the render, WARNINGs never fail).

Field order of each check is standardized: id, severity, status, actual,
expected, tolerance, message (so A2.2b can persist the report into CER
consistently). `to_payload()` always emits all 7 fields; messages never
contain temp paths or ffprobe stderr.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, List, Optional, Protocol, Sequence, Tuple

from app.services.ffmpeg import FFmpegError, get_duration, get_stream_types
from app.services.media_probe import MediaProbeResult

logger = logging.getLogger(__name__)


class ValidationSeverity(Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"


class CheckStatus(Enum):
    PASS = "PASS"
    FAIL = "FAIL"


_CHECK_FIELDS = ("id", "severity", "status", "actual", "expected", "tolerance", "message")


@dataclass(frozen=True)
class ValidationCheck:
    id: str
    severity: ValidationSeverity
    status: CheckStatus
    actual: Any = None
    expected: Any = None
    tolerance: Any = None
    message: str = ""

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "severity": self.severity.value,
            "status": self.status.value,
            "actual": self.actual,
            "expected": self.expected,
            "tolerance": self.tolerance,
            "message": self.message,
        }


@dataclass(frozen=True)
class ValidationContext:
    video_path: str
    subtitle_path: Optional[str]
    subtitle_format: str
    subtitle_mode: str
    expected_duration_ms: int
    tolerance_ms: int
    tolerance_pct: float
    media_probe: Optional[MediaProbeResult] = None


@dataclass(frozen=True)
class RenderValidationReport:
    checks: Tuple[ValidationCheck, ...]
    metrics: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return all(
            check.severity is not ValidationSeverity.ERROR
            or check.status is not CheckStatus.FAIL
            for check in self.checks
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "checks": [check.to_payload() for check in self.checks],
            "metrics": dict(self.metrics),
        }


class RenderValidator(Protocol):
    def validate(self, ctx: ValidationContext) -> ValidationCheck:
        ...


class DurationValidator:
    check_id = "duration"

    def validate(self, ctx: ValidationContext) -> ValidationCheck:
        if ctx.media_probe is not None:
            actual_ms = ctx.media_probe.duration_ms
        else:
            try:
                actual_ms = int(round(get_duration(ctx.video_path) * 1000))
            except FFmpegError:
                return ValidationCheck(
                    self.check_id,
                    ValidationSeverity.ERROR,
                    CheckStatus.FAIL,
                    actual=None,
                    expected=ctx.expected_duration_ms,
                    message="could not probe output duration",
                )
        tolerance_ms = max(
            ctx.tolerance_ms,
            int(round(ctx.expected_duration_ms * ctx.tolerance_pct / 100.0)),
        )
        delta = abs(actual_ms - ctx.expected_duration_ms)
        if delta <= tolerance_ms:
            return ValidationCheck(
                self.check_id,
                ValidationSeverity.ERROR,
                CheckStatus.PASS,
                actual=actual_ms,
                expected=ctx.expected_duration_ms,
                tolerance=tolerance_ms,
            )
        return ValidationCheck(
            self.check_id,
            ValidationSeverity.ERROR,
            CheckStatus.FAIL,
            actual=actual_ms,
            expected=ctx.expected_duration_ms,
            tolerance=tolerance_ms,
            message=(
                f"duration mismatch: expected {ctx.expected_duration_ms} ms "
                f"actual {actual_ms} ms (tolerance {tolerance_ms} ms)"
            ),
        )


class AudioStreamValidator:
    check_id = "audio_stream"

    def validate(self, ctx: ValidationContext) -> ValidationCheck:
        if ctx.media_probe is not None:
            has_audio = ctx.media_probe.audio is not None
        else:
            try:
                has_audio = "audio" in get_stream_types(ctx.video_path)
            except FFmpegError:
                return ValidationCheck(
                    self.check_id,
                    ValidationSeverity.ERROR,
                    CheckStatus.FAIL,
                    actual=None,
                    expected="audio stream",
                    message="could not probe output streams",
                )
        if has_audio:
            return ValidationCheck(
                self.check_id,
                ValidationSeverity.ERROR,
                CheckStatus.PASS,
                actual="present",
                expected="audio stream",
            )
        return ValidationCheck(
            self.check_id,
            ValidationSeverity.ERROR,
            CheckStatus.FAIL,
            actual="missing",
            expected="audio stream",
            message="output has no audio stream",
        )


class VideoStreamValidator:
    check_id = "video_stream"

    def validate(self, ctx: ValidationContext) -> ValidationCheck:
        if ctx.media_probe is not None:
            has_video = ctx.media_probe.video is not None
        else:
            try:
                has_video = "video" in get_stream_types(ctx.video_path)
            except FFmpegError:
                return ValidationCheck(
                    self.check_id,
                    ValidationSeverity.ERROR,
                    CheckStatus.FAIL,
                    actual=None,
                    expected="video stream",
                    message="could not probe output streams",
                )
        if has_video:
            return ValidationCheck(
                self.check_id,
                ValidationSeverity.ERROR,
                CheckStatus.PASS,
                actual="present",
                expected="video stream",
            )
        return ValidationCheck(
            self.check_id,
            ValidationSeverity.ERROR,
            CheckStatus.FAIL,
            actual="missing",
            expected="video stream",
            message="output has no video stream",
        )


def count_subtitle_cues(path: Optional[str], subtitle_format: str) -> int:
    """Count cues in the source subtitle file, format-aware.

    ASS has no timing-cue lines: count `Dialogue:` rows. SRT/VTT count timing
    lines (`-->`). The worker's `final.srt` is not a valid SRT when the input
    was ASS, so the source file is always counted, never the converted sidecar.
    """
    if not path or not os.path.exists(path):
        return 0
    fmt = (subtitle_format or "").lower().strip()
    count = 0
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                stripped = line.lstrip()
                if fmt == "ass":
                    if stripped.startswith("Dialogue:"):
                        count += 1
                elif "-->" in line:
                    count += 1
    except OSError:
        return 0
    return count


class SubtitleStreamValidator:
    check_id = "subtitle_stream"

    def validate(self, ctx: ValidationContext) -> ValidationCheck:
        mode = (ctx.subtitle_mode or "SOFT_SUB").upper()
        if mode == "SOFT_SUB":
            if ctx.media_probe is not None:
                has_subtitle = bool(ctx.media_probe.subtitle_streams)
            else:
                try:
                    has_subtitle = "subtitle" in get_stream_types(ctx.video_path)
                except FFmpegError:
                    return ValidationCheck(
                        self.check_id,
                        ValidationSeverity.ERROR,
                        CheckStatus.FAIL,
                        actual=None,
                        expected="subtitle stream",
                        message="could not probe output streams",
                    )
            if has_subtitle:
                return ValidationCheck(
                    self.check_id,
                    ValidationSeverity.ERROR,
                    CheckStatus.PASS,
                    actual="present",
                    expected="subtitle stream",
                )
            return ValidationCheck(
                self.check_id,
                ValidationSeverity.ERROR,
                CheckStatus.FAIL,
                actual="missing",
                expected="subtitle stream",
                message="output has no subtitle stream (soft-sub)",
            )

        # HARD_SUB: burned-in subtitles are not probeable; verify the source
        # subtitle actually contains cues so the burn was not a no-op.
        cue_count = count_subtitle_cues(ctx.subtitle_path, ctx.subtitle_format)
        if cue_count > 0:
            return ValidationCheck(
                self.check_id,
                ValidationSeverity.WARNING,
                CheckStatus.PASS,
                actual=cue_count,
                expected=">=1 cue",
            )
        return ValidationCheck(
            self.check_id,
            ValidationSeverity.WARNING,
            CheckStatus.FAIL,
            actual=0,
            expected=">=1 cue",
            message="subtitle source has no cues; hard-sub output may lack subtitles",
        )


def default_validators() -> List[RenderValidator]:
    return [
        DurationValidator(),
        AudioStreamValidator(),
        VideoStreamValidator(),
        SubtitleStreamValidator(),
    ]


def first_error_check(report: RenderValidationReport) -> Optional[ValidationCheck]:
    """First ERROR+FAIL check; its sanitized message feeds the callback error."""
    for check in report.checks:
        if check.severity is ValidationSeverity.ERROR and check.status is CheckStatus.FAIL:
            return check
    return None


class RenderValidationRunner:
    def __init__(self, validators: Optional[Sequence[RenderValidator]] = None) -> None:
        self._validators: List[RenderValidator] = list(
            validators if validators is not None else default_validators()
        )

    def run(self, ctx: ValidationContext) -> RenderValidationReport:
        checks = tuple(validator.validate(ctx) for validator in self._validators)
        metrics: dict[str, Any] = {"expected_duration_ms": ctx.expected_duration_ms}
        for check in checks:
            if check.id == DurationValidator.check_id and isinstance(check.actual, int):
                metrics["actual_duration_ms"] = check.actual
        return RenderValidationReport(checks=checks, metrics=metrics)
