# Backend Java — Phân việc Thành viên B: Media Studio Pipeline

> Bám sát `API_Contract.md`, `docs/SRS.md` 1.4b, `System_Architecture.md` 3.3, `Database_Design.md` 3.3,
> `api-response-convention.md`. Trước khi code: đọc 5 tài liệu trên + khảo sát `../transflow/backend-main`
> theo đúng CLAUDE.md §4, và nắm rõ cách chia module package ở CLAUDE.md §4.8, quy ước response/lỗi ở
> CLAUDE.md §4.10.
> **Cảnh báo riêng cho phần này**: `MediaController`/`MediaSummaryService`/`MediaJobResponse` gốc trong
> `transflow` đã bị "nhiễm" rất nặng bởi các lớp legacy (Content-Transformation CT0-CT5, W0/W1 workflow,
> `documentId`, ADR-CEP B-series, `recipeId` gồm cả `summary.extractive/summary.generative` không tồn tại
> trong `transflow_mini`). **Không copy nguyên `MediaController`/`MediaJobResponse`/`CreateMediaJobRequest`
> của bản gốc.** Chỉ lấy phần logic nghiệp vụ cốt lõi (tạo job, stage machine, rerun-from-stage, proposal),
> viết lại DTO sạch theo đúng field trong `Database_Design.md` §6–§8.

## 1. Phạm vi phụ trách

Đây là 2 luồng sản phẩm chính của Media Studio, phụ thuộc vào các service nền tảng do Thành viên A cung
cấp (xem §4 dưới).

**Chia module theo `CLAUDE.md` §4.8** — mỗi package `com.app.modules.<name>` chỉ chứa đúng 1 nhóm bảng dưới
đây, không truy cập trực tiếp `repository`/`entity` của module do A phụ trách (§4.8 "Quy tắc biên module");
gọi qua interface ở §4 thay vì tự viết lại.

| Module (package) | API_Contract.md | Bảng DB sở hữu |
|---|---|---|
| `media_asset` — Media Asset & Consent | §4 | `media_assets`, `media_consents`, `terms_versions` |
| `media_job` — Media Job orchestrator (Localization + Summarization) + callback (subpackage `media_job.callback`) | §5, §14 | `media_jobs`, `media_job_stages`, `subtitle_segments` |
| `summarization` — Summarization proposal & refine | §5.1 | `summary_proposals`, `summary_proposal_segments` |
| `batch` — Video Batch Localization | §6 | `localization_batches` |
| `glossary` — Glossary | §7 | `glossaries`, `glossary_terms` |
| `qa` — QA | §8 | `qa_issues`, `qa_issue_overrides` |
| Ghi log usage AI | (thuộc module `media_job`, cho A đọc ở `dashboard`) | `ai_usage_logs` |

Code dùng chung cả 2 module trở lên (`BaseEntity`, `ApiResponse`/`ErrorCode`/`AppException`/
`GlobalExceptionHandler`, JWT filter, HMAC/AES-GCM util, pagination helper) đặt trong package
`com.app.common` — sửa file trong đó phải báo trước cho A.

**Dải mã lỗi (`ErrorCode`) của Thành viên B** — theo `API_Contract.md` §15.2, chỉ thêm mã mới trong đúng
dải của module đang code, cập nhật đồng thời bảng §15.3: `media_asset` 2800–2899 (đã dùng
`TERMS_NOT_ACCEPTED`=2800), `media_job` 2900–2999 (đã dùng `VOICE_LANGUAGE_MISMATCH`=2900,
`JOB_OWNERSHIP_REQUIRED`=2901, `STAGE_NOT_READY`=2902), `summarization` 3000–3099 (đã dùng
`REFINE_LIMIT_REACHED`=3000), `batch` 3100–3199 (đã dùng `BATCH_SIZE_EXCEEDED`=3100), `glossary`
3200–3299, `qa` 3300–3399 (đã dùng `QA_BLOCKED`=3300, `OVERRIDE_NOT_ALLOWED`=3301).

