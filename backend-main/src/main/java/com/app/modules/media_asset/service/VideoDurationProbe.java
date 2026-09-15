package com.app.modules.media_asset.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

/**
 * Extracts video duration (ms) via ffprobe. Returns null when ffprobe is
 * unavailable or cannot parse the file — caller decides how to react.
 */
@Slf4j
@Component
public class VideoDurationProbe {

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
