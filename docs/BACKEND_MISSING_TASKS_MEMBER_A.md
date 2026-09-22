# Việc Backend còn thiếu — Thành viên A

> File này là **bản trích** từ `BACKEND_MISSING_TASKS_BY_BRANCH.md` (bản tổng hợp/nguồn) — phần việc giao cho **Thành viên A**: auth (quên mật khẩu), provider (nghe thử giọng TTS, capabilities), platform admin.
> Số mục giữ nguyên như file tổng hợp. Khi nội dung mục thay đổi, sửa ở file tổng hợp rồi đồng bộ lại file này;
> việc tích tiến độ (`[x]`) làm ở **file của mình** và báo lại để cập nhật bảng tổng.
> Phân công dựa trên ranh giới module `CLAUDE.md` §4.8; muốn đổi người cho mục nào thì thống nhất rồi chuyển mục đó.

## 0. Quy ước chung cho mọi nhánh

**Tạo nhánh:** từ `main` (hoặc `develop` nếu team đang tích hợp ở đó), không tạo từ `fix/api-500-exceptions-batch`.
Mỗi nhánh = 1 PR nhỏ.

**Quy tắc bắt buộc (CLAUDE.md):**
- Response luôn `ApiResponse<T>`; lỗi ném qua `AppException(ErrorCode.X)`; controller không try/catch.
- Service = interface + `service/impl/XxxImpl` (§4.8). Module khác chỉ inject qua interface.
- `ErrorCode` mới: dùng đúng dải mã của module (`API_Contract.md` §15.2) và cập nhật §15.3 cùng lúc.
- Mọi endpoint mới **chưa có trong `API_Contract.md`** (tất cả trừ `/export`) → thêm vào contract trong chính nhánh đó
  (route, role, request/response, mã lỗi). Endpoint đổi thiết kế (mục 5) cũng phải sửa contract §6.
- RBAC enforce ở tầng service; mutation trạng thái job dùng `SELECT ... FOR UPDATE` (§5 CLAUDE.md).
- Biến nhạy cảm mới → đọc qua env và cập nhật `.env.example`.
- Trước khi code mỗi nhánh: tìm chức năng tương ứng trong `../transflow` để tham khảo (không copy hành vi legacy).

**Kiểm tra chung sau mỗi nhánh (Definition of Done):**
1. `./mvnw -q test` (trong `backend-main`) — toàn bộ test xanh, có test mới cho nhánh.
2. `./mvnw -q -DskipTests package` — build được.
3. Chạy app + gọi thật bằng curl/Postman/`.http` (token JWT của LEAD, MEMBER, CLIENT) theo bảng kiểm thử ở từng mục.
4. Đối chiếu response với `API_Contract.md` đã cập nhật (shape, mã lỗi).
5. Không có secret hard-code; `.env.example` đồng bộ.

**Trạng thái code hiện tại (đã khảo sát):**
- `MediaJobController` mới có: create/list/get/cancel, `voice`, `checkpoints/{cp}/confirm`, `stages/{stage}/rerun`,
  `GET subtitles`, `PATCH subtitles/{segmentId}`.
- `MediaStorageService` (`media_asset`) chỉ có `putMediaObject`, **chưa có presigned URL / đọc object** → nhánh 1 phải thêm.
- `media_jobs` đã có cột `subtitle_style JSONB NOT NULL` và `render_config JSONB DEFAULT '{}'` (V1__init_tables.sql).
- `ErrorCode` đã có `QA_BLOCKED` (3300), `STAGE_NOT_READY` (2902), `VALIDATION_ERROR` (9998).
- Thư mục migration hiện dừng ở `V6`; migration mới đánh số tiếp `V7__...` (không sửa file cũ).

---

---

## 7. Nghe thử giọng TTS — `/tts-voices/preview`

- **Nhánh:** `feature/tts-voice-preview`
- **Endpoint:** `POST /api/tts-voices/preview`, body `{ "voiceId": "uuid", "text": "Xin chào" }`. Mọi user đăng nhập.

**Cần thay đổi:**
1. DTO (`text` tối đa ~50 ký tự, `@NotBlank`), response `{ audioUrl }`.
2. Service (module `provider`): tra `tts_voices` theo `voiceId`, resolve provider (BYOK/platform) qua
   `ProviderResolverService`, gọi `backend-ai` `/media/tts/synthesize` (FastAPI stateless), lưu mp3 ngắn lên MinIO key tạm
   và trả presigned URL ngắn hạn.
3. Chống lạm dụng: rate limit theo user (tái dùng cơ chế giống `BatchCreateRateLimiter`); **không trừ Credit lớn** —
   quyết định: preview miễn phí hay tính phí nhỏ (ghi rõ vào contract).

