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
`REFINE_LIMIT_REACHED`=3000, `PROPOSAL_ALREADY_TRANSLATED`=3001), `batch` 3100–3199 (đã dùng
`BATCH_SIZE_EXCEEDED`=3100), `glossary`
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
  - **Bổ sung sau khi rà lại bảng "chưa test" (§7.8):** upload file thật **501MB** (tạo bằng `dd`) → bị chặn
    thật ở tầng service **trước khi chạm MinIO** (`400 MEDIA_FILE_TOO_LARGE`, ~4.6s, verify bằng `mc ls`
    không có object nào được tạo); encode 2 video thật bằng `ffmpeg` đúng ranh giới 30 phút
    (`d=1790`/29:50 và `d=1810`/30:10, không phải giả lập `ffprobe`) → 29:50 được chấp nhận
    (`durationMs=1790000`), 30:10 bị `400 MEDIA_DURATION_EXCEEDED` — xác nhận ranh giới đúng bằng dữ liệu
    ffprobe thật, không chỉ mock trong unit test.
- **Kết luận:** 2.1 đã test hoàn thiện cả ở mức logic (unit/integration) lẫn hạ tầng thật (Postgres/MinIO
  thật, kể cả 2 boundary case dung lượng/thời lượng bằng file thật), không còn khoảng hở đáng kể trong
  phạm vi API_Contract.md §4.

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
  Đây **không phải** là "pipeline chạy được" — xem 7.8 để biết còn thiếu gì để pipeline thực sự xử lý video.


### 7.3 Đã kiểm thử — 2.3 Summarization — proposal & refine
- Unit test (`SummarizationServiceImplTest`, 16 case) + integration test (`SummarizationControllerTest`,
  9 case) + unit test bổ sung cho `MediaJobServiceImpl.updateSelectedProposal`/`createDerivedSummaryJob`
  (7 case): Custom Proposal CRUD (tạo/sửa, chặn sửa proposal AI, validate segment thứ tự), list active
  proposal (đúng "AI round mới nhất + mọi Custom Proposal" nhờ bất biến "refine luôn archive round AI cũ"),
  select (chặn proposal archived, no-op khi chọn lại chính nó, `409 PROPOSAL_ALREADY_TRANSLATED` khi đổi
  proposal sau khi `TRANSLATE` đã `COMPLETED`), refine (404 khi chưa có proposal AI nào, chặn refine phương
  án đã dùng để dịch, giới hạn 5 lần/phiên qua `RefineSessionStore`, validate script/segment/dung sai thời
  lượng của `generateAiProposal`/`refine`), `summary-languages` (chặn khi chưa chọn phương án hoặc phương án
  là HUMAN, tạo job phái sinh đúng field + đúng stage bị SKIPPED).
- **Real-infra smoke test** (Postgres 16 + Redis 7 thật + MinIO thật qua Docker, `mvn spring-boot:run`,
  gọi bằng `curl`):
  - Cột JSONB (`warnings`, `source_sentence_refs`) map đúng `jsonb` thật; response API trả JSON array thật
    (nhờ `@JsonRawValue`) chứ không phải chuỗi JSON bị escape.
  - Tạo Custom Proposal thật → chọn (`select`) → job thật cập nhật đúng `selected_proposal_id` (xuyên
    module `summarization` → `media_job` qua `MediaJobService.updateSelectedProposal`, verify bằng `psql`).
  - **Redis thật** (không mock) cho refine: gọi `refine` 6 lần liên tiếp qua HTTP thật → lần 1–5 tăng đúng
    counter Redis (`GET summarization:refine:{jobId}` khớp số lần gọi, `TTL` ≈ 1800s), lần 6 trả đúng
    `429 REFINE_LIMIT_REACHED` (code 3000) — xác nhận `RefineSessionStoreImpl` hoạt động đúng với Redis thật,
    không chỉ với mock trong test.
  - `refine` thật sự thất bại ở bước gọi `SummaryAiClient` (500, vì chưa có implementation thật) — đúng như
    dự kiến, không phải lỗi của phần tôi đã build; đã ghi lại ở bảng 7.3.
  - `summary-languages` thật: chọn proposal AI (seed round-1 trực tiếp bằng SQL vì chưa có endpoint sinh AI
    proposal đầu tiên) → tạo job phái sinh `targetLang=vi`, `sourceSummaryJobId` trỏ đúng job gốc,
    `selectedProposalId` copy đúng, 8 stage đúng theo Arch §7.7 (chỉ `TRANSLATE`/`RENDER` = `PENDING`, 6
    stage còn lại `SKIPPED`).
