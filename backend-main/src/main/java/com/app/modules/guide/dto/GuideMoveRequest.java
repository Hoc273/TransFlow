package com.app.modules.guide.dto;

public record GuideMoveRequest(
        String direction,
        Integer orderIndex
) {}