**Cách kiểm tra:**
- Test: voiceId không tồn tại → 404; text quá dài → 400; vượt rate limit → 429.
- Thủ công: gọi preview với 1 giọng platform, mở `audioUrl` nghe được ~2–3 giây; kiểm tra log FastAPI nhận đúng request.

**Ghi chú đã làm (nhánh `feature/backend-java/tts-voices/preview` — giữ tên theo convention `feature/backend-java/*` của A, lệch tên `feature/tts-voice-preview` trong plan):**
- Route FastAPI thật là `POST /media/tts` (không phải `/media/tts/synthesize` như plan ghi).
- **Đã chốt: preview miễn phí** — chỉ rate limit, không trừ Credit (đã ghi vào `API_Contract.md` §11).
- Resolve provider **theo provider sở hữu voice** (`tts_voices.user_provider_id`/`platform_provider_id` → repo cùng module, kèm `default_model`), không dùng `resolveForCapability` (tránh chọn sai BYOK provider). Voice `USER` chỉ owner mới preview được (người khác → `404 TTS_VOICE_NOT_FOUND`).
- Rate limit: `TtsVoicePreviewRateLimiter` — Redis INCR fixed-window theo mẫu `BatchCreateRateLimiterImpl`, mặc định **5 req/60s** per user, fail-open khi Redis lỗi; cấu hình qua `VOICE_PREVIEW_RATE_LIMIT_MAX_REQUESTS`/`_WINDOW_SECONDS` (đã thêm `.env.example` + `application.yaml`).
- `audioUrl` dùng `MediaStorageService.presignedGetUrl` hiện có → TTL = `MEDIA_STORAGE_PRESIGNED_TTL_SECONDS` (3600s), không thêm overload; response `{audioUrl, expiresInSeconds}`; object key `temp/voice-preview/<userId>/<uuid>.<ext>` (sniff mp3/wav/ogg/flac qua `AudioContentDetector` port từ `../transflow`).
- `ErrorCode` mới: `TTS_PREVIEW_RATE_LIMIT_EXCEEDED` = 2407 (429), `TTS_PREVIEW_FAILED` = 2408 (502); đã cập nhật §15.2/§15.3.
- Kiểm tra thủ công với `backend-ai` + MinIO thật: **chưa làm** (cần bật docker compose).

---

---

## 8. Quên mật khẩu qua OTP

- **Nhánh:** `feature/auth-forgot-password-otp`
- **Endpoint (public, không cần JWT — thêm vào `permitAll` trong `SecurityConfig`):**
  1. `POST /api/auth/forgot-password/otp` — body `{email}`: sinh OTP 6 số, lưu Redis `otp:pwd_reset:<email>` TTL 5 phút,
     gửi email (dev: log ra console). **Luôn trả 200 dù email không tồn tại** (tránh dò tài khoản).
  2. `POST /api/auth/forgot-password/verify` — body `{email, otp}`: kiểm tra khớp.
  3. `POST /api/auth/forgot-password/reset` — body `{email, otp, newPassword}`: xác thực lại OTP, BCrypt, cập nhật
     `users.password_hash`, xoá OTP.

**Cần thay đổi:**
1. `AuthService` thêm 3 hàm; lưu OTP hash (không lưu plain) hoặc chấp nhận plain trong Redis TTL ngắn (ghi rõ lựa chọn).
2. Giới hạn: số lần verify sai (vd 5 lần → xoá OTP), rate limit gửi OTP theo email/IP.
3. Gửi email: nếu chưa có mail sender → thêm `spring-boot-starter-mail` vào block dependency phù hợp trong `pom.xml`
   (§4.9), cấu hình SMTP **qua biến môi trường** + cập nhật `.env.example` (comment cách lấy giá trị); dev fallback log.
4. Tài khoản Google-only (không có password) → xử lý có chủ đích (từ chối hoặc cho đặt mật khẩu — chốt và ghi contract).
5. `ErrorCode` mới (OTP sai/hết hạn) trong dải của module `auth`.
6. Reset xong nên vô hiệu refresh token cũ của user nếu code hiện có hỗ trợ.

**Cách kiểm tra:**
- Test: OTP đúng → reset thành công, đăng nhập được bằng mật khẩu mới, mật khẩu cũ hết hiệu lực; OTP sai/hết hạn → lỗi
  đúng mã; verify sai quá số lần → OTP bị xoá; email lạ vẫn trả 200 ở bước 1.
- Thủ công: chạy với Redis thật, xem `TTL otp:pwd_reset:<email>` ≈ 300s; OTP không xuất hiện trong response.

---

---

## 10. Worker Capabilities & Readiness — `/api/transformation/capabilities` (MỚI theo plan v2)

