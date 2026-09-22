package com.app.modules.provider.util;

/**
 * Sniff TTS/audio payload magic bytes so storage keys and Content-Type match
 * the real container (some providers return WAV; OpenAI / ElevenLabs typically
 * return MP3). Ported from transflow's com.app.service.media.AudioContentDetector.
 */
public final class AudioContentDetector {

    public record Detected(String extension, String mimeType) {
    }

    private AudioContentDetector() {
    }

    public static Detected detect(byte[] bytes) {
        if (bytes == null || bytes.length < 4) {
            return new Detected("mp3", "audio/mpeg");
        }
        // RIFF....WAVE
        if (bytes.length >= 12
                && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
                && bytes[8] == 'W' && bytes[9] == 'A' && bytes[10] == 'V' && bytes[11] == 'E') {
            return new Detected("wav", "audio/wav");
        }
        // OggS
        if (bytes[0] == 'O' && bytes[1] == 'g' && bytes[2] == 'g' && bytes[3] == 'S') {
            return new Detected("ogg", "audio/ogg");
        }
        // ID3 tag or MPEG frame sync
        if ((bytes[0] == 'I' && bytes[1] == 'D' && bytes[2] == '3')
                || ((bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xE0) == 0xE0)) {
            return new Detected("mp3", "audio/mpeg");
        }
        // fLaC
        if (bytes[0] == 'f' && bytes[1] == 'L' && bytes[2] == 'a' && bytes[3] == 'C') {
            return new Detected("flac", "audio/flac");
        }
        // Default: OpenAI / ElevenLabs historical path stores as mp3
        return new Detected("mp3", "audio/mpeg");
    }
}
