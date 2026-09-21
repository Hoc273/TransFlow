# Kế hoạch thực hiện: các API Backend còn thiếu (theo từng nhánh)

> Nguồn nội dung: `docs/BACKEND_MISSING_IMPLEMENTATION_AND_INTEGRATION_PLAN.md` (Phần 1).
> Người thực hiện: chủ dự án — làm toàn bộ 9 hạng mục, không phân biệt module A/B.
> Khác biệt so với plan gốc: **hạng mục 1.4 đã đổi thiết kế** (tải theo tập video được chọn, không theo Batch) — xem mục 5.

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

## 1. Xuất kết quả Media Job — `/export` — ✅ ĐÃ HOÀN THÀNH (2026-09-21)

> Đã làm: endpoint `/export`, `MediaExportService`, `MediaStorageService.presignedGetUrl`, cấu hình TTL, và
> **`MEDIA_STORAGE_PUBLIC_ENDPOINT`** (ký link theo địa chỉ trình duyệt truy cập được — phát sinh thêm ngoài plan).
> QA gate dùng "issue chưa resolve có `BLOCK_PUBLISH`" (không phải severity `CRITICAL`); `API_Contract.md` đã cập nhật.
> Kiểm tra: 306 test xanh + chạy E2E thật với Postgres/MinIO (LEAD/MEMBER/CLIENT, QA blocked/override, job chưa xong,
> chưa có output RENDER, format sai, không token, tải file qua presigned URL với endpoint nội bộ ≠ công khai).
> Chưa commit; chưa chạy thử với backend trong container (compose hiện comment `backend-main`).

- **Nhánh:** `feature/media-job-export`
- **Ưu tiên:** 🔴 blocker (không có thì user không lấy được kết quả).
- **Endpoint:** `GET /api/workspaces/{workspaceId}/media/jobs/{jobId}/export?format=VIDEO|SUBTITLE`
  (đã có trong contract §5). Role: LEAD/MEMBER/CLIENT có quyền truy cập Project của job.

**Cần thay đổi:**
1. `MediaStorageService` (+ impl): thêm `presignedGetUrl(objectKey, ttlSeconds)` dùng `MinioClient.getPresignedObjectUrl`;
   TTL đọc từ `AppProperties` (mặc định 3600s, không hard-code). Thêm `getObject` nếu cần đọc file.
2. DTO `MediaExportResponse { format, fileName, downloadUrl, content }` (camelCase).
3. `MediaJobController.exportJob(...)` → `MediaJobService.exportJob(workspaceId, userId, jobId, format)`.
4. Logic service:
   - kiểm tra quyền truy cập project của job (mọi role đọc được);
   - job phải `COMPLETED`, ngược lại `STAGE_NOT_READY`;
   - quality gate: còn QA issue `CRITICAL` chưa override → `QA_BLOCKED` (403). Dùng repository của module `qa` **qua service**
     (thêm hàm đếm blocking vào `QaService` nếu chưa có), không đụng repository trực tiếp;
   - `format=SUBTITLE`: lấy `subtitle_segments` theo `job_id` order `seq ASC`, sinh SRT (và VTT nếu chọn) → trả trong `content`;
   - `format=VIDEO`: lấy `storage_ref` output của stage `RENDER` → presigned URL → `downloadUrl`;
   - `format` sai giá trị → `VALIDATION_ERROR`.
5. Cập nhật contract nếu shape/`format` thay đổi (ví dụ thêm `SRT|VTT`).

**Cách kiểm tra:**
- Unit test: sinh SRT đúng định dạng thời gian `HH:MM:SS,mmm`; job chưa COMPLETED → 409 `STAGE_NOT_READY`;
  còn CRITICAL chưa override → 403 `QA_BLOCKED`; override xong → 200.
- Thủ công: job COMPLETED → `format=VIDEO` trả URL, mở URL tải được file mp4; `format=SUBTITLE` trả nội dung SRT;
  CLIENT gọi được; user ngoài workspace → 403; URL hết hạn sau TTL.

---

## 2. Sửa phụ đề hàng loạt — `/segments/batch`

- **Nhánh:** `feature/media-job-segments-batch-edit`
- **Endpoint:** `PUT /api/workspaces/{workspaceId}/media/jobs/{jobId}/segments/batch`. Role: LEAD; MEMBER chỉ job của mình
  (ownership như PATCH đơn lẻ hiện có).

