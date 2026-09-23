# Kế hoạch thực hiện: các API Backend còn thiếu (theo từng nhánh)

> Nguồn nội dung: `docs/BACKEND_MISSING_IMPLEMENTATION_AND_INTEGRATION_PLAN.md` (Phần 1).
> Người thực hiện: 2 người (Thành viên A và B) — tổng 11 hạng mục, phân công ở mục 12.
> Khác biệt so với plan gốc: **hạng mục 1.4 đã đổi thiết kế** (tải theo tập video được chọn, không theo Batch) — xem mục 5.
>
> **Cập nhật theo plan v2.0 (21/09/2026):** thêm 2 hạng mục mới — **mục 10** (Worker Capabilities) và **mục 11**
> (Output Package & Publish Package); mục 3 (`render-config`) đổi sang DTO Render Studio v2 và thêm `rerun-render`;
> mục 1 ghi chú `format` mở rộng `SRT|VTT`.
>
> **Phân công 2 người** (file này là bản tổng hợp/nguồn; mỗi người có file riêng chứa phần việc của mình):
> - Thành viên A → [`BACKEND_MISSING_TASKS_MEMBER_A.md`](BACKEND_MISSING_TASKS_MEMBER_A.md): mục 7, 8, 9, 10 (auth / provider / platform / capabilities).
> - Thành viên B → [`BACKEND_MISSING_TASKS_MEMBER_B.md`](BACKEND_MISSING_TASKS_MEMBER_B.md): mục 1–6, 11 (pipeline Media Job).
>
> Cách chia dựa trên ranh giới module ở `CLAUDE.md` §4.8 (A: auth/provider/dashboard…; B: media_job/media_asset/batch…).
> Mục 10 (capabilities) giao A vì gắn với kiểm tra sức khoẻ hạ tầng, dùng chung logic với `/api/platform/status` (mục 9).
> Muốn đổi người cho mục nào thì sửa bảng ở mục 12 và chuyển mục đó sang file của người nhận (đồng bộ thủ công).

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
> Đã commit. Chưa chạy thử với backend trong container (compose hiện comment `backend-main`).

- **Nhánh:** `feature/media-job-export`
- **Ưu tiên:** 🔴 blocker (không có thì user không lấy được kết quả).
- **Endpoint:** `GET /api/workspaces/{workspaceId}/media/jobs/{jobId}/export?format=VIDEO|SUBTITLE`
  (đã có trong contract §5). Role: LEAD/MEMBER/CLIENT có quyền truy cập Project của job.
- **Bổ sung theo plan v2 (chưa làm):** plan mới ghi `format=VIDEO|SRT|VTT` (tải `SRT`/`VTT` trả nội dung trong `content`),
  trong khi bản đã làm và `API_Contract.md` dùng `VIDEO|SUBTITLE` (SUBTITLE = SRT). Việc còn lại khi chốt: chấp nhận thêm
  `SRT`, `VTT` (thêm hàm sinh WebVTT: header `WEBVTT`, mốc `HH:MM:SS.mmm`), giữ `SUBTITLE` làm alias của `SRT` để không
  gãy FE cũ, rồi cập nhật contract. Phần này có thể làm cùng nhánh 11 hoặc một commit nhỏ trên nhánh 1.

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
- **Endpoint (theo plan v2 — Render Studio v2):**
  - `GET /api/workspaces/{workspaceId}/media/jobs/{jobId}/render-config`
  - `PUT /api/workspaces/{workspaceId}/media/jobs/{jobId}/render-config`
  - `POST /api/workspaces/{workspaceId}/media/jobs/{jobId}/rerun-render` → `202 Accepted`, body tuỳ chọn
    (`UpdateRenderConfigRequest`): lưu cấu hình (nếu có) rồi chạy lại stage `RENDER`.
  Role: LEAD/MEMBER (ownership như các mutation khác); GET cho mọi role trong project.
