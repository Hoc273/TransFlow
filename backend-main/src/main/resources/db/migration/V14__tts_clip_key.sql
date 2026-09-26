-- V14: resumable TTS. tts_clip_key fingerprints the clip in tts_audio_ref (protocol, vendor voice,
-- target text). A TTS rerun reuses a clip only when the key still matches, so edited subtitles or a
-- changed voice are re-synthesized while untouched segments are neither re-generated nor re-billed.
ALTER TABLE subtitle_segments ADD COLUMN tts_clip_key VARCHAR(64);
-- Measured clip length, so a reused clip keeps its duration for AUDIO_MIX/RENDER placement.
ALTER TABLE subtitle_segments ADD COLUMN tts_duration_ms BIGINT;
