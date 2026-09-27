package com.app.modules.media_job.dto;

import com.app.modules.media_job.entity.MediaJobStage;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class MediaJobStageResponseTest {

    @Test
    void renderStage_exposesParsedStorageRef() {
        MediaJobStage stage = new MediaJobStage();
        stage.setStageName(MediaJobStage.StageName.RENDER);
        stage.setStatus(MediaJobStage.StageStatus.COMPLETED);
        stage.setOutputRef("{\"objectRef\":\"transflow-media/rendered/ba1cded9-d8cf-4202-a23e-5ba16f7cf8b9/x.mp4\","
                + "\"mediaProbe\":{\"durationMs\":97250}}");

        assertEquals("transflow-media/rendered/ba1cded9-d8cf-4202-a23e-5ba16f7cf8b9/x.mp4",
                MediaJobStageResponse.from(stage).outputRef());
    }

    @Test
    void sttStage_doesNotExposeTranscriptOutput() {
        MediaJobStage stage = new MediaJobStage();
        stage.setStageName(MediaJobStage.StageName.STT);
        stage.setStatus(MediaJobStage.StageStatus.COMPLETED);
        stage.setOutputRef("{\"segments\":[{\"text\":\"hello\"}],\"language\":\"en\"}");

        assertNull(MediaJobStageResponse.from(stage).outputRef());
    }
}