**Cần thay đổi:**
1. DTO `BatchEditSegmentsRequest { updates: [{segmentId, targetText, startMs, endMs}] }` (`@NotEmpty`, giới hạn kích thước
   hợp lý, validate `startMs < endMs`).
2. `MediaJobController.batchUpdateSubtitles` + `MediaJobService.batchUpdateSubtitles`.
3. Logic: **một `@Transactional`**, khoá job (`FOR UPDATE`); mọi `segmentId` phải thuộc `jobId` (lạ → `VALIDATION_ERROR`);
   cập nhật các trường được gửi (field null = giữ nguyên); nếu job đã qua `TTS`/`RENDER` → đánh dấu các stage sau `STALE`
   **đúng 1 lần**; trả `List<SubtitleSegmentResponse>` đã cập nhật.
4. **Tái dùng** logic PATCH đơn lẻ hiện có (validate + STALE) thay vì viết lại — tách hàm dùng chung.

**Cách kiểm tra:**
- Test: cập nhật 50 segment → 1 transaction, stage `TTS`/`RENDER` chuyển STALE đúng 1 lần (không lặp);
  1 segment thuộc job khác → 400 và **không segment nào bị đổi** (rollback);
  MEMBER sửa job người khác → 403; CLIENT → 403.
- Thủ công: gửi mảng 3 segment, GET `/subtitles` xác nhận đã đổi; gọi lại 2 lần vẫn idempotent.

---

## 3. Cấu hình dựng hình — `/render-config`

- **Nhánh:** `feature/media-job-render-config`
- **Endpoint:** `GET` và `PUT /api/workspaces/{workspaceId}/media/jobs/{jobId}/render-config`. Role: LEAD/MEMBER (ownership
  như các mutation khác); GET cho mọi role trong project.

**Cần thay đổi:**
1. Cột `media_jobs.render_config` (JSONB) **đã có** → không cần migration (chỉ thêm nếu phát hiện thiếu).
2. DTO request/response tách riêng: `RenderConfigRequest` và `RenderConfigResponse`
   (`aspectRatio`, `subtitleMode`, `coverLayers[]`, `subtitleStyle`); validate enum (`ORIGINAL|16:9|9:16|1:1`,
   `HARD_SUB|SOFT_SUB`) và toạ độ cover layer trong khoảng hợp lệ.
3. Service đọc/ghi JSONB qua `ObjectMapper`; PUT khi stage `RENDER` đã COMPLETED → đánh dấu `RENDER` là `STALE`.
4. Đảm bảo pipeline RENDER (worker payload) đọc đúng cấu hình này — kiểm tra chỗ build payload gửi `backend-media-worker`.

**Cách kiểm tra:**
- Test: PUT rồi GET trả đúng giá trị; giá trị enum sai → 400; job đã render → RENDER thành STALE.
- Thủ công: đổi `aspectRatio=9:16`, rerun RENDER, xác nhận video output đúng tỉ lệ; job mới chưa cấu hình → GET trả mặc định
  (không lỗi/null).

---

## 4. Phong cách phụ đề — `/media/subtitle-styles`

- **Nhánh:** `feature/media-subtitle-styles`
- **Endpoint:**
  - `GET /api/media/subtitle-styles` — danh sách style hệ thống (Classic, Modern Clean, TikTok, Cinema, Neon...).
  - `GET /api/media/subtitle-styles/{key}` — chi tiết theo key.
  - `GET /api/media/jobs/{jobId}/subtitle-style` — snapshot đang áp dụng cho job.
  - `POST /api/media/jobs/{jobId}/subtitle-style` — body `{ "key": "MODERN_CLEAN" }`, trả snapshot.

  > Lưu ý: các route job ở đây **không** có tiền tố `/workspaces/{workspaceId}` (theo plan gốc). Khi viết contract, cân nhắc
  > dùng `/api/workspaces/{workspaceId}/media/jobs/{jobId}/subtitle-style` cho nhất quán với các route job khác và để enforce
  > quyền theo workspace — quyết định trước khi code, sửa FE cho khớp.

**Cần thay đổi:**
1. Nguồn dữ liệu style hệ thống: bảng/seed (migration `V7__seed_subtitle_styles.sql`) hoặc file cấu hình; ưu tiên
   theo `Database_Design.md`/code gốc `../transflow` (`SubtitleStyleController`) — xem gốc lưu ở đâu rồi theo.
2. DTO `SubtitleStyleSnapshot` — **13 trường**; JSON của FE dùng camelCase (`fontFamily`, `fontSize`, ...), thống nhất với
   `api-response-convention` (plan gốc ghi snake_case trong record → chọn camelCase nếu FE đã chuẩn hoá camelCase, và
   xác nhận với FE).
