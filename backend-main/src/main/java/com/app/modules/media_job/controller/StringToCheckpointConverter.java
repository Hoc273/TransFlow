package com.app.modules.media_job.controller;

import com.app.modules.media_job.entity.Checkpoint;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

@Component
public class StringToCheckpointConverter implements Converter<String, Checkpoint> {

    @Override
    public Checkpoint convert(String source) {
        return Checkpoint.fromString(source);
    }
}