- **Nhánh:** `feature/transformation-capabilities`
- **Ưu tiên:** 🔴 blocker giao diện tạo job: `UploadConsentPanel.tsx` gọi ngay khi mở trang để biết chế độ xử lý nào dùng được
  (`FAST` = dịch/lồng tiếng chuẩn, `STUDIO` = lồng tiếng nâng cao giữ ngữ điệu) và revalidate trước khi bấm "Tạo Job"
  để không đẩy job vào hàng đợi chết.
- **Endpoint:** `GET /api/transformation/capabilities` — toàn hệ thống (không có `workspaceId`), `200 OK`.
  **Auth: JWT bắt buộc** (plan ghi "Public / Authenticated"; chọn Authenticated để không lộ trạng thái hạ tầng công khai;
  cần chốt, nếu FE gọi trước đăng nhập thì mới mở `permitAll`).
- **Hiện trạng:** backend mini chưa có; `../transflow` có `TransformationCapabilitiesController` →
  `AvailabilityProjectionService` (kèm `WorkerCapabilityProperties`, `InMemoryWorkerCapabilityCache`, các engine
  scoring/selection thuộc kiến trúc CT10 legacy). `CLAUDE.md` §4.2 đang liệt controller này vào "LOẠI BỎ" → **chỉ lấy ý
  tưởng projection, viết bản gọn**, không copy engine scoring/selection.
- **Vị trí code (lệch plan, có chủ đích):** plan đặt trong `media_job`; giao A nên đặt trong module `provider` (nơi đã có
  `AiGatewayClient`), service tên `WorkerCapabilityService` (interface + impl). Không đụng repository module khác.

**DTO `AvailabilityProjectionResponse`** (camelCase, theo plan): `protocolVersion` ("1.0"), `supportedExecutionModes`
(`["FAST","STUDIO"]`), `defaultExecutionMode` ("FAST"), `availability{FAST|STUDIO → {available, unavailableReason}}`,
`workerCapability{state READY|DEGRADED|OFFLINE, workerCount, compatibleFastWorkers, compatibleStudioWorkers}`,
`readiness{status READY|DRAINING, readyExecutionModes, reasons[], evaluatedAt}`.

**Cần thay đổi:**
1. Nguồn dữ liệu: gọi `GET /health` của `backend-ai` (có sẵn) và của `backend-media-worker` (có sẵn). Backend-main **chưa có
   base URL của media worker** → thêm `app.media-worker.base-url` = env `MEDIA_WORKER_URL` (không nhạy cảm; thêm vào
   `.env.example` và compose) cạnh `hmacSecret` hiện có.
2. Quy tắc gọn (ghi rõ là mặc định, cần xác nhận): `FAST` available ⇔ backend-ai **và** media-worker đều healthy;
   `STUDIO` available ⇔ `FAST` available **và** tách nguồn (source separation) bật (theo cấu hình backend-ai,
   `SEPARATION_ENGINE_ID`). `unavailableReason` điền mã ngắn (ví dụ `AI_GATEWAY_DOWN`, `MEDIA_WORKER_DOWN`,
   `SEPARATION_DISABLED`). `state`: cả hai lên → `READY`; chỉ một phần → `DEGRADED`; không có → `OFFLINE`.
   `workerCount` = số worker healthy (hiện tối đa 1 media-worker).
3. Cache kết quả vài giây trong bộ nhớ (TTL cấu hình, ví dụ 5–10s) để FE polling không dồn request tới worker;
   health-check có timeout ngắn, lỗi mạng → coi là DOWN (không ném 500).
4. Controller `TransformationCapabilitiesController` (`/api/transformation`), trả `ApiResponse<AvailabilityProjectionResponse>`.
5. Dùng chung với nhánh platform-admin (mục 9): hàm health-check MinIO/Redis/RabbitMQ/Postgres dùng cho `/api/platform/status`
   nên tách thành service chung — làm mục 10 trước, mục 9 tái dùng.
6. Cập nhật `API_Contract.md` (thêm endpoint), và (tuỳ chọn) validate `requestedMode` khi tạo job: `STUDIO` mà không available
   → từ chối rõ ràng (cần chốt có làm ở nhánh này không; mặc định **không**, chỉ trả projection).

**Cách kiểm tra:**
- Test: mock 2 client health → 4 tổ hợp up/down cho ra `READY`/`DEGRADED`/`OFFLINE` và `availability` đúng; timeout/lỗi mạng →
  DOWN, không 500; cache: 2 lần gọi liên tiếp chỉ health-check 1 lần; không token → 401.
- Thủ công: chạy compose có `backend-ai` + `media-worker` → `FAST`/`STUDIO` available; `docker stop transflow-media-worker`
  → `OFFLINE`/`FAST` unavailable với `unavailableReason`; bật lại → phục hồi sau khi cache hết hạn; mở màn upload trên FE
  và thấy chế độ đúng.

---

---

## 9. Quản trị nền tảng — `/api/platform/*`

