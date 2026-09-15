package com.app.common.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.FieldDefaults;

/**
 * Response envelope bắt buộc cho mọi endpoint của {@code backend-main}.
 * Quy ước đầy đủ: docs/api-response-convention.md, API_Contract.md §0/§15.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@FieldDefaults(level = AccessLevel.PRIVATE)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {

    @Builder.Default
    Integer code = 1000; // ErrorCode.SUCCESS

    String message;
    T data;
}