## 2. Việc cần làm theo từng module

### 2.1 Media Asset & Consent
- Copy phần upload/consent trong `MediaController` gốc (`upload`, `currentTermsVersion`, `consent`) —
  đây là phần "sạch" nhất, ít dính legacy.
- Entity theo `Database_Design.md` §6: `MediaAsset` (bỏ liên kết `documentId`/`Document` — root asset là
  entry point trực tiếp), `MediaConsent`.
- Validate `file_size_bytes ≤ 500MB`, `duration_ms ≤ 1800000` (SRS §6) — enforce ở service, không chỉ CHECK
  DB, để trả lỗi rõ ràng cho FE.
- Gọi `A.terms_versions.getCurrentVersion()` khi trả `GET .../media/terms-version` và khi validate consent.

### 2.2 Media Job — orchestrator (phần nặng nhất)
- **Viết mới** entity `MediaJob` theo đúng `Database_Design.md` §6.2 (bỏ toàn bộ field CT/W0/ADR-CEP của
  bản gốc: không có `documentId`, `translationJobId`, `strategySnapshot`, `activePlanKind/Status`,
  `goalType`, `domainPhase`, `workflowCheckpoints` object phức tạp — chỉ giữ field thật sự có trong schema
  mini: `recipe_id`, `processing_mode`, `target_lang`, `status`, `selected_proposal_id`,
  `source_summary_job_id`, `subtitle_mode`, `output_audio_mode`, `source_separation_enabled`,
  `tts_voice_id`, `visual_context_enabled`, `preset_id`, `preset_snapshot`, `workflow_mode`,
  `performed_by_user_id`, `created_by_user_id`).
- `created_by_user_id` **immutable sau khi tạo** — enforce ở service layer, đây là cột trung tâm cho toàn
  bộ authorization QA/checkpoint (SRS §3.3). Không suy ra quyền từ nơi khác.
- Copy khung stage-machine (8 stage `EXTRACT_AUDIO→...→RENDER`, trạng thái
  `PENDING/PROCESSING/COMPLETED/FAILED/STALE/SKIPPED/CANCEL_REQUESTED/CANCELLED`) từ `MediaJobStage`/
  orchestrator service gốc — phần state machine này tái sử dụng được, không đổi bản chất.
- Điều kiện kích hoạt stage (Arch §5.7, DB §6.3 note): `SOURCE_SEPARATION` khi
  `source_separation_enabled=true`; `AUDIO_MIX` khi `output_audio_mode=DUB_MIX`; `SUMMARIZE` khi
  (`localization.full`+`HYBRID`) hoặc (`summary.script_match`+`source_summary_job_id IS NULL`).
- Rerun-from-stage: set stage được chọn + mọi stage sau về `PENDING`, giữ output stage trước (không tính
  lại Credit) — chỉ cho phép nếu mọi stage trước `COMPLETED/SKIPPED` (ném `AppException(ErrorCode.
  STAGE_NOT_READY)`, code 2902, HTTP 409 nếu không — API_Contract §15.3).
- Checkpoint (`CUT_CONFIRMED/REVIEW_CONFIRMED/PUBLISH_CONFIRMED`) lưu trong `media_job_stages.input_ref`
  JSONB của stage sở hữu — chỉ có ý nghĩa khi `workflow_mode=MANUAL`.
- **Authorization QA/checkpoint** (dùng chung logic, viết 1 hàm duy nhất `requireJobOwnership`):
  ```
  role = A.WorkspaceAccessService.getRole(workspaceId, userId)
  if role == CLIENT: deny
  if role == LEAD: allow
  if role == MEMBER: allow only if userId == job.createdByUserId
  ```
  Áp dụng cho: xác nhận checkpoint (§5), resolve/override QA issue (§8). **Không** áp dụng cho các mutation
  nghiệp vụ khác của job (tạo job, sửa subtitle, chọn voice, select proposal, refine...) — những hành động
  đó chỉ cần `A.WorkspaceAccessService.requireProjectWriteAccess` (Member có đầy đủ quyền trong Project
  được gán, không giới hạn theo người tạo — SRS §3.2).
