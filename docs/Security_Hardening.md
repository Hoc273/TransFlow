# Security Hardening — TransFlow

Checklist 20 hạng mục bảo mật: trạng thái trong repo, file thực thi, và những gì còn phải làm khi deploy.
Chi tiết hợp đồng API (cookie refresh, mã lỗi mới) nằm ở `API_Contract.md` §1 và §15.

## Bảng trạng thái

| # | Hạng mục | Trạng thái | Nơi thực thi |
|---|---|---|---|
| 1 | Ẩn API key | ✅ | BYOK mã hoá AES-GCM (`CryptoService`); không log/trả key. `SecretsStartupValidator` chặn khởi động với secret mặc định khi `STRICT_SECRETS=true`. |
| 2 | Xoá git secrets | ✅ | Đã quét toàn lịch sử (gitleaks, 297 commit): không có secret thật. `.gitignore` chặn `.env`, `*client_secret*.json`, `*.pem`. CI `security.yml` chạy gitleaks mỗi push/PR. |
| 3 | Bảo mật database | ✅ | `docker-compose.yml`: Postgres/Redis/RabbitMQ/MinIO/AI/worker chỉ bind `127.0.0.1` (`BIND_ADDR`); Redis `requirepass` qua `REDIS_PASSWORD`; DB password mặc định bị `STRICT_SECRETS` từ chối. Chỉ backend-main chạm DB. |
| 4 | Row-level security | ⚠️ Không áp dụng Postgres RLS | Chỉ 1 service (backend-main) truy cập DB bằng 1 role, nên RLS của Postgres không phân biệt được tenant. Cô lập tenant thực thi ở tầng service: mọi query nghiệp vụ lọc theo `workspaceId` + `WorkspaceAccessService` (AGENTS Rule 4). Xem "Việc còn lại". |
| 5 | Mã hoá dữ liệu | ✅ | API key AES-256-GCM; password BCrypt; truyền tải qua HTTPS (#19). OTP trong Redis sống 5 phút. |
| 6 | Kiểm tra input | ✅ | `@Valid` + `@Size` trên mọi DTO auth/glossary. **Email alias** (`a+1@gmail.com`, `a.b@gmail.com`, `@googlemail.com`, `+tag` mọi domain) → `EmailNormalizer` + cột `users.email_canonical` (V17): alias của hộp thư đã có → `EMAIL_ALREADY_EXISTS` (cả đăng ký lẫn Google OAuth). Avatar chỉ nhận ảnh raster/https (`AvatarPolicy`). |
| 7 | Xác thực server | ✅ | backend-ai & media-worker yêu cầu header `X-Internal-Token` (`app/core/internal_auth.py`, trừ `/health`); backend-main gửi qua `RestClientConfig`. Worker → backend-main: HMAC-SHA256 + timestamp ±5 phút (có sẵn). |
| 8 | Khoá quyền truy cập record | ✅ | Service-layer: `findByIdAndWorkspaceId` / `requireProjectAccess` / `requireJobOwnership` (đã rà các `findById`). |
| 9 | Chặn sửa field | ✅ | Request body là DTO record riêng (không bind Entity) → không mass-assignment `isPlatformAdmin`, `status`, `workspaceId`… `User.emailCanonical` không có setter. |
| 10 | Bảo mật cookie | ✅ | Refresh token chỉ nằm trong cookie `tf_refresh` `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` (`AuthCookieService`), không còn trong JSON/localStorage. `POST /api/auth/logout` xoá cookie. |
| 11 | Băm password | ✅ | BCrypt; `PasswordPolicy` giới hạn 72 byte (tránh 500 và cắt cụt âm thầm). |
| 12 | Giới hạn đăng nhập | ✅ | `LoginAttemptService`: 5 lần sai / 15 phút → `LOGIN_TEMPORARILY_LOCKED`. So sánh BCrypt giả khi email không tồn tại (chống dò email theo thời gian). Redis lỗi → fallback bộ nhớ, không fail-open. |
| 13 | Chặn bot | ✅ | `AuthThrottleFilter`: 30 request / 5 phút / IP cho login, register, OTP, forgot-password, google-exchange. Đăng ký **bắt buộc OTP email**; gửi OTP đăng ký giới hạn theo email. |
| 14 | Tham số hoá query | ✅ | Toàn bộ JPQL/Spring Data dùng tham số; không có SQL nối chuỗi. Python gọi subprocess dạng exec (không shell). |
| 15 | Escape nội dung người dùng | ✅ | React escape mặc định; không `dangerouslySetInnerHTML`; `react-markdown` không bật raw HTML. CSP `script-src 'self'` chặn script inject. |
| 16 | Giới hạn file upload | ✅ | Video: ≤500MB, ≤30 phút, `video/*` + ffprobe phải đọc được (`MEDIA_INVALID_FILE`), tên file được làm sạch; image backend-main cài ffmpeg. CSV glossary ≤2MB / 10.000 dòng. Avatar ≤~1MB. nginx `client_max_body_size 520m`. |
| 17 | Giảm dữ liệu trả về | ✅ | Controller trả DTO (không Entity); lỗi 500 không lộ stacktrace (`server.error.include-*: never`); bỏ public path swagger không dùng; actuator chỉ `health` không chi tiết. |
| 18 | Security headers | ✅ | API: CSP `default-src 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS. SPA (nginx): CSP, HSTS, `nosniff`, frame deny, referrer, permissions. |
| 19 | Bắt buộc HTTPS | ✅ (cấu hình) | `REQUIRE_HTTPS=true` → Spring redirect HTTP→HTTPS (trừ `/internal/**`, health); `forward-headers-strategy: native`; nginx redirect khi `X-Forwarded-Proto=http`; HSTS 1 năm. |
| 20 | Quét dependencies | ✅ | `.github/workflows/security.yml`: npm audit, pip-audit, Trivy (Maven + Dockerfile), gitleaks; chạy mỗi push/PR + hằng tuần. `.github/dependabot.yml`. Đã nâng `fastapi/starlette` (starlette 0.46 → ≥1.3.1, 7 CVE). |

## Checklist khi deploy production

1. `.env`: đặt `STRICT_SECRETS=true`, sinh mới `JWT_SECRET` (`openssl rand -base64 48`), `PROVIDER_KEY_ENC_SECRET`
   (`openssl rand -base64 32`), `MEDIA_WORKER_CALLBACK_SECRET`, `INTERNAL_SERVICE_TOKEN` (`openssl rand -hex 32`),
   `REDIS_PASSWORD`, `POSTGRES_PASSWORD`/`DB_PASSWORD`, `RABBITMQ_PASSWORD`, `MINIO_ROOT_PASSWORD`.
   Đổi `PROVIDER_KEY_ENC_SECRET` trên DB đã có dữ liệu cần re-encrypt key BYOK.
2. `INTERNAL_SERVICE_TOKEN` giống nhau ở backend-main, backend-ai, media-worker.
3. Đặt `REQUIRE_HTTPS=true` sau khi proxy TLS đã chạy; `FE_ORIGIN` và `MEDIA_STORAGE_PUBLIC_ENDPOINT` dùng `https://`.
4. Firewall VPS: chỉ mở 80/443 (và SSH). Không đặt `BIND_ADDR=0.0.0.0`.
5. MinIO console (9001), RabbitMQ management (15672), FreeLLMAPI dashboard (3001): chỉ truy cập qua SSH tunnel.

## Việc còn lại (chưa làm, cần quyết định)

- **Postgres RLS thật sự**: cần `SET LOCAL app.workspace_id` mỗi transaction + policy từng bảng + role riêng cho
  cronjob/platform-admin. Chi phí lớn, rủi ro chặn nhầm scheduler; hiện chưa làm.
- **Thu hồi refresh token** khi đổi/reset mật khẩu hoặc logout (cần lưu `jti`/`token_version`).
- **CAPTCHA** (Cloudflare Turnstile / reCAPTCHA) cho đăng ký nếu throttle + OTP chưa đủ chặn bot.
- **Access token** (TTL 30 phút) vẫn nằm trong localStorage để giữ phiên khi reload; chuyển sang chỉ trong bộ nhớ
  (bootstrap bằng `/auth/refresh`) sẽ triệt để hơn trước XSS.
- **pytest ≥ 9.0.3** (PYSEC-2026-1845, chỉ ảnh hưởng môi trường test) bị chặn bởi `pytest-asyncio<1`.