3. Controller + service; POST ghi snapshot vào `media_jobs.subtitle_style` (cột NOT NULL, đã có) → nếu RENDER đã COMPLETED
   thì đánh dấu STALE. Key không tồn tại → 404/`VALIDATION_ERROR` (thêm `ErrorCode` nếu cần, đúng dải).
4. Đảm bảo `POST /media/jobs` (tạo job) vẫn ghi `subtitle_style` mặc định hợp lệ.

**Cách kiểm tra:**
- Test: list trả đủ style seed; get key sai → lỗi đúng mã; POST đổi style → GET job-style trả snapshot mới, đủ 13 trường.
- Thủ công: Studio mở `SubtitleStylePanel` không bị 404/loading treo; chọn style → render ra phụ đề đúng style.

---

## 5. Tải video theo lựa chọn (thay cho "tải theo Batch") — ĐÃ ĐỔI THIẾT KẾ

- **Nhánh:** `feature/media-library-bulk-download`
- **Thay đổi so với plan gốc 1.4:** bỏ `GET /batches/{batchId}/download` (đơn vị tải = 1 batch). Đơn vị tải mới là
  **một tập video đã hoàn thành do user tự chọn, không phụ thuộc job/batch nào**. Giao diện có nơi lưu trữ video đã hoàn thành
  **theo từng project**: user chọn project, chọn nhiều video rồi bấm tải; backend nén tập đã chọn thành 1 file zip.
- **Quyết định đã chốt:** hiển thị theo từng project (giống `MediaListPage` của bản gốc).

**Khảo sát code gốc (`../transflow`):**
- UI liệt kê video ở `pages/media/MediaListPage.tsx`: `useMediaJobs` → `listTransformationJobsApi` →
  `GET /api/workspaces/{workspaceId}/projects/{projectId}/media/jobs` (`MediaController.listJobs`). Theo project, mọi trạng thái,
  không phân trang; FE lọc phía client.
- Backend mini **đã có** `GET /projects/{projectId}/media/jobs?status=COMPLETED&recipeId=` → **không viết endpoint list mới**;
  FE chỉ cần thêm `status=COMPLETED`. Không cần thêm route `media/library`.
- Bản gốc và backend mini **chưa có** endpoint tải zip (`downloadBatchZipApi` chỉ là FE của `transflow_mini`) → viết mới.

**Endpoint mới (ghi vào `API_Contract.md`):**
- `POST /api/workspaces/{workspaceId}/projects/{projectId}/media/jobs/download` — body `{ "jobIds": [uuid, ...] }` →
  `{ downloadUrl, fileName, expiresAt, includedJobIds, skipped: [{jobId, reason}] }`.
  Role: LEAD/MEMBER/CLIENT có quyền truy cập project đó. Route theo project để khớp với API list và kiểm tra quyền 1 lần.
- Danh sách (dùng lại, không đổi): `GET /api/workspaces/{workspaceId}/projects/{projectId}/media/jobs?status=COMPLETED`.

**Cần thay đổi:**
1. `MediaJobController`: thêm `POST /projects/{projectId}/media/jobs/download`; DTO `BulkDownloadRequest{jobIds}` và
   `BulkDownloadResponse`. (Không cần sửa API list; nếu FE cần biết video bị chặn QA để tô xám, thêm cờ `downloadable` vào
   `MediaJobResponse` là tuỳ chọn.)
2. Service: validate `jobIds` (không rỗng, loại trùng, **tối đa N video/lần** mặc định 20 — đưa vào config, không hard-code);
   mỗi job phải thuộc `projectId`, `COMPLETED`, user có quyền, và qua quality gate như `/export` (tái dùng hàm kiểm tra của
   nhánh 1). Job không đạt → vào `skipped` kèm lý do; không còn job nào → `QA_BLOCKED` hoặc `STAGE_NOT_READY` tuỳ nguyên nhân
   (**default đề xuất, cần xác nhận**).
3. Tạo `.zip`: đọc output RENDER của từng job từ MinIO, nén dạng stream (không load cả file vào RAM), tên file tránh trùng
   (`<tên>_<lang>_<jobId8>.mp4`), upload lên MinIO key tạm (prefix riêng, xoá sau TTL), trả presigned URL (hàm ở nhánh 1).
   Bản đầu chạy sync với giới hạn N nhỏ (ghi comment `ponytail:` về trần này; nếu chậm thì chuyển async `202` + polling).
