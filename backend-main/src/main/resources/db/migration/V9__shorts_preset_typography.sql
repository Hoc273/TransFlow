-- Social Media Shorts / Reels: smaller text + thin white outline (Database_Design.md §9).
-- font_size / outline_width are authored for a 1080-line frame; the media worker scales them to the real
-- output height (a 720p 16:9 source reframed to 9:16 is 404x720 => 40 -> 27px, outline 4 -> 3px).
UPDATE media_presets SET
    subtitle_style = '{"font_family":"Arial","font_size":40,"primary_color":"#FFD700","outline_color":"#FFFFFF","outline_width":4,"shadow":false,"bold":true,"italic":false,"alignment":"center","margin_v":0,"line_spacing":0,"background":"#000000CC","opacity":100}'::jsonb,
    updated_at     = now()
WHERE id = '00000000-0000-0000-0000-000000000002';
