-- model_overrides nhận thêm khoá capability (TRANSLATE | STT | TTS | VISION): một key phục vụ nhiều
-- capability chọn model thao tác → capability → default_model.
-- Key OpenAI cũ tick STT/TTS nhưng default_model là model chat (vd seed gpt-4o-mini) gửi model đó cho
-- /audio/transcriptions và /audio/speech nên luôn lỗi: điền model STT/TTS chuẩn khi còn thiếu.
UPDATE platform_ai_providers
SET model_overrides = model_overrides || '{"STT": "whisper-1"}'::jsonb
WHERE protocol = 'openai_compatible'
  AND base_url ILIKE '%api.openai.com%'
  AND 'STT' = ANY (capabilities)
  AND NOT model_overrides ? 'STT'
  AND default_model NOT ILIKE '%whisper%'
  AND default_model NOT ILIKE '%transcribe%';

UPDATE platform_ai_providers
SET model_overrides = model_overrides || '{"TTS": "tts-1"}'::jsonb
WHERE protocol = 'openai_compatible'
  AND base_url ILIKE '%api.openai.com%'
  AND 'TTS' = ANY (capabilities)
  AND NOT model_overrides ? 'TTS'
  AND default_model NOT ILIKE 'tts-%'
  AND default_model NOT ILIKE '%-tts%';