- **Tính năng FE cần hỗ trợ:** reframe `ORIGINAL|16:9|9:16|1:1|4:3` (kèm blur-pad khi ngang→dọc); cover layers theo toạ độ %
  (`xPercent/yPercent/widthPercent/heightPercent`, `layerType` COVER_BOX/IMAGE/WATERMARK, `anchor`, `colorHex`, `opacity`);
  audio ducking và gain (`originalGainDb`, `ttsGainDb`, `ducking{enabled,gainDb,attackMs,releaseMs}`).

**Cần thay đổi:**
1. Cột `media_jobs.render_config` (JSONB) **đã có** → không cần migration (chỉ thêm nếu phát hiện thiếu).
2. DTO (package `media_job.dto.render`, tách request/response):
   - `RenderConfigResponse`: `subtitleMode`, `subtitlePosition` (BOTTOM/TOP/CENTER), `verticalOffsetPercent` (−30..30),
     `backgroundBox`, `backgroundColor` (`#RRGGBBAA`), `textColor` (`#RRGGBB`), `outputAspectRatio`, `confirmed`,
     `sourceVideoUrl` + `sourceVideoUrlExpiresInSeconds`, `presentation{subtitle{displayMode,layers[]},audio{...}}`,
     `effective{boxMode,ownedByStyle,resolvedLinePercent,deadControls[]}` (projection do backend tính).
   - `UpdateRenderConfigRequest`: các trường ở trên (kiểu wrapper, null = giữ nguyên) + `presentation`.
   - Validate enum (`ORIGINAL|16:9|9:16|1:1|4:3`, `HARD_SUB|SOFT_SUB`, `SENTENCE|PHRASE|WORD`), khoảng số
     (`widthPercent` 20..100, `heightPercent` 5..50, `xPercent/yPercent` 0..100, `opacity` 0..1), định dạng màu hex →
     sai thì `VALIDATION_ERROR`.
3. Service đọc/ghi JSONB qua `ObjectMapper`; PUT khi stage `RENDER` đã COMPLETED → đánh dấu `RENDER` là `STALE`.
   `sourceVideoUrl` dùng `MediaStorageService.presignedGetUrl` (đã có từ nhánh 1, ký theo public endpoint), TTL 3600.
   `confirmed` lấy từ checkpoint `PUBLISH_CONFIRMED`. `effective` chỉ tính từ dữ liệu đã lưu, không lưu vào DB.
4. `rerun-render`: gọi lại logic rerun-from-stage hiện có cho `RENDER` (khoá job `FOR UPDATE`, kiểm tra stage trước
   `COMPLETED`/`SKIPPED` → `STALE`/`STAGE_NOT_READY`); **không** copy logic, tái dùng `rerunFromStage`.
5. Đảm bảo pipeline RENDER (worker payload) đọc đúng cấu hình này — kiểm tra chỗ build payload gửi `backend-media-worker`
   (worker hỗ trợ reframe/blur-pad/cover layers/ducking chưa? nếu chưa, ghi rõ phần thiếu ở worker).
6. Cập nhật `API_Contract.md` (endpoint `render-config`, `rerun-render` và DTO); FE dùng field camelCase như trên.

**Cách kiểm tra:**
- Test: PUT rồi GET trả đúng giá trị; giá trị enum/khoảng số/màu sai → 400; job đã render → RENDER thành STALE;
  PUT một phần (field null) giữ nguyên field cũ; `rerun-render` khi stage trước chưa xong → 409 `STAGE_NOT_READY`;
  MEMBER không phải chủ job / CLIENT → 403.
- Thủ công: đổi `outputAspectRatio=9:16`, thêm 2 cover layer, `POST rerun-render` → 202, chờ RENDER xong, xác nhận video
  đúng tỉ lệ và có lớp phủ; `sourceVideoUrl` mở được; job mới chưa cấu hình → GET trả mặc định (không lỗi/null).

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
- **Phạm vi hiện hành:** Platform Admin đã được chốt trong MVP tại `SRS.md` §5.8 và
  `System_Architecture.md` §11.1 (file `AGENTS.md` không tồn tại trong repo — sửa tham chiếu);
  đây là cờ quyền cấp hệ thống, không phải role Workspace.