- **Kết luận:** phần CRUD/refine-session/select/summary-languages đã test hoàn thiện ở cả 2 mức (kể cả
  Redis thật). Phần **AI thực sự soạn/viết lại kịch bản** (`SummaryAiClient`) vẫn là placeholder — xem 7.8.

### 7.4 Đã kiểm thử — 2.4 Video Batch Localization
- Unit test (`BatchServiceImplTest`, 9 case) + integration test (`BatchControllerTest`, 7 case): tạo batch
  (đúng N `media_jobs` con/1 `target_lang` dùng chung, `sourceAssetIds` rỗng/>20 → `400
  BATCH_SIZE_EXCEEDED`, vượt rate limit → `429 BATCH_RATE_LIMIT_EXCEEDED`), list/get (kèm job con), cancel
  (chỉ huỷ job con `PENDING`/`PROCESSING`, giữ nguyên job đã `COMPLETED`, batch → `CANCELLED` bất kể trạng
  thái job con), retry 1 job con (chặn nếu job không `FAILED` hoặc không thuộc batch, rerun đúng từ stage bị
  `FAILED`, batch tính lại đúng trạng thái `PROCESSING` sau khi retry, batch `CANCELLED` không bị recompute
  ghi đè).
- **Real-infra smoke test** (Postgres 16 + Redis 7 + MinIO thật qua Docker, `mvn spring-boot:run`, gọi bằng
  `curl` — containers **giữ nguyên chạy nền** theo yêu cầu, không tắt sau khi test xong):
  - Flyway/Hibernate validate xác nhận cột `source_asset_ids UUID[]` map đúng kiểu mảng thật của Postgres
    (`uuid[]`, không phải text[] hay lỗi kiểu), `shared_config` map đúng `jsonb` thật.
  - Tạo batch thật 2 video → đúng 2 `media_jobs` con thật, mỗi job `batch_id` trỏ đúng batch, `recipe_id`
    luôn `localization.full`, `target_lang` = đúng giá trị batch cha (verify bằng `psql`).
  - Cancel batch thật → batch + cả 2 job con chuyển `CANCELLED` thật trong Postgres.
  - **Rate limiter dùng Redis thật** (không mock): gọi tạo batch 6 lần liên tiếp qua HTTP thật → 5 lần đầu
    `201`, lần thứ 6 đúng `429` (code 3101) — xác nhận `BatchCreateRateLimiterImpl` hoạt động đúng với Redis
    thật, đúng key `batch:create:{userId}`.
- **Kết luận:** phần tạo/list/get/cancel/retry đã test hoàn thiện ở cả 2 mức (kể cả kiểu cột mảng UUID[]
  thật trên Postgres — rủi ro tương tự JSONB ở §2.2 nhưng chưa gặp ở module nào trước đó). `download` (gói
  nén kết quả) chưa làm được — xem 7.8.

### 7.5 Đã kiểm thử — 2.5 Glossary
- Unit test (`GlossaryServiceImplTest`, 9 case) + integration test (`GlossaryControllerTest`, 7 case):
  get-or-create glossary (idempotent — gọi nhiều lần không tạo trùng, đúng `UNIQUE(project_id)`), quyền đọc
  cho Client, term CRUD (tạo/sửa/xoá, 404 khi không tồn tại, Client bị chặn ghi), import CSV (có/không có
  header, dòng lỗi bị skip và báo lại trong `errors[]`, dòng hợp lệ vẫn được import).
