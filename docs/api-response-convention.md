# Quy ước ApiResponse & Xử lý lỗi (Spring Boot Monolith)

Chuẩn chung, không gắn với domain/module cụ thể — áp dụng được cho bất kỳ project monolith nào.

## 1. Cấu trúc package

```
com.company.project
├── common
│   ├── dto
│   │   └── ApiResponse.java
│   └── exception
│       ├── ErrorCode.java
│       ├── AppException.java
│       └── GlobalExceptionHandler.java
├── moduleA/...
├── moduleB/...
└── ...
```

Nguyên tắc: response envelope, mã lỗi, exception nền và handler nằm **duy nhất một nơi** (`common`), mọi module chỉ import và dùng lại — không tự định nghĩa response/exception riêng.

## 2. `ApiResponse<T>` — response envelope chuẩn

```java
package com.company.project.common.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.*;
import lombok.experimental.FieldDefaults;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@FieldDefaults(level = AccessLevel.PRIVATE)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {
    @Builder.Default
    Integer code = 1000; // mặc định = thành công

    String message;
    T data;
}
```

- `code = 1000` (hoặc bất kỳ hằng số nào bạn chọn) là mã "SUCCESS" mặc định, controller thành công không cần set.
- `@JsonInclude(NON_NULL)`: field null (thường `message` khi OK, `data` khi lỗi) không xuất hiện trong JSON.
- Mọi controller trả `ApiResponse<T>`, không trả entity/DTO trần.

## 3. `ErrorCode` — enum mã lỗi tập trung

```java
package com.company.project.common.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public enum ErrorCode {
    SUCCESS(1000, "Success", HttpStatus.OK),

    // 9xxx - lỗi hệ thống / dùng chung
    UNCATEGORIZED_EXCEPTION(9999, "Internal server error", HttpStatus.INTERNAL_SERVER_ERROR),
    INVALID_KEY(9998, "Invalid request parameter", HttpStatus.BAD_REQUEST),
    UNAUTHENTICATED(9997, "Unauthenticated", HttpStatus.UNAUTHORIZED),
    UNAUTHORIZED(9996, "You do not have permission to perform this action", HttpStatus.FORBIDDEN),
    RESOURCE_NOT_FOUND(9995, "Resource not found", HttpStatus.NOT_FOUND),

    // 1xxx, 2xxx, 3xxx, ... - mỗi module một dải, tự bổ sung mã lỗi riêng khi cần
    ;

    private final Integer code;
    private final String message;
    private final HttpStatus httpStatusCode;

    ErrorCode(Integer code, String message, HttpStatus httpStatus) {
        this.code = code;
        this.message = message;
        this.httpStatusCode = httpStatus;
    }
}
```

Quy ước chung: dành 1 dải số (ví dụ mỗi module 1000 mã: 1000–1999, 2000–2999, ...) để tránh trùng khi nhiều module cùng thêm ErrorCode song song.

## 4. `AppException` — exception nghiệp vụ dùng chung

```java
package com.company.project.common.exception;

import lombok.Getter;

@Getter
public class AppException extends RuntimeException {
    private final ErrorCode errorCode;

    public AppException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }
}
```

Service layer ném lỗi bằng: `throw new AppException(ErrorCode.RESOURCE_NOT_FOUND);`
Chỉ tạo exception riêng (kế thừa `AppException` hoặc `RuntimeException`) khi thực sự cần mang thêm dữ liệu/logic xử lý khác nhau — không tạo 1 exception class cho mỗi module theo mặc định.

## 5. `GlobalExceptionHandler` — một handler duy nhất cho toàn app

```java
package com.company.project.common.exception;

import com.company.project.common.dto.ApiResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.LinkedHashMap;
import java.util.Map;

@Slf4j
@ControllerAdvice
public class GlobalExceptionHandler {

    // Bean Validation (@Valid) — trả lỗi theo từng field
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiResponse<Map<String, String>>> handleValidation(MethodArgumentNotValidException e) {
        Map<String, String> errors = new LinkedHashMap<>();
        e.getBindingResult().getFieldErrors().forEach(fe ->
                errors.putIfAbsent(fe.getField(), fe.getDefaultMessage()));

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
                ApiResponse.<Map<String, String>>builder()
                        .code(ErrorCode.INVALID_KEY.getCode())
                        .data(errors)
                        .build());
    }

    // Lỗi nghiệp vụ — mọi module ném AppException đều rơi vào đây
    @ExceptionHandler(AppException.class)
    ResponseEntity<ApiResponse<?>> handleAppException(AppException e) {
        ErrorCode errorCode = e.getErrorCode();
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }

    // Spring Security — 403
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiResponse<?>> handleAccessDenied(AccessDeniedException e) {
        ErrorCode errorCode = ErrorCode.UNAUTHORIZED;
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }

    // Fallback — bắt mọi lỗi không lường trước, không lộ stacktrace ra ngoài
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponse<?>> handleException(Exception e) {
        log.error("Unhandled exception", e);
        ErrorCode errorCode = ErrorCode.UNCATEGORIZED_EXCEPTION;
        return ResponseEntity.status(errorCode.getHttpStatusCode()).body(
                ApiResponse.builder()
                        .code(errorCode.getCode())
                        .message(errorCode.getMessage())
                        .build());
    }
}
```

## 6. Cách dùng trong Controller

```java
@GetMapping("/{id}")
public ApiResponse<ItemResponse> getItem(@PathVariable Long id) {
    return ApiResponse.<ItemResponse>builder()
            .data(itemService.getById(id))
            .build();
}
```

Nguyên tắc:
- Không set `code` khi thành công → dùng mặc định.
- Controller không try/catch — ném exception, để `GlobalExceptionHandler` xử lý tập trung, tránh lặp code xử lý lỗi ở từng endpoint.

## 7. Format response

Thành công:
```json
{ "code": 1000, "data": { } }
```

Lỗi nghiệp vụ:
```json
{ "code": 9995, "message": "Resource not found" }
```

Lỗi validate:
```json
{ "code": 9998, "data": { "email": "must be a valid email" } }
```

## 8. Nguyên tắc tổng quát (áp dụng mọi project)

1. **1 response envelope, 1 error-code enum, 1 exception handler** cho toàn bộ monolith — không nhân bản theo module.
2. Mỗi module tự thêm `ErrorCode` trong dải số được cấp phát riêng, không định nghĩa response/exception cục bộ.
3. Message trong `ErrorCode` là message hiển thị cho client; log chi tiết (stacktrace) chỉ ghi ở server (`log.error`), không trả về client.
4. Không dùng exception mặc định của framework (`IllegalArgumentException`, `NullPointerException`...) để báo lỗi nghiệp vụ — luôn bọc qua `AppException(ErrorCode)` để controller/handler xử lý đồng nhất.
