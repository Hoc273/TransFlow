# Backend Java — Phân việc Thành viên B: Media Studio Pipeline

> Bám sát `API_Contract.md`, `docs/SRS.md` 1.4b, `System_Architecture.md` 3.3, `Database_Design.md` 3.3.
> Trước khi code: đọc 3 tài liệu trên + khảo sát `../transflow/backend-main` theo đúng CLAUDE.md §4.
> **Cảnh báo riêng cho phần này**: `MediaController`/`MediaSummaryService`/`MediaJobResponse` gốc trong
> `transflow` đã bị "nhiễm" rất nặng bởi các lớp legacy (Content-Transformation CT0-CT5, W0/W1 workflow,
> `documentId`, ADR-CEP B-series, `recipeId` gồm cả `summary.extractive/summary.generative` không tồn tại
> trong `transflow_mini`). **Không copy nguyên `MediaController`/`MediaJobResponse`/`CreateMediaJobRequest`
> của bản gốc.** Chỉ lấy phần logic nghiệp vụ cốt lõi (tạo job, stage machine, rerun-from-stage, proposal),
> viết lại DTO sạch theo đúng field trong `Database_Design.md` §6–§8.

## 1. Phạm vi phụ trách

Đây là 2 luồng sản phẩm chính của Media Studio, phụ thuộc vào các service nền tảng do Thành viên A cung
cấp (xem §4 dưới).

| Module | API_Contract.md | Bảng DB sở hữu |
|---|---|---|
| Media Asset & Consent | §4 | `media_assets`, `media_consents` |
| Media Job — Localization + Summarization | §5 | `media_jobs`, `media_job_stages`, `summary_proposals`, `summary_proposal_segments`, `subtitle_segments` |
| Video Batch Localization | §6 | `localization_batches` |
| Glossary | §7 | `glossaries`, `glossary_terms` |
| QA | §8 | `qa_issues`, `qa_issue_overrides` |
| Callback nội bộ Worker→Spring | §14 | ghi `media_job_stages`/`media_jobs` |
| Ghi log usage AI | (phụ, cho A đọc ở Dashboard) | `ai_usage_logs` |

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
  lại Credit) — chỉ cho phép nếu mọi stage trước `COMPLETED/SKIPPED` (`409 STAGE_NOT_READY` nếu không).
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
  gọi `A.CreditService.hasSufficientBalance(...)` trước khi tạo (mặc định `BLOCK_UPFRONT`, trả `402
  INSUFFICIENT_CREDIT` nếu không đủ).
- Voice: từ chối rõ ràng (`400 VOICE_LANGUAGE_MISMATCH`) nếu `tts_voices.language ≠ target_lang` — không
  fallback ngầm.
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
