-- System presets become render-ready (Database_Design.md §9, API_Contract.md §9).
-- * No SYSTEM default any more: a job created without a preset keeps SOFT_SUB + the original frame.
-- * render_config uses the media_jobs.render_config keys; subtitle_style is a full SubtitleStyleSnapshot
--   (13 snake_case fields) so it can be copied into media_jobs.subtitle_style as-is.
-- * Subtitle line (BOTTOM base 88% of the frame height): Standard -8 => 80%, Shorts/Reels -13 => 75%
--   (higher, out of the Reels/TikTok bottom UI).
-- * Cinematic Subtitles is removed: its 21:9 frame is not supported by the media worker.

UPDATE media_presets SET
    is_default     = false,
    subtitle_style = '{"font_family":"Arial","font_size":44,"primary_color":"#FFFFFF","outline_color":"#000000","outline_width":0,"shadow":false,"bold":false,"italic":false,"alignment":"center","margin_v":0,"line_spacing":0,"background":"#00000080","opacity":100}'::jsonb,
    voice_config   = '{}'::jsonb,
    render_config  = '{"subtitleMode":"HARD_SUB","subtitlePosition":"BOTTOM","verticalOffsetPercent":-8,"backgroundBox":true,"backgroundColor":"#00000080","textColor":"#FFFFFF","outputAspectRatio":"16:9"}'::jsonb,
    updated_at     = now()
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE media_presets SET
    is_default     = false,
    subtitle_style = '{"font_family":"Arial","font_size":56,"primary_color":"#FFD700","outline_color":"#000000","outline_width":0,"shadow":false,"bold":true,"italic":false,"alignment":"center","margin_v":0,"line_spacing":0,"background":"#000000CC","opacity":100}'::jsonb,
    voice_config   = '{}'::jsonb,
    render_config  = '{"subtitleMode":"HARD_SUB","subtitlePosition":"BOTTOM","verticalOffsetPercent":-13,"backgroundBox":true,"backgroundColor":"#000000CC","textColor":"#FFD700","outputAspectRatio":"9:16"}'::jsonb,
    updated_at     = now()
WHERE id = '00000000-0000-0000-0000-000000000002';

-- Jobs keep their frozen preset_snapshot; only the FK reference is released before the delete.
UPDATE media_jobs SET preset_id = NULL WHERE preset_id = '00000000-0000-0000-0000-000000000003';
DELETE FROM media_presets WHERE id = '00000000-0000-0000-0000-000000000003';
