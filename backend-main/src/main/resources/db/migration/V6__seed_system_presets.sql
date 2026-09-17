-- V6: Seed platform default presets and public templates (SYSTEM scope)
-- SRS §5.7, Database_Design.md §9, API_Contract.md §9

INSERT INTO media_presets (
    id,
    scope,
    workspace_id,
    project_id,
    name,
    subtitle_style,
    voice_config,
    render_config,
    is_default,
    active
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'SYSTEM',
    NULL,
    NULL,
    'Standard Subtitle & Dub',
    '{"fontFamily":"Inter","fontSize":24,"textColor":"#FFFFFF","backgroundColor":"#00000080","subtitlePosition":"BOTTOM","verticalOffsetPercent":8}'::jsonb,
    '{"stability":0.75,"similarityBoost":0.85,"style":0.0}'::jsonb,
    '{"outputAspectRatio":"16:9","videoCodec":"libx264","audioCodec":"aac"}'::jsonb,
    true,
    true
), (
    '00000000-0000-0000-0000-000000000002',
    'SYSTEM',
    NULL,
    NULL,
    'Social Media Shorts / Reels',
    '{"fontFamily":"Roboto","fontSize":32,"textColor":"#FFD700","backgroundColor":"#000000CC","subtitlePosition":"CENTER","verticalOffsetPercent":0,"isBold":true}'::jsonb,
    '{"stability":0.70,"similarityBoost":0.80,"style":0.2}'::jsonb,
    '{"outputAspectRatio":"9:16","videoCodec":"libx264","audioCodec":"aac"}'::jsonb,
    false,
    true
), (
    '00000000-0000-0000-0000-000000000003',
    'SYSTEM',
    NULL,
    NULL,
    'Cinematic Subtitles',
    '{"fontFamily":"Outfit","fontSize":22,"textColor":"#F0F0F0","backgroundColor":"#1A1A1AB3","subtitlePosition":"BOTTOM","verticalOffsetPercent":5}'::jsonb,
    '{}'::jsonb,
    '{"outputAspectRatio":"21:9","videoCodec":"libx264","audioCodec":"aac"}'::jsonb,
    false,
    true
) ON CONFLICT (id) DO NOTHING;
