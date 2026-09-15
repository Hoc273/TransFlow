package com.app.modules.media_asset.service;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertNull;

class VideoDurationProbeTest {

    private final VideoDurationProbe probe = new VideoDurationProbe();

    @Test
    void extractDurationMs_fileDoesNotExist_returnsNullInsteadOfThrowing() {
        Assumptions.assumeTrue(ffprobeAvailable(), "ffprobe not installed on this machine — skipping");

        Long duration = probe.extractDurationMs(Path.of("this-file-does-not-exist.mp4"));

        assertNull(duration);
    }

    private static boolean ffprobeAvailable() {
        try {
            Process p = new ProcessBuilder("ffprobe", "-version").start();
            return p.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }
}