- **Endpoint (chỉ user có `isPlatformAdmin = true`):**
  1. `GET /api/platform/overview?from=&to=&topLimit=` — 6 KPI: số User, Workspace, phân loại Job, token AI theo tác vụ,
     `failRate`, top workspace tiêu thụ.
  2. `GET /api/platform/status` — health của PostgreSQL, Redis, RabbitMQ, MinIO, FastAPI (bỏ "Celery" vì kiến trúc này
     không dùng Celery — chỉ liệt kê thành phần thực sự có).
  3. `GET /api/platform/users?page=&size=&q=&isPlatformAdmin=`
  4. `GET /api/platform/workspaces?page=&size=&q=`
  5. `GET /api/platform/audit-logs?page=&size=&action=`

**Cần thay đổi:**
1. `users.is_platform_admin BOOLEAN NOT NULL DEFAULT false` nằm trong baseline
   `V1__init_tables.sql`; đưa cờ vào response auth và luôn kiểm tra lại từ DB cho `/api/platform/*`.
2. Bảng `audit_logs` chưa có (kiểm tra) → migration + ghi log ở các thao tác admin; cập nhật `Database_Design.md`.
3. `PlatformController` + `PlatformService`, guard `@PreAuthorize`/kiểm tra ở tầng service (không chỉ ẩn UI).
4. Truy vấn tổng hợp dùng `ai_usage_logs`, `media_jobs`; **bắt buộc phân trang và có index**, tránh full scan.
5. Tham khảo `PlatformController` ở `../transflow` (chỉ lấy phần khớp).
6. Giữ `SRS.md`, `System_Architecture.md`, `Database_Design.md`, `API_Contract.md`, `CLAUDE.md` nhất quán.

**Cách kiểm tra:**
- Test: user thường gọi → 403; admin gọi → 200; phân trang/`q` hoạt động; `failRate` tính đúng trên dữ liệu mẫu;
  `status` báo DOWN khi tắt thử Redis/RabbitMQ.
- Thủ công: đăng nhập tài khoản admin, mở `/platform/*` trên FE với BE thật, các số liệu khớp truy vấn SQL tay.

**Đã triển khai (nhánh `feature/backend-java/platform-admin-api` — xem chi tiết trong
`BACKEND_MISSING_TASKS_MEMBER_A.md` mục 9):** module `com.app.modules.platform` đầy đủ (service/impl,
entity `@Immutable` đọc chéo, audit filter sau `JwtAuthFilter`, seed runner `PLATFORM_ADMIN_EMAILS`),
migration `V4__platform_admin_audit_logs.sql`, `/overview` jobs = `mediaJobs`+`batchJobs` (+ marker
`{"available": false}` cho `textJobs`/`productionJobs`), `/status` probe 6 service song song.
Đã cập nhật `API_Contract.md` §13.1, `Database_Design.md` §3.1/§13, `System_Architecture.md` §11.1,
`CLAUDE.md` §3/§4.2/§4.8.

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

## 11. Gói phân phối đầu ra — `/output-package` & `/publish-package` (MỚI theo plan v2)

- **Nhánh:** `feature/media-job-output-publish-package`
- **Ưu tiên:** 🔴 (modal Quick Preview và phần đăng bài của FE phụ thuộc).
- **Endpoint:**
  - `GET /api/workspaces/{workspaceId}/media/jobs/{jobId}/output-package` — LEAD/MEMBER/CLIENT (có quyền project).
  - `GET /api/workspaces/{workspaceId}/media/jobs/{jobId}/publish-package` — LEAD/MEMBER/CLIENT.
  - `PUT /api/workspaces/{workspaceId}/media/jobs/{jobId}/publish-package` — job-ownership (LEAD mọi job; MEMBER chỉ job
    mình; CLIENT bị chặn).
- **Hiện trạng:** chưa có controller; **chưa có nơi lưu** metadata đăng bài trong DB (`Database_Design.md` không có bảng/cột).
  `API_Contract.md` §15 đã nhắc `QA_BLOCKED` áp dụng cho "publish-package".