- Gọi FastAPI (`backend-ai`) đồng bộ cho STT/TRANSLATE/TTS/SUMMARIZE/VISION: dùng
  `A.ProviderResolverService.resolveForCapability(...)` trước mỗi lời gọi, sau khi có kết quả (token dùng)
  gọi `A.CreditService.chargeUsage(...)` **và** ghi 1 dòng `ai_usage_logs`.
- Khi tạo job: gọi `A.PresetResolverService.resolveForJobCreation(...)` để snapshot vào `preset_snapshot`;
  gọi `A.CreditService.hasSufficientBalance(...)` trước khi tạo (mặc định `BLOCK_UPFRONT`) — nếu không đủ, A
  ném `AppException(ErrorCode.INSUFFICIENT_CREDIT)` (code 2300, HTTP 402, thuộc dải module `credit`).
- Voice: từ chối rõ ràng bằng `AppException(ErrorCode.VOICE_LANGUAGE_MISMATCH)` (code 2900, HTTP 400) nếu
  `tts_voices.language ≠ target_lang` — không fallback ngầm.
- Sửa subtitle sau khi đã qua TTS/RENDER → set stage sau `STALE`, không tự rerun (SRS §5.3).
- Khi job/batch đổi trạng thái quan trọng (COMPLETED/FAILED/cần chạy lại) → gọi
  `A.NotificationService.notify(...)`.

### 2.3 Summarization — proposal & refine
- Entity `SummaryProposal`, `SummaryProposalSegment` theo `Database_Design.md` §7 — **script-first**:
  `generated_by IN (AI, HUMAN)`; nếu `AI` có `script_content/script_language/confidence`; nếu `HUMAN`
  (Custom Proposal) các field đó `NULL` (constraint `ck_proposal_origin_fields`).
- AI proposal: gọi FastAPI `summarize/script` (transcript + [visual_context] + requestedDuration +
  targetLang) → nhận `{script_content, segments[...], reasoning, confidence, warnings}` → validate (script
  không rỗng, mỗi segment khớp 1 phần script, tổng thời lượng trong dung sai) trước khi lưu.
- Refine: tối đa **5 lần/phiên**, phiên lưu Redis (TTL) — không phải bảng SQL. Mỗi lần refine tạo
  `generation_round` mới (`UNIQUE(media_job_stage_id, generation_round) WHERE generated_by=AI`).
- Custom Proposal không bị archive khi có đề xuất AI mới; không qua bước AI soạn kịch bản; phụ đề dịch sát
  nghĩa dùng chung cơ chế TRANSLATE (khác AI proposal, nơi phụ đề = chính script đã soạn).
- Tóm tắt thêm ngôn ngữ (`POST .../summary-languages`): chỉ khi phương án chọn là AI; tạo `media_jobs` mới
  với `source_summary_job_id`, `SUMMARIZE=SKIPPED`, giữ nguyên đoạn đã chọn, chỉ chạy
  TRANSLATE(script)→TTS(tuỳ chọn)→RENDER.

### 2.4 Video Batch Localization
- Entity `LocalizationBatch` theo `Database_Design.md` §6.1 — **`target_lang` là scalar**, không phải
  mảng (khác biệt quan trọng so với thiết kế cũ, đọc kỹ CHECK constraint và ghi chú "không copy nguyên").
- Copy khung `BatchService`/`BatchStatusService`/`BatchCreateRateLimiter` gốc **nhưng bỏ vòng lặp theo
  nhiều ngôn ngữ** nếu code gốc có (bản gốc lặp N video × M ngôn ngữ; mini chỉ N video × 1 ngôn ngữ).
- Tạo batch → tạo N `media_jobs` con cùng transaction, mỗi job `target_lang` = đúng giá trị của batch cha,
  `batch_id` FK. Giới hạn 1..20 video/lô (CHECK DB + validate service).
