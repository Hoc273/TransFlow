package com.app.modules.media_job.util;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class StageOutputRefsTest {

    @Test
    void objectOutput_returnsObjectRefOnly() {
        assertEquals("transflow-media/rendered/j1/x.mp4", StageOutputRefs.storageRef(
                "{\"objectRef\":\"transflow-media/rendered/j1/x.mp4\",\"mediaProbe\":{\"durationMs\":97250}}"));
    }

    @Test
    void transcriptOutput_withoutObjectRef_isNotExposed() {
        assertNull(StageOutputRefs.storageRef("{\"segments\":[{\"text\":\"hello\"}],\"language\":\"en\"}"));
    }

    @Test
    void jsonText_returnsItsTextValue() {
        assertEquals("transflow-media/rendered/j1/x.mp4",
                StageOutputRefs.storageRef("\"transflow-media/rendered/j1/x.mp4\""));
    }

    @Test
    void nullAndEmptyValues_returnNull() {
        assertNull(StageOutputRefs.storageRef(null));
        assertNull(StageOutputRefs.storageRef(""));
        assertNull(StageOutputRefs.storageRef("  "));
    }

    @Test
    void rawBucketKey_isAccepted() {
        assertEquals("transflow-media/rendered/j1/x.mp4",
                StageOutputRefs.storageRef("transflow-media/rendered/j1/x.mp4"));
    }

    @Test
    void unparseableGarbage_isNotExposed() {
        assertNull(StageOutputRefs.storageRef("not a storage ref"));
        assertNull(StageOutputRefs.storageRef("not/a storage ref"));
        assertNull(StageOutputRefs.storageRef("{broken/path"));
    }
}
