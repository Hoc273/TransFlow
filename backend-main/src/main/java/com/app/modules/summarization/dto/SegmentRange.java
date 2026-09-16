package com.app.modules.summarization.dto;

/** A user- or AI-picked video segment (startMs, endMs) — shared by request DTOs and the service layer. */
public record SegmentRange(long startMs, long endMs) {
}