- Tổng hợp trạng thái batch (`PENDING/PROCESSING/PARTIALLY_FAILED/COMPLETED/FAILED/CANCELLED`) tính lại ở
  service layer, **cùng transaction** với update job con, **`SELECT ... FOR UPDATE`** trên các job con liên
  quan (Arch §12 invariant khoá ghi). `PARTIALLY_FAILED` chỉ tồn tại ở cấp Batch, không phải giá trị của
  `media_jobs.status`.

### 2.5 Glossary
- Copy `GlossaryController`/`GlossaryService`/entity `Glossary`, `GlossaryTerm` — **giữ nguyên gần như
  100%**, chỉ đổi route thành theo Project (`UNIQUE(project_id)`, không còn nhiều glossary/workspace như
  bản gốc nếu bản gốc cho phép nhiều glossary/workspace).
- Không có Translation Memory — dịch chỉ dùng context hiện tại + Glossary + provider AI, không lookup câu
  dịch cũ.

### 2.6 QA
- Entity `QaIssue`, `QaIssueOverride` theo `Database_Design.md` §8.3. `blocking_actions` chỉ còn
  `BLOCK_APPROVAL|BLOCK_PUBLISH|BLOCK_RENDER` (đổi tên `BLOCK_EXPORT`→`BLOCK_PUBLISH`, **bỏ**
  `BLOCK_TM_WRITEBACK`).
- QA issue được sinh tự động trong pipeline (sau TRANSLATE/SUMMARIZE) — không có endpoint "chạy QA" thủ
  công, không copy `QaController.check` cũ nếu nó thuộc luồng TM/Document.
- Override: dùng `requireJobOwnership` (§2.2); một số `issue_type` đặc biệt nghiêm trọng (vd
  `subtitle_overlap` CRITICAL) chặn insert override ở service layer — không ai override được, kể cả Lead.
- `reason` override bắt buộc ≥10 ký tự (CHECK DB), luôn lưu vết.

### 2.7 Callback nội bộ Worker → Spring
- Copy `MediaRenderCallbackController`, `MediaAudioMixCallbackController` — giữ nguyên cơ chế HMAC-SHA256
  (`X-Signature`+`X-Timestamp`, lệch ±5 phút từ chối) và idempotent theo `dedupeKey`.
- Viết thêm 2 callback tương tự cho `EXTRACT_AUDIO`/`SOURCE_SEPARATION` (worker FFmpeg xử lý, chưa có
  controller sẵn trong bản gốc — viết mới theo đúng cùng contract).
- Mọi mutation trạng thái job trong callback phải `SELECT ... FOR UPDATE` trên `media_jobs` trong cùng
  transaction (Arch §12).

## 3. Migration do B phụ trách (tiếp theo migration của A — thống nhất thứ tự file với A)
6. `media_assets` → `media_consents`.
7. `media_jobs` + `media_job_stages` (phá vòng lặp FK `selected_proposal_id` ↔ `summary_proposals`: tạo
   `media_jobs`/`media_job_stages` trước, `summary_proposals`+`summary_proposal_segments` sau, rồi
   `ALTER TABLE media_jobs ADD CONSTRAINT` FK `selected_proposal_id`).
8. `subtitle_segments`, `qa_issues`, `qa_issue_overrides`, `glossaries`, `glossary_terms`, `ai_usage_logs`.
9. `localization_batches` (đặt trước `media_jobs` nếu FK `media_jobs.batch_id` yêu cầu — đối chiếu thứ tự
   thật khi viết migration, `Database_Design.md` §13 liệt `media_presets, localization_batches` ở bước 5
   nhưng bảng này B sở hữu về nghiệp vụ — phối hợp với A ai chạy migration bước đó).
- Không tạo `documents`, Text `translation_jobs`, Batch dịch file, `translation_memory`.

## 4. Interface cần Thành viên A cung cấp trước (đọc kỹ trước khi code Media Job)