**Response `output-package`** (theo plan §6.1): `{ jobId, primaryVideoDownloadUrl, audioTracks:[{role, storageRef}],
subtitleTracks:[{format, language, available}], durationMs }`.
**Body `publish-package`** (plan §6.4): `{ title, description, tags[], language }`; GET trả cùng shape (rỗng/mặc định nếu chưa lưu).

**Cần thay đổi:**
1. **Lưu trữ:** thêm cột `media_jobs.publish_package JSONB` (migration `V7__…`, không sửa file cũ) — gọn hơn bảng mới vì 1 job
   ↔ 1 bản nháp; cập nhật `Database_Design.md` và entity `MediaJob`. (Phương án khác: bảng `media_job_publish_packages`;
   chọn cột JSONB trừ khi cần lịch sử.)
2. DTO: `OutputPackageResponse` (+ `AudioTrack`, `SubtitleTrack`), `PublishPackageRequest/Response` với validation:
   `title` bắt buộc ≤ 100 ký tự, `description` ≤ 5000, `tags` tối đa ~30 mục mỗi mục ≤ 50, `language` là mã ngôn ngữ hỗ trợ
   (giới hạn cụ thể đưa vào config, ghi vào contract).
3. Service `MediaPackageService` (trong `media_job`, interface + impl):
   - `output-package`: job phải có stage `RENDER` `COMPLETED` (nếu không → `STAGE_NOT_READY`); **không** áp QA gate (để xem
     preview); video URL dùng `presignedGetUrl` từ nhánh 1 (đã ký theo public endpoint); `audioTracks` lấy từ `output_ref` của
     stage `TTS` (giọng lồng tiếng) và `AUDIO_MIX`/nhạc nền nếu có — bỏ qua track không tồn tại (job giữ âm thanh gốc);
     `subtitleTracks`: SRT/VTT `available=true` khi có `subtitle_segments`, `language` = `target_lang` của job;
     `durationMs` từ asset đầu ra/asset gốc.
   - `publish-package` GET/PUT: đọc/ghi JSONB qua `ObjectMapper`; PUT kiểm tra ownership.
   - **QA gate cho PUT `publish-package`** theo `API_Contract.md` (§15 `QA_BLOCKED`): còn issue chưa resolve có
     `BLOCK_PUBLISH` → `403 QA_BLOCKED`, dùng đúng hàm kiểm tra của `MediaExportService` (nhánh 1) — tách hàm dùng chung
     thay vì lặp lại. **Cần xác nhận**: chặn cả việc lưu bản nháp, hay chỉ chặn bước "xuất bản" thực sự?
     (mặc định: chặn PUT theo contract.)
4. **Rò rỉ đường dẫn nội bộ:** plan trả `storageRef` thô (`audio/tts_vi.wav`). Khuyến nghị trả presigned `downloadUrl` cho từng
   track thay vì (hoặc kèm) ref thô; **cần xác nhận với FE** trước khi chốt shape.
5. Cập nhật `API_Contract.md` (3 endpoint + shape + mã lỗi), báo FE nếu shape khác plan.
6. Liên quan mục 1: nếu FE đã dùng `format=SRT|VTT` cho export, làm luôn phần bổ sung `SRT|VTT` ở nhánh này hoặc nhánh 1.

**Cách kiểm tra:**
- Test: `output-package` job chưa render xong → 409 `STAGE_NOT_READY`; job giữ âm thanh gốc → không có `audioTracks`
  lồng tiếng, `subtitleTracks` đủ SRT/VTT; CLIENT đọc được; `publish-package` PUT rồi GET trả đúng, validate title rỗng/quá dài/
  quá nhiều tag → 400; MEMBER sửa job người khác/CLIENT → 403; còn issue `BLOCK_PUBLISH` → 403 `QA_BLOCKED`, sau override → 200.
- Thủ công: mở Quick Preview trên FE phát được video kèm phụ đề; lưu bản nháp, F5 vẫn còn; `downloadUrl` mở được từ trình duyệt.