4. Cập nhật `API_Contract.md` §6: xoá dòng `/batches/{batchId}/download`, thêm endpoint mới; thêm `ErrorCode` nếu cần
   (ví dụ `DOWNLOAD_SELECTION_TOO_LARGE`) trong đúng dải.
5. Báo FE: màn lưu trữ gọi list với `status=COMPLETED` + `POST .../projects/{projectId}/media/jobs/download`; xoá
   `downloadBatchZipApi` cũ.

**Cách kiểm tra:**
- Test: chọn 3 job COMPLETED (khác batch) trong cùng project → zip đủ 3 file; job chưa COMPLETED nằm trong `skipped`;
  vượt N → 400; job thuộc project khác → bị loại/403; job `QA_BLOCKED` không lọt vào zip; danh sách rỗng → 400.
- Thủ công: gọi list `?status=COMPLETED`, chọn vài id, `POST download`, tải URL, giải nén kiểm tra video phát được;
  CLIENT tải được, user ngoài workspace bị 403; URL hết hạn đúng TTL; file zip tạm bị dọn.

---

## 6. Ghi đè ngôn ngữ nguồn — `/override-source-lang`

- **Nhánh:** `feature/media-job-override-source-lang`
- **Endpoint:** `POST /api/workspaces/{workspaceId}/media/jobs/{jobId}/override-source-lang`, body `{ "sourceLang": "vi" }`.
  Role: LEAD; MEMBER chỉ job của mình.

**Cần thay đổi:**
1. DTO request (validate mã ngôn ngữ thuộc danh sách hỗ trợ trong SRS/config).
2. Service: chỉ cho phép sau khi `STT` đã có kết quả; cập nhật `source_lang` của job (khoá `FOR UPDATE`); đánh dấu
   `TRANSLATE` và các stage sau là `STALE`; cho phép rerun từ `TRANSLATE` qua endpoint rerun hiện có (**không** tự chạy).
3. Ngôn ngữ nguồn trùng ngôn ngữ đích → `VALIDATION_ERROR`.

**Cách kiểm tra:**
- Test: đổi `zh`→`vi` cập nhật `source_lang`, stage sau thành STALE; lang không hỗ trợ → 400; CLIENT → 403.
- Thủ công: đổi ngôn ngữ, rerun `TRANSLATE`, bản dịch dùng ngôn ngữ nguồn mới.

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

## 10. Thứ tự đề xuất & phụ thuộc

| Thứ tự | Nhánh | Phụ thuộc |
|---|---|---|
| 1 | `feature/media-job-export` | tạo `presignedGetUrl` dùng chung |
| 2 | `feature/media-job-segments-batch-edit` | — |
| 3 | `feature/media-job-render-config` | — (cùng `MediaJobController` với 2, 6: merge tuần tự để tránh conflict) |
| 4 | `feature/media-subtitle-styles` | — |
| 5 | `feature/media-library-bulk-download` | nhánh 1 (presigned URL + quality gate dùng chung) |
| 6 | `feature/media-job-override-source-lang` | — |
| 7 | `feature/tts-voice-preview` | — |
| 8 | `feature/auth-forgot-password-otp` | — |
| 9 | `feature/platform-admin-api` | sau cùng; sửa cả docs phạm vi |

Chưa cần làm: mục 3.1–3.3 của plan gốc (Vite proxy, CORS, MinIO config) là cấu hình tích hợp, thực hiện khi bật BE thật
trên FE — kiểm tra riêng ở Phase 1 của checklist tích hợp.

---

## 11. Checklist theo dõi tiến độ

Đánh dấu `[x]` khi nhánh đã code xong, test xanh và kiểm tra thủ công đạt (theo mục "Cách kiểm tra" của từng phần).

| # | Nhánh | Code | Test tự động | Kiểm tra thủ công | Cập nhật `API_Contract.md` | Commit / PR |
|---|---|:-:|:-:|:-:|:-:|:-----------:|
| 1 | `feature/media-job-export` | [x] | [x] | [x] | [x] |     [x]     |
| 2 | `feature/media-job-segments-batch-edit` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 3 | `feature/media-job-render-config` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 4 | `feature/media-subtitle-styles` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 5 | `feature/media-library-bulk-download` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 6 | `feature/media-job-override-source-lang` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 7 | `feature/tts-voice-preview` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 8 | `feature/auth-forgot-password-otp` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 9 | `feature/platform-admin-api` | [ ] | [ ] | [ ] | [ ] |     [ ]     |