| Cần từ A | Dùng ở |
|---|---|
| `WorkspaceAccessService.requireProjectAccess/WriteAccess`, `getRole` | Mọi controller ở §4–§8 (auth theo Project + role) |
| `CreditService.chargeUsage(...)`, `hasSufficientBalance(...)` | Sau mỗi lời gọi FastAPI; trước khi tạo job |
| `ProviderResolverService.resolveForCapability(...)` | Trước mỗi lời gọi FastAPI (STT/TRANSLATE/TTS/SUMMARIZE/VISION) |
| `PresetResolverService.resolveForJobCreation(...)` | Lúc tạo `media_jobs` |
| `NotificationService.notify(...)` | Khi job/batch đổi trạng thái |
| `terms_versions.getCurrentVersion()` | Media Asset consent |

Nếu A chưa xong implementation đầy đủ, **mock các interface này** (trả giá trị cố định/no-op) để không bị
block — chỉ cần signature đã thống nhất.

## 5. Không làm (ngoài phạm vi — xem CLAUDE.md §3, §4.7)
- Không tạo `DocumentController`, `TranslateController`, `TmController`, `TransformationController`,
  `TransformationCapabilitiesController` hay entity `Document`/`TranslationJob`/`TranslationSegment`/
  `TranslationHistory`/`TranslationMemory` — loại bỏ hoàn toàn.
- Không copy nguyên `documentId` field ở bất kỳ DTO/entity nào của Media Job — schema mini không có
  `documents`, `media_assets` là entry point trực tiếp.
- Không thêm lại `target_langs` (mảng) cho batch, không thêm giới hạn "N ngôn ngữ/lô".
- Không thêm `BLOCK_TM_WRITEBACK`, không thêm Translation Memory/embedding/pgvector.
- Không đụng Auth/Workspace/Project/Credit/BYOK/Preset/Notification controller (A phụ trách).

## 6. Checklist hoàn thành
- [ ] Upload asset (giới hạn 500MB/30 phút) + consent theo terms_version hiện hành.
- [ ] Tạo Media Job (Localization + Summarization) với đúng field schema mini, `created_by_user_id`
      immutable, credit check trước khi tạo, preset snapshot.
- [ ] Stage machine 8 stage đúng điều kiện skip; rerun-from-stage đúng luật; checkpoint theo job-ownership.
- [ ] Summarization: AI proposal script-first, Custom Proposal, refine ≤5 lần/phiên (Redis TTL), tóm tắt
      thêm ngôn ngữ giữ nguyên đoạn đã chọn.
- [ ] Batch: 1..20 video, 1 target_lang/lô, PARTIALLY_FAILED chỉ ở cấp batch, retry job con riêng lẻ.
- [ ] Glossary theo Project; QA issues tự sinh + override theo job-ownership + issue không bao giờ override
      được.
- [ ] Callback HMAC cho cả 4 stage FFmpeg (EXTRACT_AUDIO, SOURCE_SEPARATION, AUDIO_MIX, RENDER), idempotent.
- [ ] Ghi `ai_usage_logs` đầy đủ để Dashboard (A) đọc được.
- [ ] Mọi controller trả `ApiResponse<T>`, mọi lỗi nghiệp vụ ném qua `AppException(ErrorCode.XXX)` với code
      trong đúng dải của module (CLAUDE.md §4.10), không tự tạo response/exception riêng.

## 7. Ghi chú kiểm thử (cập nhật khi làm 2.1 Media Asset + 2.2 Media Job)

Phần dưới đây ghi lại **những gì đã thực sự verify** và **những gì còn thiếu**, để người làm tiếp (2.3–2.7,
hoặc review) không phải đoán lại. Cập nhật section này mỗi khi có một vòng test lớn mới (unit/integration/
real-infra), không chỉ dựa vào "test pass" trong CI để kết luận đã xong.

