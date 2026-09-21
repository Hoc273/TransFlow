# Việc Backend còn thiếu — Thành viên B

> File này là **bản trích** từ `BACKEND_MISSING_TASKS_BY_BRANCH.md` (bản tổng hợp/nguồn) — phần việc giao cho **Thành viên B**: pipeline Media Job (export, sửa phụ đề, render, subtitle style, tải nhiều video, ghi đè ngôn ngữ, output/publish package).
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

---

## 2. Sửa phụ đề hàng loạt — `/segments/batch` — ✅ CODE + TEST + CURL THẬT XONG (2026-09-21), chưa commit

> Đã làm: `PUT .../segments/batch`; tách `lockJobForEdit`/`applyEdit`/`staleDownstreamStages` dùng chung với PATCH đơn lẻ.
> Quyết định của dev: (1) cả batch và PATCH dùng `requireJobOwnership` (**PATCH đơn lẻ đổi hành vi**: MEMBER sửa job người khác → 403);
> (2) tối đa 200 phần tử, cấu hình `app.media-job.max-batch-subtitle-updates` (env `MEDIA_MAX_BATCH_SUBTITLE_UPDATES`);
> `segmentId` trùng → `VALIDATION_ERROR`; `0 <= startMs < endMs` kiểm tra trên giá trị sau merge (áp dụng cả PATCH).
> 310 test xanh (4 test mới ở `MediaJobControllerTest`). Đã cập nhật `API_Contract.md` §5. Đã curl thật (Postgres/MinIO, backend cổng 8081): LEAD 3 segment x2 idempotent, STALE TTS/RENDER + 1 notification, segment lạ/thời gian sai/empty → 400 không đổi gì, MEMBER job người khác + CLIENT → 403, không token → 401. Dữ liệu thử còn lại trong DB: user batch-{lead,member,client}@t.com.

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

---

## 3. Cấu hình dựng hình — `/render-config` — ✅ CODE + TEST + CURL THẬT XONG (2026-09-21), chưa commit

> Đã làm: `GET/PUT render-config`, `POST rerun-render` (202), `MediaRenderConfigService`, DTO ở `media_job.dto.render`.
> **Lệch so với kế hoạch (dev đã duyệt):** `media_jobs` KHÔNG có sẵn cột `render_config` (chỉ `media_presets` có) → thêm
> **migration `V7__media_jobs_render_config.sql`** + cập nhật `Database_Design.md`; `effective` rút gọn (`ownedByStyle=false`,
> `deadControls=[]` cho tới khi làm mục 4); màu/aspect chỉ thay được, chưa xoá về unset (không tri-state).
> `rerun-render` tái dùng `rerunFromStage(RENDER)` nên stage trước RENDER phải COMPLETED/SKIPPED (kể cả TTS `STALE` → 409, phải rerun từ TTS).
> **Mục 5 (worker) — còn thiếu:** mini chưa nối worker/queue dispatch nên chưa có payload để đối chiếu. Worker hiện hỗ trợ
> `outputAspectRatio` và layer `SOLID|BLUR` (tối đa **4** layer, geometry/style riêng) + mix ducking; **chưa** có `COVER_BOX/IMAGE/WATERMARK`
> (API nhận tối đa 10 layer) → khi nối dispatch cần map COVER_BOX→SOLID, và chốt IMAGE/WATERMARK + giới hạn 4 vs 10.
> 315 test xanh (5 test mới); curl thật Postgres: GET mặc định, PUT 2 layer + ducking, PUT một phần giữ field cũ, giá trị sai → 400,
> MEMBER/CLIENT ghi → 403, rerun-render thiếu stage trước → 409 (không lưu config) / đủ → 202 + RENDER PENDING, không token → 401.
> Chưa kiểm chứng: `sourceVideoUrl` với file thật (asset seed là `b/k`, ký lỗi → null), render video thực tế.

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

---

## 4. Phong cách phụ đề — `/media/subtitle-styles` — ✅ CODE + TEST + CURL THẬT XONG (2026-09-21), chưa commit

> Đã làm: 4 endpoint (`SubtitleStyleController`, `SubtitleStyleService`), catalog cố định `resources/subtitle-styles.json` (5 style,
> key `style-classic|style-modern-clean|style-tiktok|style-cinema|style-neon`), migration **V8** thêm `media_jobs.subtitle_style JSONB` (NULL = chưa gán).
> **Lệch kế hoạch (dev đã duyệt):** `media_jobs.subtitle_style` không có sẵn (chỉ `media_presets` có) nên phải migration; route giữ `/api/media/...`
> KHÔNG có `workspaceId` + field **snake_case** để khớp FE hiện có (quyền enforce theo workspace của job); catalog trong code thay vì bảng/seed;
> POST **ghi đè** (không first-write-wins), snapshot đổi + RENDER COMPLETED → STALE, gán lại đúng style cũ là no-op. `ErrorCode` mới:
> `STYLE_NOT_FOUND`=2903 (404), `INVALID_STYLE_KEY`=2904 (400). `render-config.effective.ownedByStyle` giờ = job có style.
> Mục 4 của "Cần thay đổi" (tạo job ghi style mặc định): không cần — cột nullable, chưa gán → GET 404 và FE coi là "chưa chọn".
> **Việc còn lại ở FE:** `useSubtitleStyle.ts` so `error.code === 'STYLE_NOT_FOUND'` nhưng backend trả mã số (`"2903"`) → cần FE chấp nhận `2903`/`2904`
> (hoặc map), nếu không panel sẽ coi "chưa gán style" là lỗi. Chưa sửa FE (ngoài phạm vi backend).
> 319 test xanh (4 mới); curl thật Postgres: list/detail, key sai/không có, GET chưa gán 404, POST → STALE, gán lại cùng style giữ COMPLETED
> (JSONB đổi thứ tự key vẫn so đúng), MEMBER khác chủ/CLIENT 403, không token 401. Chưa kiểm: render ASS thật (mini chưa nối dispatch/worker).

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

