-- V15: TTS voice catalogs with N voices per language (Azure: 780 voices, up to 348 per language).
-- display_name keeps the vendor's readable name ("Hoài My") instead of the raw id; status lets the
-- catalog rank GA voices before PREVIEW ones. DEPRECATED voices are stored inactive, never deleted
-- (jobs may still reference them). NULL status = vendor does not publish one, treated as GA.
ALTER TABLE tts_voices ADD COLUMN display_name VARCHAR(200);
ALTER TABLE tts_voices ADD COLUMN status VARCHAR(20)
    CONSTRAINT ck_tts_voice_status CHECK (status IN ('GA','PREVIEW','DEPRECATED'));