### 7.1 Đã kiểm thử — 2.1 Media Asset & Consent
- Unit test (`MediaAssetServiceImplTest`, Mockito) + integration test (`MediaAssetControllerTest`, MockMvc +
  H2): upload (Lead/Member có assignment thành công; Member không assignment / Client bị 403; file >500MB;
  duration >30 phút; duration null vẫn cho qua), `terms-version`, list/get, consent (tạo mới, idempotent,
  version lệch, asset không phải root).
- **Real-infra smoke test** (Postgres 16 + Redis 7 + MinIO thật qua Docker, `mvn spring-boot:run`, gọi bằng
  `curl` — không qua MockMvc/H2): xác nhận lại toàn bộ các case trên bằng dữ liệu thật, cụ thể:
  - Flyway migrate + Hibernate `ddl-auto=validate` pass trên schema Postgres thật (không chỉ H2).
  - Upload file MP4 thật (dựng bằng `ffmpeg`, 2 giây) qua multipart HTTP thật → lưu đúng object vào MinIO
    thật (verify bằng `mc ls`) + `ffprobe` thật trả `durationMs=2000` khớp chính xác.
  - Member có project assignment: list + upload thành công (201); Member không assignment: 403.
  - Client: đọc list/get asset được (200), nhưng upload/consent bị chặn (403) — đúng ma trận quyền Arch §4.3.
  - Lead consent thành công (201), asset dùng được ngay để tạo Media Job (xem 7.2).
- **Kết luận:** 2.1 đã test hoàn thiện cả ở mức logic (unit/integration) lẫn hạ tầng thật (Postgres/MinIO
  thật), không còn khoảng hở đáng kể trong phạm vi API_Contract.md §4.

### 7.2 Đã kiểm thử — 2.2 Media Job (orchestrator skeleton)
- Unit test (`MediaJobServiceImplTest`, 19 case) + integration test (`MediaJobControllerTest`, 17 case):
  tạo job (đủ constraint `ck_job_recipe_mode`/`ck_audio_mode_sep`/`ck_audio_mode_voice`, thiếu credit, thiếu
  consent, voice sai ngôn ngữ), stage-skip logic đúng theo `sourceSeparationEnabled`/`processingMode`/
  `outputAudioMode`, list/get, cancel, rerun-from-stage (409 khi chưa sẵn sàng, giữ nguyên stage `SKIPPED`
  khi rerun), checkpoint theo job-ownership (Lead mọi job / Member chỉ job của mình / Client bị chặn), sửa
  subtitle cascade `STALE` sau `TTS`/`RENDER`.
- **Real-infra smoke test** (cùng bộ Postgres/Redis/MinIO ở 7.1): xác nhận lại bằng `curl` + kiểm tra trực
  tiếp bằng `psql`:
  - Cột JSONB (`preset_snapshot`, `input_ref`) map đúng `jsonb` thật (`@JdbcTypeCode(SqlTypes.JSON)` — đây
    là rủi ro lớn nhất giữa H2 và Postgres, đã loại bỏ).
  - Tạo job từ asset thật (upload+consent thật ở 7.1) → 8 stage được ghi đúng trạng thái `SKIPPED`/`PENDING`.
  - Checkpoint confirm ghi đúng JSON vào `input_ref` của stage `TRANSLATE`.
  - Rerun-from-stage: 409 khi stage trước chưa `COMPLETED`; 200 + reset đúng sau khi update `COMPLETED` trực
    tiếp bằng SQL (mô phỏng worker).
  - Voice ngôn ngữ lệch (`fr` voice trên `targetLang=en`) → `400 VOICE_LANGUAGE_MISMATCH`; khớp → 201/200.
  - Cancel: stage `PENDING`/`PROCESSING` → `CANCELLED`, stage `COMPLETED`/`SKIPPED` giữ nguyên.
- **Kết luận:** phần orchestrator control-flow (state machine, RBAC, validate) đã test hoàn thiện ở cả 2 mức.
  Đây **không phải** là "pipeline chạy được" — xem 7.3 để biết còn thiếu gì để pipeline thực sự xử lý video.

