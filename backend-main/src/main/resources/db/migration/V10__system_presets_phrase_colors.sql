-- Both system presets (Database_Design.md §9): black text on a light-yellow box with a thin white outline (4,
-- authored for a 1080-line frame) and cues grouped into 5-word phrases (presentation.subtitle.displayMode).
UPDATE media_presets SET
    subtitle_style = '{"font_family":"Arial","font_size":44,"primary_color":"#000000","outline_color":"#FFFFFF","outline_width":4,"shadow":false,"bold":false,"italic":false,"alignment":"center","margin_v":0,"line_spacing":0,"background":"#FFF59DE6","opacity":100}'::jsonb,
    render_config  = '{"subtitleMode":"HARD_SUB","subtitlePosition":"BOTTOM","verticalOffsetPercent":-8,"backgroundBox":true,"backgroundColor":"#FFF59DE6","textColor":"#000000","outputAspectRatio":"16:9","presentation":{"subtitle":{"displayMode":"PHRASE","wordsPerPhrase":5}}}'::jsonb,
    updated_at     = now()
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE media_presets SET
    subtitle_style = '{"font_family":"Arial","font_size":40,"primary_color":"#000000","outline_color":"#FFFFFF","outline_width":4,"shadow":false,"bold":true,"italic":false,"alignment":"center","margin_v":0,"line_spacing":0,"background":"#FFF59DE6","opacity":100}'::jsonb,
    render_config  = '{"subtitleMode":"HARD_SUB","subtitlePosition":"BOTTOM","verticalOffsetPercent":-13,"backgroundBox":true,"backgroundColor":"#FFF59DE6","textColor":"#000000","outputAspectRatio":"9:16","presentation":{"subtitle":{"displayMode":"PHRASE","wordsPerPhrase":5}}}'::jsonb,
    updated_at     = now()
WHERE id = '00000000-0000-0000-0000-000000000002';
