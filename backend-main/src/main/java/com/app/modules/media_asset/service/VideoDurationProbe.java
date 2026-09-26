package com.app.modules.media_asset.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

/**
 * Extracts video duration (ms) via ffprobe. Returns null when ffprobe is
 * unavailable or cannot parse the file — caller decides how to react
 * ({@link #isAvailable()} tells the two apart).
 */
@Slf4j
@Component
public class VideoDurationProbe {

    private volatile Boolean available;

    /** Whether ffprobe can be executed on this host (checked once, then cached). */
    public boolean isAvailable() {
        Boolean a = available;
        if (a == null) {
            a = checkAvailable();
            available = a;
            if (!a) {
                log.warn("ffprobe not found — uploaded videos are NOT content-checked and the 30-minute limit "
                        + "is not enforced. Install ffmpeg on the backend-main host.");
            }
        }
        return a;
    }

    private static boolean checkAvailable() {
        try {
            Process p = new ProcessBuilder("ffprobe", "-version").redirectErrorStream(true).start();
            p.getInputStream().transferTo(java.io.OutputStream.nullOutputStream());
            return p.waitFor(10, TimeUnit.SECONDS) && p.exitValue() == 0;
        } catch (Exception ex) {
            return false;
        }
    }

    public Long extractDurationMs(Path file) {
        try {
            ProcessBuilder pb = new ProcessBuilder(
                    "ffprobe",
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    file.toAbsolutePath().toString()
            );
            pb.redirectErrorStream(true);
            Process process = pb.start();

            String output;
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                output = reader.readLine();
            }

            boolean finished = process.waitFor(10, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                log.warn("ffprobe timed out for file {}", file);
                return null;
            }

            if (process.exitValue() != 0 || output == null || output.isBlank()) {
                log.warn("ffprobe could not determine duration for file {} (exit={})", file, process.exitValue());
                return null;
            }

            double seconds = Double.parseDouble(output.trim());
            return Math.round(seconds * 1000);
        } catch (Exception ex) {
            log.warn("Failed to extract video duration from {}: {}", file, ex.toString());
            return null;
        }
    }
}