- **Real-infra smoke test** (cùng bộ Postgres/Redis/MinIO ở 7.1–7.4, containers giữ nguyên chạy nền):
  - Flyway/Hibernate validate xác nhận schema `glossaries`/`glossary_terms` khớp — không migration nào
    thiếu, không lệch kiểu cột.
  - Gọi `GET .../glossary` nhiều lần qua HTTP thật → luôn trả về đúng 1 row (`glossaries.count()=1`, verify
    bằng `psql`) — xác nhận `UNIQUE(project_id)` không bị vi phạm bởi race "gọi lần đầu" thực tế.
  - Import CSV thật (file `.csv` thật qua multipart) → `imported=2, skipped=1`, đúng dòng lỗi báo trong
    `errors[]`; verify tổng số dòng thật trong `glossary_terms` bằng `psql` khớp `1 (tạo tay) + 2 (import) = 3`.
  - Xác nhận index `glossaries_project_id_key` (UNIQUE) tồn tại thật trên Postgres qua `pg_indexes`.
- **Kết luận:** module Glossary không phụ thuộc AI/queue/worker nào — đã test hoàn thiện ở cả 2 mức, không
  có khoảng hở nào cần ghi vào bảng 7.6 (khác các module trước, module này không có phần nào phải chờ
  backend-ai/RabbitMQ).

### 7.6 Đã kiểm thử — 2.6 QA
- Unit test (`QaServiceImplTest`, 10 case) + integration test (`QaControllerTest`, 9 case): list issues
  (không filter trả hết, `resolved=false` chỉ trả chưa xử lý, Client đọc được), override (issue_type nghiêm
  trọng — `subtitle_overlap` CRITICAL — luôn bị chặn `403 OVERRIDE_NOT_ALLOWED` **kể cả Lead**, reason <10
  ký tự bị chặn `VALIDATION_ERROR`, Lead override được mọi job, Member không phải người tạo job bị chặn
  `JOB_OWNERSHIP_REQUIRED`, Client luôn bị chặn, override thành công tự đánh dấu `resolved_at`), `recordIssue`
  (ghi đúng field, dùng bởi stage executor tương lai).
- **Real-infra smoke test** (cùng bộ Postgres/Redis/MinIO ở 7.1–7.5, containers giữ nguyên chạy nền, restart
  app để nạp code QA + code A vừa merge — workspace/project RBAC — vào cùng branch):
  - Flyway/Hibernate validate xác nhận `qa_issues.blocking_actions` map đúng `character varying[]` thật,
    `detail` map đúng `jsonb` thật — không migration nào thiếu.
  - Seed 1 subtitle segment + 2 QA issue thật bằng SQL (chưa có stage executor sinh tự động) → `GET
    qa-issues` qua HTTP thật trả đúng `blockingActions` dạng mảng JSON thật và `detail` dạng object JSON
    thật (nhờ `@JsonRawValue`), không bị escape thành chuỗi.
  - Override `subtitle_overlap` CRITICAL qua HTTP thật bằng chính Lead → đúng `403` code 3301, **không** ghi
    gì vào `qa_issue_overrides` thật (verify bằng `psql`).
  - Override `translation_mismatch` HIGH qua HTTP thật → `200`, `qa_issues.resolved_at` được set thật và
    `qa_issue_overrides` có đúng 1 dòng audit — xác nhận invariant "issue nghiêm trọng không bao giờ resolve
    được, issue thường thì override xong tự resolve" đúng trên dữ liệu Postgres thật, không chỉ trong test.
- **Kết luận:** phần list/override đã test hoàn thiện ở cả 2 mức. Phần sinh issue tự động
  (`recordIssue`/rule engine) chưa có gì gọi tới vì chưa có stage executor — xem 7.8.

### 7.7 Đã kiểm thử — 2.7 Callback nội bộ Worker → Spring
- Unit test (`HmacVerifierTest`, 6 case + `MediaCallbackServiceImplTest`, 8 case) + integration test
  (`MediaCallbackControllerTest`, 8 case): HMAC hợp lệ/sai secret/body bị sửa/timestamp lệch quá ±5 phút,
  path `{stage}` không hợp lệ → `400`, thiếu header bắt buộc → `400` (bổ sung
  `MissingRequestHeaderException` vào `GlobalExceptionHandler` — sửa `common`, xem ghi chú dưới), progress
  cập nhật đúng `PENDING→PROCESSING` + `progress_percent`, complete thành công/thất bại cập nhật đúng
  `media_job_stages`/`media_jobs`, dedupeKey lặp lại không xử lý lại lần 2, job có `batch_id` → gọi đúng
  `BatchService.recomputeStatus` (đã đổi `private`→public trên interface để callback gọi được).
