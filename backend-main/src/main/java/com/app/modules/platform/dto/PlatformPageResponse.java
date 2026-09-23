package com.app.modules.platform.dto;

import org.springframework.data.domain.Page;

import java.util.List;

/** Paginated envelope for Super Admin directory/audit lists. */
public record PlatformPageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages
) {
    public static <T> PlatformPageResponse<T> from(Page<T> page) {
        return new PlatformPageResponse<>(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages());
    }
}