---

## 5. Tải video theo lựa chọn (thay cho "tải th eo Batch") — ĐÃ ĐỔI THIẾT KẾ

> **✅ CODE + TEST + CHẠY THẬT XONG (2026-09-21), chưa commit.** Đã làm: `POST /projects/{projectId}/media/jobs/download`
> (`MediaBulkDownloadService`), `MediaStorageService.getMediaObject`, tách `MediaExportService.renderOutputRef` (dùng chung quality gate với `/export`),
> `ErrorCode` `DOWNLOAD_SELECTION_TOO_LARGE`=2905, cấu hình `app.media-job.max-bulk-download` (env `MEDIA_MAX_BULK_DOWNLOAD`, mặc định 20),
> `API_Contract.md` (xoá dòng `/batches/{batchId}/download`, thêm endpoint mới).
> Quyết định của dev: dọn zip tạm bằng **MinIO lifecycle rule** (`docker-compose.yml` › `minio-init`, prefix `tmp/downloads/`, hết hạn 1 ngày, chạy lại không tạo trùng);
> không job nào đạt → `QA_BLOCKED` (có job bị QA chặn) hoặc `STAGE_NOT_READY`. Job không tồn tại/khác project → `skipped` reason `NOT_FOUND`.
> Zip ghi qua file tạm trên đĩa (không giữ trong RAM), không nén (mp4 đã nén), đồng bộ (`ponytail:` — chuyển async nếu quá timeout).
> 322 test xanh (3 mới). Chạy thật Postgres+MinIO: chọn 2 job COMPLETED + pending + QA-blocked + id lạ + trùng → zip đúng 2 file
> (`a_en_22222222.mp4`, `a_vi_33333333.mp4`, nội dung đúng, `testzip` OK), 3 job còn lại vào `skipped` đúng lý do; CLIENT tải được;
> rỗng/>20/không job nào đạt → 400/400/409(2902)/403(3300); không token 401; chữ ký URL sai → 403; file tạm local = 0.
> Lưu ý: project id không tồn tại trong path → 409 (mọi job bị `skipped`), không lộ thông tin; **chưa kiểm** URL hết hạn đúng TTL và lifecycle thực sự xoá sau 1 ngày.
> **Việc còn lại ở FE:** màn lưu trữ gọi list `status=COMPLETED` + `POST .../projects/{projectId}/media/jobs/download`; xoá `downloadBatchZipApi` (`frontend/src/api/batches.ts`).

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

---

## Thứ tự làm & phối hợp — Thành viên B

| Thứ tự | Người | Nhánh | Phụ thuộc |
|---|:-:|---|---|
| 1 | B | `feature/media-job-export` | tạo `presignedGetUrl` dùng chung |
| 2 | B | `feature/media-job-segments-batch-edit` | — |
| 3 | B | `feature/media-job-render-config` | nhánh 1 (`presignedGetUrl` cho `sourceVideoUrl`); cùng `MediaJobController` với 2, 6, 11: merge tuần tự để tránh conflict |
| 4 | B | `feature/media-subtitle-styles` | — |
| 5 | B | `feature/media-library-bulk-download` | nhánh 1 (presigned URL + quality gate dùng chung) |
| 6 | B | `feature/media-job-override-source-lang` | — |
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

## Checklist tiến độ — Thành viên B

Đánh dấu `[x]` khi code xong, test xanh và kiểm tra thủ công đạt (theo mục "Cách kiểm tra").

| # | Nhánh | Code | Test tự động | Kiểm tra thủ công | Cập nhật `API_Contract.md` | Commit / PR |
|---|---|:-:|:-:|:-:|:-:|:-----------:|
| 1 | `feature/media-job-export` | [x] | [x] | [x] | [x] |     [x]     |
| 2 | `feature/media-job-segments-batch-edit` | [x] | [x] | [x] | [x] |     [ ]     |
| 3 | `feature/media-job-render-config` | [x] | [x] | [x] | [x] |     [ ]     |
| 4 | `feature/media-subtitle-styles` | [x] | [x] | [x] | [x] |     [ ]     |
| 5 | `feature/media-library-bulk-download` | [x] | [x] | [x] | [x] |     [ ]     |
| 6 | `feature/media-job-override-source-lang` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
| 11 | `feature/media-job-output-publish-package` | [ ] | [ ] | [ ] | [ ] |     [ ]     |