- **Nhánh:** `feature/platform-admin-api`
- **Ưu tiên:** thấp nhất, phạm vi lớn nhất.
- **Lưu ý phạm vi:** `CLAUDE.md` §3/§4.2 và `SRS.md` §4.3 đang ghi Platform Admin là **ngoài phạm vi**. Vì đã quyết định làm,
  trong nhánh này phải sửa các file đó (bỏ khỏi mục "ngoài phạm vi", thêm mô tả SRS/kiến trúc/contract) để docs không
  mâu thuẫn code.
- **Endpoint (chỉ user có `isPlatformAdmin = true`):**
  1. `GET /api/platform/overview?from=&to=&topLimit=` — 6 KPI: số User, Workspace, phân loại Job, token AI theo tác vụ,
     `failRate`, top workspace tiêu thụ.
  2. `GET /api/platform/status` — health của PostgreSQL, Redis, RabbitMQ, MinIO, FastAPI (bỏ "Celery" vì kiến trúc này
     không dùng Celery — chỉ liệt kê thành phần thực sự có).
  3. `GET /api/platform/users?page=&size=&q=&isPlatformAdmin=`
  4. `GET /api/platform/workspaces?page=&size=&q=`
  5. `GET /api/platform/audit-logs?page=&size=&action=`

**Cần thay đổi:**
1. Kiểm tra `users` đã có cờ platform admin chưa (`Database_Design.md`); chưa có → migration `V7+` thêm cột
   (`is_platform_admin BOOLEAN NOT NULL DEFAULT false`) và đưa vào JWT claim/`AuthenticatedUser`.
2. Bảng `audit_logs` chưa có (kiểm tra) → migration + ghi log ở các thao tác admin; cập nhật `Database_Design.md`.
3. `PlatformController` + `PlatformService`, guard `@PreAuthorize`/kiểm tra ở tầng service (không chỉ ẩn UI).
4. Truy vấn tổng hợp dùng `ai_usage_logs`, `media_jobs`; **bắt buộc phân trang và có index**, tránh full scan.
5. Tham khảo `PlatformController` ở `../transflow` (chỉ lấy phần khớp).
6. Cập nhật `SRS.md`, `System_Architecture.md`, `Database_Design.md`, `API_Contract.md`, `CLAUDE.md` cho nhất quán.

**Cách kiểm tra:**
- Test: user thường gọi → 403; admin gọi → 200; phân trang/`q` hoạt động; `failRate` tính đúng trên dữ liệu mẫu;
  `status` báo DOWN khi tắt thử Redis/RabbitMQ.
- Thủ công: đăng nhập tài khoản admin, mở `/platform/*` trên FE với BE thật, các số liệu khớp truy vấn SQL tay.

---

---

## Thứ tự làm & phối hợp — Thành viên A

| Thứ tự | Người | Nhánh | Phụ thuộc |
|---|:-:|---|---|
| 7 | A | `feature/tts-voice-preview` | — |
| 8 | A | `feature/auth-forgot-password-otp` | — |
| 10 | A | `feature/transformation-capabilities` | — (làm trước 9: health-check dùng chung) |
| 9 | A | `feature/platform-admin-api` | sau mục 10; sửa cả docs phạm vi |

**Lưu ý phối hợp A ↔ B:**
- Migration Flyway: số `V7`, `V8`… **do 2 người thống nhất trước** (ai cần migration trước thì lấy số tiếp theo), tránh trùng version.
- `common/` (ErrorCode dải mã, `AppProperties`, `.env.example`): chỉ thêm, không đổi có sẵn; báo người còn lại khi sửa.
- `pom.xml`: thêm dependency vào block của mình (`CLAUDE.md` §4.9).
- `MediaStorageService.presignedGetUrl` (B, nhánh 1) dùng chung với `/voices/preview` (A, mục 7): A chờ nhánh 1 merge hoặc
  rebase lên nó.

Chưa cần làm: mục 3.1–3.3 của plan gốc (Vite proxy, CORS, MinIO config) là cấu hình tích hợp, thực hiện khi bật BE thật
trên FE — kiểm tra riêng ở Phase 1 của checklist tích hợp.

---

## Checklist tiến độ — Thành viên A

Đánh dấu `[x]` khi code xong, test xanh và kiểm tra thủ công đạt (theo mục "Cách kiểm tra").

| # | Nhánh | Code | Test tự động | Kiểm tra thủ công | Cập nhật `API_Contract.md` | Commit / PR |
|---|---|:-:|:-:|:-:|:-:|:-----------:|
| 7 | `feature/tts-voice-preview` | [x] | [x] | [ ] | [x] |     [ ]     |
| 8 | `feature/auth-forgot-password-otp` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 9 | `feature/platform-admin-api` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 10 | `feature/transformation-capabilities` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