---

## 12. Thứ tự đề xuất & phụ thuộc & phân công

| Thứ tự | Người | Nhánh | Phụ thuộc |
|---|:-:|---|---|
| 1 | B | `feature/media-job-export` | tạo `presignedGetUrl` dùng chung |
| 2 | B | `feature/media-job-segments-batch-edit` | — |
| 3 | B | `feature/media-job-render-config` | nhánh 1 (`presignedGetUrl` cho `sourceVideoUrl`); cùng `MediaJobController` với 2, 6, 11: merge tuần tự để tránh conflict |
| 4 | B | `feature/media-subtitle-styles` | — |
| 5 | B | `feature/media-library-bulk-download` | nhánh 1 (presigned URL + quality gate dùng chung) |
| 6 | B | `feature/media-job-override-source-lang` | — |
| 7 | A | `feature/tts-voice-preview` | — |
| 8 | A | `feature/auth-forgot-password-otp` | — |
| 10 | A | `feature/transformation-capabilities` | — (làm trước 9: health-check dùng chung) |
| 9 | A | `feature/platform-admin-api` | sau mục 10; sửa cả docs phạm vi |
| 11 | B | `feature/media-job-output-publish-package` | nhánh 1 (presign + quality gate dùng chung); migration `V7` cần thống nhất số với các nhánh khác |

**Lưu ý phối hợp A ↔ B:**
- Migration Flyway: số `V7`, `V8`… **do 2 người thống nhất trước** (ai cần migration trước thì lấy số tiếp theo), tránh trùng version.
- `common/` (ErrorCode dải mã, `AppProperties`, `.env.example`): chỉ thêm, không đổi có sẵn; báo người còn lại khi sửa.
- `pom.xml`: thêm dependency vào block của mình (`CLAUDE.md` §4.9).
- `MediaStorageService.presignedGetUrl` (B, nhánh 1) dùng chung với `/voices/preview` (A, mục 7): A chờ nhánh 1 merge hoặc
  rebase lên nó.

Chưa cần làm: mục 3.1–3.3 của plan gốc (Vite proxy, CORS, MinIO config) là cấu hình tích hợp, thực hiện khi bật BE thật
trên FE — kiểm tra riêng ở Phase 1 của checklist tích hợp.

---

## 13. Checklist theo dõi tiến độ

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
| 9 | `feature/backend-java/platform-admin-api` | [x] | [x] | [ ] | [x] |     [ ]     |
| 10 | `feature/transformation-capabilities` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 11 | `feature/media-job-output-publish-package` | [ ] | [ ] | [ ] | [ ] |     [ ]     |

**Việc cần chốt của các mục mới (v2):**
- [ ] Mục 1: bổ sung `format=SRT|VTT` cho `/export` (giữ `SUBTITLE` làm alias) và cập nhật contract.
- [ ] Mục 3: xác nhận worker hỗ trợ reframe/blur-pad/cover layers/ducking; DTO `render-config` v2 báo FE.
- [x] Mục 10: `capabilities` cần JWT hay public; quy tắc `FAST`/`STUDIO` available; có validate `requestedMode` khi tạo job không.
  → **Đã chốt**: JWT bắt buộc; `FAST` ⇔ ai+worker healthy, `STUDIO` ⇔ FAST + `separation.engine` hợp lệ (bỏ qua `gpu_available`);
  KHÔNG validate `requestedMode` (FE tự guard). Chi tiết: `BACKEND_MISSING_TASKS_MEMBER_A.md` mục 10 "Ghi chú đã làm".
- [x] Mục 10: thêm biến `MEDIA_WORKER_URL` (`.env.example` + compose). → Đã thêm (`app.media-worker.base-url` qua `@Value`).
- [ ] Mục 11: cột `media_jobs.publish_package` (V7) và cập nhật `Database_Design.md`; QA gate chặn PUT hay chỉ bước xuất bản;
      `audioTracks` trả presigned URL hay `storageRef` thô.
- [ ] Migration V7/V8: A và B thống nhất số version trước khi tạo.