### 7.3 CHƯA kiểm thử — cần làm ở các phần sau (2.3–2.7) hoặc khi có hạ tầng đầy đủ
| Phần thiếu | Lý do chưa test | Cần gì để test được |
|---|---|---|
| Gọi FastAPI thật cho STT/TRANSLATE/TTS/SUMMARIZE/VISION | Chưa viết HTTP client — không có trong phạm vi 2.2 đã chủ động scope lại, và `backend-ai` chưa expose contract cụ thể trong docs đã đọc | Viết client theo `backend-ai` OpenAPI/route thật, cần `docker compose up` với service `backend-ai` |
| Ghi `ai_usage_logs` + trừ Credit theo `credit_pricing_config` thật | Phụ thuộc mục trên (chỉ có sau khi có lời gọi AI thật); `CreditServiceImpl.chargeUsage` hiện là stub tính giá cứng `0.001/token` | Cần A hoàn thiện `credit_pricing_config` resolver, rồi test tích hợp giữa media_job và credit |
| Callback HMAC từ `backend-media-worker` (EXTRACT_AUDIO/SOURCE_SEPARATION/AUDIO_MIX/RENDER) | Thuộc §2.7, chưa viết controller | Viết `media_job.callback` package theo API_Contract §14, test bằng cách tự ký HMAC giả lập worker |
| RabbitMQ dispatch khi cancel/rerun | Chưa có publisher — cancel/rerun hiện set trạng thái DB trực tiếp, không gửi signal cho worker nào (đã đánh dấu `ponytail:` trong code) | Cần message queue thật + consumer, hoặc ít nhất mock RabbitMQ (Testcontainers) để verify message được publish đúng payload |
| Provider/Preset/Notification thật của Thành viên A | Interface đang là mock/no-op tôi tự viết (`ProviderResolverServiceImpl.resolveForCapability`, `PresetResolverServiceImpl`, `NotificationServiceImpl`) | Khi A merge implementation thật, phải viết lại test tích hợp — hành vi thật có thể khác giả định hiện tại |
| Upload file >500MB thật / video >30 phút thật qua MinIO | Chỉ test qua boundary value ở service layer (mock), chưa thử file thật lớn cỡ đó (tốn thời gian tạo file + băng thông) | Có thể bỏ qua an toàn vì logic validate đã chạy qua unit test — chỉ cần thử 1 lần nếu nghi ngờ MinIO có giới hạn khác |
| Summarization/Batch/Glossary/QA (2.3–2.6) | Ngoài phạm vi buổi làm việc này | Làm theo đúng §2.3–2.6 của tài liệu này |
| Checkpoint→stage mapping (`CUT_CONFIRMED→TRANSLATE`, `REVIEW_CONFIRMED→TTS`, `PUBLISH_CONFIRMED→RENDER`) | Đây là giả định tôi tự chọn (xem comment trong `Checkpoint.java`), không có trong SRS/Arch §14 | Cần BA xác nhận trước khi FE dựa vào mapping này để quyết định dừng ở đâu trong chế độ Manual |

### 7.4 Môi trường dùng để test real-infra (tham khảo khi cần lặp lại)
```
docker run -d --name tfm-postgres -p 55432:5432 -e POSTGRES_DB=transflow_mini -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres postgres:16-alpine
docker run -d --name tfm-redis -p 56379:6379 redis:7-alpine
docker run -d --name tfm-minio -p 59000:9000 -p 59001:9001 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio:latest server /data --console-address ":9001"
```
Lưu ý: image `minio/minio` trên Docker Hub bị từ chối pull trong môi trường này (registry access denied) —
dùng `quay.io/minio/minio` thay thế. Chạy app với `DB_HOST=localhost DB_PORT=55432 ... REDIS_HOST=localhost
REDIS_PORT=56379 MEDIA_STORAGE_ENDPOINT=http://localhost:59000 ...` rồi `./mvnw spring-boot:run`. Nhớ dọn
container (`docker rm -f tfm-postgres tfm-redis tfm-minio`) sau khi test xong — không để hạ tầng test chạy nền.