- **Real-infra smoke test** (cùng bộ Postgres/Redis/MinIO ở 7.1–7.6, containers giữ nguyên chạy nền, restart
  app với `MEDIA_WORKER_HMAC_SECRET` thật): ký HMAC thật bằng Python (`hmac`/`hashlib`, độc lập với code Java
  — xác nhận định dạng `"<timestamp>.<rawBody>"` hoạt động đúng từ một client hoàn toàn khác ngôn ngữ, không
  chỉ tự ký rồi tự verify trong cùng JVM):
  - `progress` + `complete` thật cho `EXTRACT_AUDIO` → `media_job_stages.output_ref` lưu đúng `jsonb` thật,
    `media_jobs.status` chuyển đúng `PROCESSING` (còn stage sau chưa xong).
  - Gọi lại `progress` với cùng `dedupeKey` nhưng `progressPercent` khác → bị bỏ qua thật (giá trị trong
    Postgres không đổi), xác nhận Redis dedupe thật (`GET media_job:callback:dedupe:{key}` tồn tại, TTL
    ~86400s).
  - Sai secret → `401` thật; timestamp lệch 10 phút → `401` thật.
  - Tạo 1 batch thật (1 video) → gọi `complete` thất bại cho job con → xác nhận cascade thật qua 3 tầng
    Postgres: `media_job_stages.status=FAILED` → `media_jobs.status=FAILED` → `localization_batches.status`
    tự động recompute thành `FAILED` (không cần gọi API batch nào thêm) — đây là lần đầu tiên trong toàn bộ
    §2.2–2.7 một hành động ở tầng thấp nhất (callback) được xác nhận lan đúng lên toàn bộ chuỗi phụ thuộc
    thật, không phải mock.
- **Sửa `common` (cần báo A theo CLAUDE.md §4.8):** thêm `AppProperties.MediaWorker(hmacSecret)` (field mới,
  không đổi field cũ) và handler `MissingRequestHeaderException` trong `GlobalExceptionHandler` (thêm mới,
  không sửa handler cũ nào) — cả hai đều additive, không phá vỡ shape hiện có, nhưng vẫn là thay đổi trong
  package `common`.
- **Kết luận:** đây là module đầu tiên xác nhận được **toàn bộ chuỗi phụ thuộc thật** (stage → job → batch)
  phản ứng đúng trước 1 sự kiện từ bên ngoài (giả lập worker), không chỉ từng lớp riêng lẻ. Phần còn thiếu
  duy nhất: chưa có `backend-media-worker` thật gọi vào (chỉ giả lập bằng script Python) — xem 7.8.

### 7.8 CHƯA kiểm thử — còn lại ngoài phạm vi 2.1–2.7 (cần A/BA/hạ tầng khác)
| Phần thiếu | Lý do chưa test | Cần gì để test được |
|---|---|---|
| Gọi FastAPI thật cho STT/TRANSLATE/TTS/SUMMARIZE/VISION (bao gồm `summarize/script`) | Chưa viết HTTP client — không có trong phạm vi 2.2/2.3 đã chủ động scope lại, và `backend-ai` chưa expose contract cụ thể trong docs đã đọc | Viết client theo `backend-ai` OpenAPI/route thật, cần `docker compose up` với service `backend-ai` |
| Ghi `ai_usage_logs` khi có lời gọi AI thật | **Cập nhật:** A đã merge `credit_pricing_config` + `CreditServiceImpl.chargeUsage` thật (Case 1/2 theo `infra_coefficient_x`/`token_coefficient_y`, migration V4 seed pricing) — không còn là stub `0.001/token`. Nhưng vẫn chưa test được từ phía tôi vì **không có gì trong media_job/summarization/batch gọi `chargeUsage`** — chính vì lời gọi FastAPI thật (mục trên) chưa tồn tại | Sau khi có mục trên: gọi `chargeUsage` thật sau mỗi lời gọi FastAPI + ghi `ai_usage_logs`, rồi mới test tích hợp được |
| RabbitMQ dispatch khi cancel/rerun/retry | Vẫn chưa có publisher/dependency nào trong `pom.xml` (đã kiểm tra lại) — cancel/rerun/retry hiện set trạng thái DB trực tiếp (đã đánh dấu `ponytail:` trong code) | Cần message queue thật + consumer, hoặc ít nhất mock RabbitMQ (Testcontainers) để verify message được publish đúng payload |
| Provider/Preset/Notification thật của Thành viên A | **Đã kiểm tra lại — vẫn chưa đổi:** `ProviderResolverServiceImpl.resolveForCapability`, `PresetResolverServiceImpl`, `NotificationServiceImpl` vẫn đúng là mock/no-op tôi tự viết (chỉ `credit` module có bản thật mới, xem dòng trên) | Khi A merge implementation thật, phải viết lại test tích hợp — hành vi thật có thể khác giả định hiện tại |
| `GET .../batches/{batchId}/download` | Cần gói nén kết quả các job con `COMPLETED` — không có artifact thật nào vì chưa có stage executor/RENDER thật | Chỉ làm được sau khi có pipeline thực thi thật tạo ra `RENDERED_VIDEO` media_assets |
| `recordIssue`/rule engine QA thật (phát hiện `subtitle_overlap`, `translation_mismatch`...) | Chưa có stage executor gọi hàm này sau TRANSLATE/SUMMARIZE — logic phát hiện lỗi cụ thể không có trong SRS/Arch để hiện thực | Cần: (1) stage executor thật, (2) BA/QA lead định nghĩa rule cụ thể cho từng `issue_type` |
| Checkpoint→stage mapping (`CUT_CONFIRMED→TRANSLATE`, `REVIEW_CONFIRMED→TTS`, `PUBLISH_CONFIRMED→RENDER`) | Đây là giả định tôi tự chọn (xem comment trong `Checkpoint.java`), không có trong SRS/Arch §14 | Cần BA xác nhận trước khi FE dựa vào mapping này để quyết định dừng ở đâu trong chế độ Manual |
| Dung sai thời lượng AI proposal (`DURATION_TOLERANCE_RATIO = 0.2`, `SummarizationServiceImpl`) | Giả định tôi tự chọn — SRS/Arch §7.2 chỉ nói "trong dung sai", không cho số cụ thể | Cần BA xác nhận % dung sai chính xác trước khi dựa vào ngưỡng này để tự động từ chối/chấp nhận proposal |
| TTL phiên refine (`RefineSessionStoreImpl.SESSION_TTL = 30 phút`) | Arch §7.4 chỉ nói "phiên có TTL", không cho số cụ thể | Cần BA xác nhận thời lượng phiên thật trước khi FE dựa vào đây để hiển thị "còn X phút để refine" |
| Rate limit tạo batch (`BatchCreateRateLimiterImpl` = 5 lần/10 phút/user) | API_Contract §6 chỉ nói "429 nếu vượt rate limit", không cho ngưỡng cụ thể | Cần BA xác nhận ngưỡng thật trước khi FE dựa vào đây để hiển thị thông báo giới hạn |


### 7.9 Môi trường dùng để test real-infra (tham khảo khi cần lặp lại)
```
docker run -d --name tfm-postgres -p 55432:5432 -e POSTGRES_DB=transflow_mini -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres postgres:16-alpine
docker run -d --name tfm-redis -p 56379:6379 redis:7-alpine
docker run -d --name tfm-minio -p 59000:9000 -p 59001:9001 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio:latest server /data --console-address ":9001"
```
Lưu ý: image `minio/minio` trên Docker Hub bị từ chối pull trong môi trường này (registry access denied) —
dùng `quay.io/minio/minio` thay thế. Chạy app với `DB_HOST=localhost DB_PORT=55432 ... REDIS_HOST=localhost
REDIS_PORT=56379 MEDIA_STORAGE_ENDPOINT=http://localhost:59000 ...` rồi `./mvnw spring-boot:run`. Mặc định
nên dọn container (`docker rm -f tfm-postgres tfm-redis tfm-minio`) sau khi test xong để không chạy hạ tầng
test dư thừa nền máy — chỉ giữ lại khi người yêu cầu chủ động nói không cần tắt (như vòng test §2.4, dữ liệu
batch mẫu vẫn còn trong Postgres thật ở container `tfm-postgres` lúc viết dòng này).
