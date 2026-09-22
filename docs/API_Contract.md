# API Contract — TransFlow Media (transflow_mini)

> Phiên bản: **1.1** · Bám sát `SRS.md` 1.4b, `System_Architecture.md` 3.3, `Database_Design.md` 3.3,
> `api-response-convention.md`. Chỉ mô tả API của `backend-main` (Spring Boot) — nguồn sự thật duy nhất chạm
> PostgreSQL. FastAPI (`backend-ai`) và `backend-media-worker` không có API public, chỉ được Spring gọi nội bộ.
> Không có endpoint nào cho Document/Translation Job/Text Editor/Translation Memory/Batch dịch file/
> Creative Production/Platform Admin — các domain này ngoài phạm vi (xem `CLAUDE.md` §3).
>
> **Ghi chú cập nhật — 1.1:** đổi response envelope theo `api-response-convention.md` — mọi response (kể cả
> thành công) bọc trong `ApiResponse<T>{code:int, message, data}`; envelope cũ
> `{status,error,message,path,code:string,details}` không còn dùng. Mã lỗi HTTP trước đây nằm trong body
> (`status`) nay chỉ còn ở HTTP status code thật của response; `code` trong body chuyển từ string sang số
> nguyên tra theo `ErrorCode` (§15).

---

## 0. Quy ước chung

- **Base path**: mọi API người dùng nằm dưới `/api/...`; callback nội bộ từ Worker nằm dưới `/internal/...`
  (không đi qua JWT, xác thực bằng HMAC — xem §14).
- **Auth**: Bearer JWT (`Authorization: Bearer <accessToken>`) cho toàn bộ `/api/...`, trừ
  `/api/auth/register|login|refresh|google/*`.
- **Định dạng**: JSON, field JSON dùng `camelCase`. UUID dạng string chuẩn. Thời gian ISO-8601 UTC
  (`instant`, ví dụ `2026-09-15T08:00:00Z`).
- **Phân trang**: query `page` (0-based, mặc định 0), `size` (mặc định 20, tối đa 100) cho mọi endpoint
  list có thể lớn (jobs, transactions, notifications, usage log).
- **RBAC**: mọi endpoint mutation kiểm tra quyền ở service layer theo `workspace_members.role` +
  `project_members` + (khi áp dụng) `media_jobs.created_by_user_id`, không chỉ dựa vào route (Arch §1 mục 7).
  Cột "Role" trong các bảng dưới đây là điều kiện cần; điều kiện Project assignment vẫn áp dụng thêm cho
  `MEMBER`/`CLIENT`.
- **Response envelope** — mọi response (thành công lẫn lỗi) bọc trong `ApiResponse<T>{code, message, data}`
  theo `api-response-convention.md` (field `null` bị lược bỏ khỏi JSON — `@JsonInclude(NON_NULL)`):
  - Thành công: `code` mặc định **1000**, không cần set tường minh; payload nằm ở `data`.
    ```json
    { "code": 1000, "data": { "id": "uuid", "...": "..." } }
    ```
  - Lỗi nghiệp vụ (tra theo `ErrorCode`, xem §15):
    ```json
    { "code": 2900, "message": "targetLang phải cùng ngôn ngữ với voice đã chọn" }
    ```
  - Lỗi validate (`@Valid`) — lỗi theo từng field nằm ở `data`, không phải field `details` riêng:
    ```json
    { "code": 9998, "data": { "targetLang": "must not be blank" } }
    ```
  - HTTP status code thật của response tra theo `ErrorCode.httpStatusCode` (§15) — **không** còn field
    `status`/`error`/`path` trong body như envelope cũ; muốn biết path/status đọc trực tiếp từ response HTTP,
    không phải parse JSON.
  - Quy ước HTTP status theo nhóm lỗi (áp dụng khi gán `httpStatusCode` cho `ErrorCode` mới): `400` lỗi
    validate/nghiệp vụ. `401` thiếu/hết hạn JWT. `403` không đủ quyền (role/project assignment/
    job-ownership). `404` không thấy resource hoặc không có quyền xem (không phân biệt để tránh lộ thông
    tin). `409` xung đột trạng thái (ví dụ rerun-from-stage khi stage trước chưa COMPLETED). `429` rate
    limit (tạo batch).
- **Polling, không SSE**: FE polling `GET .../jobs/{jobId}` và `GET .../batches/{batchId}` mỗi ~5s để theo
  dõi tiến trình (Arch §1 mục 5). Không có WebSocket/SSE cho pipeline dài.
- **Đa tenant**: mọi response chỉ trả dữ liệu thuộc `workspaceId` trên path; không có endpoint xuyên
  workspace ngoài `GET /api/workspaces` (danh sách workspace của chính user).

---

## 1. Auth (SRS §5.1)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/auth/register` | không | `{email,password,fullName}` → tạo user; **lần đầu đăng nhập** trigger auto-init Workspace+Project+Credit (Arch §3). Trả `{accessToken,refreshToken,user,workspaceId,projectId}`. |
| POST | `/api/auth/login` | không | `{email,password}` → cùng response shape như trên. |
| POST | `/api/auth/refresh` | không (refresh token) | `{refreshToken}` → `{accessToken,refreshToken}`. |
| GET | `/api/auth/me` | JWT | Thông tin user hiện tại: `{id,email,fullName,googleLinked}`. |
| GET | `/api/auth/google/start` | không | Redirect sang Google OAuth2 consent screen. |
| GET | `/api/auth/google/callback` | không | Google redirect về; set cookie/state tạm, FE gọi `exchange` tiếp theo. |
| POST | `/api/auth/google/exchange` | không | `{code}` → cùng response shape `register/login`; nếu `google_sub` chưa gắn user nào thì chạy auto-init như lần đầu (Arch §3). |

---

## 2. Workspace & Membership (SRS §3.1–3.2, §5.1)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| POST | `/api/workspaces` | user đã đăng nhập | `{name}` → tạo Workspace mới, user tạo trở thành `LEAD` (đúng 1 Lead/workspace). |
| GET | `/api/workspaces` | user đã đăng nhập | Danh sách Workspace mà user là thành viên (mọi role). |
| GET | `/api/workspaces/{workspaceId}` | LEAD/MEMBER/CLIENT | Chi tiết Workspace (`{id,name,slug,ownerUserId}`). |
| GET | `/api/workspaces/{workspaceId}/members` | LEAD/MEMBER/CLIENT | Danh sách thành viên + role. |
| POST | `/api/workspaces/{workspaceId}/members` | LEAD | `{email, role: "MEMBER"\|"CLIENT"}` → mời user hiện có vào Workspace. Không thể tạo thêm `LEAD`. |
| PUT | `/api/workspaces/{workspaceId}/members/{memberId}` | LEAD | `{role: "MEMBER"\|"CLIENT"}` → đổi role. Không đổi được role của chính Lead. |
| DELETE | `/api/workspaces/{workspaceId}/members/{memberId}` | LEAD | Xoá thành viên (cascade xoá `project_members` liên quan). |
| GET | `/api/workspaces/{workspaceId}/billing-config` | LEAD/MEMBER/CLIENT | `{costMode: "LEAD_PAYS_ALL"\|"PAY_PER_USER"}` (SRS §5.6). |
| PUT | `/api/workspaces/{workspaceId}/billing-config` | LEAD | `{costMode}` → đổi chế độ tính chi phí Workspace. |

## 3. Project & Project assignment (SRS §3.1–3.2)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/projects` | LEAD/MEMBER/CLIENT | Lead: toàn bộ Project trong Workspace. Member/Client: chỉ Project đã được gán (`project_members`). |
| POST | `/api/workspaces/{workspaceId}/projects` | LEAD | `{name, sourceLang?}` → tạo Project mới. |
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/members` | LEAD | Danh sách user được gán vào Project. |
| POST | `/api/workspaces/{workspaceId}/projects/{projectId}/members` | LEAD | `{userId}` → gán 1 `workspace_members` (MEMBER/CLIENT) vào Project. |
| DELETE | `/api/workspaces/{workspaceId}/projects/{projectId}/members/{userId}` | LEAD | Gỡ assignment. |

---

## 4. Media Asset & Consent (SRS §5.2)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/media/terms-version` | LEAD/MEMBER | `{termsVersion}` — phiên bản điều khoản hiện hành (`terms_versions.is_current`). |
| POST | `/api/workspaces/{workspaceId}/projects/{projectId}/media/assets` | LEAD/MEMBER (project) | Multipart: `file` (≤500MB, ≤30 phút), `name?`. Trả `MediaAssetResponse` (`asset_type=SOURCE_VIDEO`, `processing_status=VALIDATING→READY`). |
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/media/assets` | LEAD/MEMBER/CLIENT | Danh sách asset gốc (`SOURCE_VIDEO`) trong Project. |
| GET | `/api/workspaces/{workspaceId}/media/assets/{assetId}` | LEAD/MEMBER/CLIENT | Chi tiết 1 asset. |
| POST | `/api/workspaces/{workspaceId}/media/assets/{assetId}/consent` | LEAD/MEMBER | `{termsVersion}` phải khớp version hiện hành → tạo `media_consents`. Bắt buộc trước khi tạo Media Job từ asset này. |

---

## 5. Media Job — orchestrator Localization + Summarization (SRS §5.3, §5.5; Arch §5, §7)

`recipeId` quyết định field bắt buộc còn lại (constraint `ck_job_recipe_mode` trong DB):

| `recipeId` | Field bắt buộc thêm |
|---|---|
| `localization.full` | `processingMode` (`TRANSLATE_ONLY`\|`HYBRID`) |
| `summary.script_match` (alias `summary.generative`) | `requestedDurationSeconds` (giây, > 0) |

| Method | Path | Role | Mô tả |
|---|---|---|---|
| POST | `/api/workspaces/{workspaceId}/media/jobs` | LEAD/MEMBER (project của asset) | Tạo job — xem body mẫu dưới. Hỗ trợ recipe `localization.full`, `summary.script_match` (và alias `summary.generative`), `sourceLang`, `ttsProviderId`, `keepOriginalAudio`. Yêu cầu asset đã có consent. |
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/media/jobs?status=&recipeId=` | LEAD/MEMBER/CLIENT | List job trong Project (không lọc theo `created_by`). |
| POST | `/api/workspaces/{workspaceId}/projects/{projectId}/media/jobs/download` | LEAD/MEMBER/CLIENT (project) | Tải nhiều video đã hoàn thành do user chọn (thay cho "tải theo Batch"; danh sách lấy từ endpoint trên với `status=COMPLETED`). Body `{jobIds:[uuid]}` (không rỗng, loại trùng, tối đa `app.media-job.max-bulk-download`=20 → `DOWNLOAD_SELECTION_TOO_LARGE`). Mỗi job phải thuộc project, `COMPLETED` và qua quality gate như `/export`; job không đạt vào `skipped` với `reason` `NOT_FOUND` (không tồn tại/khác project) `|` `NOT_COMPLETED` `|` `QA_BLOCKED`. Không job nào đạt → `QA_BLOCKED` (có job bị QA chặn) hoặc `STAGE_NOT_READY`. Trả `{downloadUrl, fileName, expiresAt, includedJobIds[], skipped[{jobId, reason}]}`: zip `<tên gốc>_<lang>_<jobId8>.mp4` được nén tạm rồi upload lên MinIO `tmp/downloads/` (tự hết hạn bằng lifecycle rule), `downloadUrl` là presigned URL. Chạy đồng bộ. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}` | LEAD/MEMBER/CLIENT | Chi tiết job + `stages[]` (8 stage kỹ thuật, FE tự ẩn stage `SKIPPED`). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/cancel` | LEAD/MEMBER (project) | Huỷ job đang chạy; gửi cancel xuống Worker sau khi transaction commit (Arch §6.2). Trả `200 OK` kèm `MediaJob` và `stages[]`. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/voice` | LEAD/MEMBER (project) | Body `{ttsProviderId?, ttsVoiceId}` (null = bỏ chọn giọng, chỉ hợp lệ nếu `output_audio_mode=ORIGINAL_ONLY`). Từ chối nếu `tts_voices.language ≠ target_lang`. Trả `200 OK` kèm `MediaJob` và `stages[]`. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/checkpoints/{checkpoint}/confirm` | **job-ownership** (Lead mọi job; Member chỉ job `created_by_user_id = mình`; Client bị chặn) | `{checkpoint}` ∈ `CUT_CONFIRMED\|REVIEW_CONFIRMED\|PUBLISH_CONFIRMED`. Chỉ áp dụng khi `workflow_mode=MANUAL` (Arch §5.6). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/stages/{stageName}/rerun` | LEAD/MEMBER (project) | Rerun-from-stage (Arch §5.7). `409` nếu stage trước chưa `COMPLETED/SKIPPED`. Không tính lại Credit cho stage output tái sử dụng. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/subtitles` | LEAD/MEMBER/CLIENT | List `subtitle_segments` theo `seq`. |
| PATCH | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/subtitles/{segmentId}` | LEAD; MEMBER chỉ job của mình | `{targetText?, startMs?, endMs?}`. Khoảng thời gian sau merge phải thoả `0 <= startMs < endMs`, sai → `VALIDATION_ERROR`. Nếu job đã qua TTS/RENDER → set các stage sau `STALE`, không tự rerun (SRS §5.3). |
| PUT | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/segments/batch` | LEAD; MEMBER chỉ job của mình | `{updates:[{segmentId, targetText?, startMs?, endMs?}]}` (tối đa 200, cấu hình `app.media-job.max-batch-subtitle-updates`). Một transaction, khoá job; field null = giữ nguyên; `segmentId` trùng/không thuộc job/vượt giới hạn/thời gian sai → `VALIDATION_ERROR` và không segment nào bị đổi. Stage sau TTS/RENDER `STALE` đúng 1 lần. Trả `List<SubtitleSegment>` theo thứ tự request; gọi lại cùng body là idempotent. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/override-source-lang` | LEAD; MEMBER chỉ job của mình | Body `{sourceLang}` (mã ISO 639-1, không phân biệt hoa/thường; danh sách hỗ trợ cấu hình `app.media-job.supported-source-langs`, mặc định `vi,en,zh,ja,ko,fr,de,es,th,id,ru`). Ghi `media_jobs.source_language` (khoá job `FOR UPDATE`); các stage `TRANSLATE` trở đi đang `COMPLETED` → `STALE`, **không tự chạy lại** — FE gọi `stages/TRANSLATE/rerun`. STT giữ nguyên. Ngôn ngữ không hỗ trợ, rỗng hoặc trùng ngôn ngữ đích → `VALIDATION_ERROR`; STT chưa `COMPLETED`, job `FAILED`/`CANCELLED` hoặc có stage đang chạy → `STAGE_NOT_READY` (409); đặt lại đúng ngôn ngữ hiện có là no-op. Trả `MediaJob`. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/render-config` | LEAD/MEMBER/CLIENT | Cấu hình dựng hình (`media_jobs.render_config`, chưa cấu hình → trả mặc định, không null): `{subtitleMode, subtitlePosition(TOP\|CENTER\|BOTTOM, mặc định BOTTOM), verticalOffsetPercent(-30..30), backgroundBox, backgroundColor(#RRGGBBAA)?, textColor(#RRGGBB)?, outputAspectRatio(ORIGINAL\|16:9\|9:16\|1:1\|4:3), confirmed(checkpoint PUBLISH_CONFIRMED), sourceVideoUrl?, sourceVideoUrlExpiresInSeconds, presentation?, effective{boxMode,ownedByStyle,resolvedLinePercent,deadControls[]}}`. `presentation = {subtitle:{displayMode(SENTENCE\|PHRASE\|WORD), layers[≤4, khớp giới hạn của worker]{layerType(COVER_BOX\|IMAGE\|WATERMARK), anchor(SUBTITLE\|TOP\|CENTER\|BOTTOM)?, xPercent/yPercent 0..100, widthPercent 20..100, heightPercent 5..50, colorHex?, opacity 0..1?}}, audio:{originalGainDb/ttsGainDb -30..12, ducking{enabled,gainDb -30..0,attackMs 0..1000,releaseMs 0..2000}}}`. `effective` chỉ tính từ dữ liệu đã lưu (không lưu DB); `ownedByStyle=false`, `deadControls=[]` cho tới khi có subtitle-styles. `sourceVideoUrl` là presigned URL (null nếu ký lỗi). |
| PUT | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/render-config` | LEAD; MEMBER chỉ job của mình | Body cùng các field ghi được ở trên (`subtitleMode(HARD_SUB\|SOFT_SUB)`, `subtitlePosition`, `verticalOffsetPercent`, `backgroundBox`, `backgroundColor`, `textColor`, `outputAspectRatio`, `presentation`); **field null/vắng = giữ nguyên**, `presentation` gửi thì thay cả khối. Enum/khoảng số/màu sai → `VALIDATION_ERROR`. Khoá job `FOR UPDATE`; stage `RENDER` đã COMPLETED → `STALE`. Trả như GET. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/rerun-render` | LEAD; MEMBER chỉ job của mình | Body tuỳ chọn = body PUT: lưu cấu hình (nếu có) rồi chạy lại từ stage `RENDER` (dùng chung logic `stages/RENDER/rerun`); stage trước chưa COMPLETED/SKIPPED → `STAGE_NOT_READY` (409, không lưu gì). `202 Accepted`, trả `MediaJob`. |
| GET | `/api/media/subtitle-styles` | mọi user đã đăng nhập | Danh sách style hệ thống (catalog cố định trong code `subtitle-styles.json`): `[{key, name, language?, thumbnail?, preview_text?, revision}]` — `style-classic`, `style-modern-clean`, `style-tiktok`, `style-cinema`, `style-neon`. **Ngoại lệ có chủ đích:** route không có `workspaceId` và field **snake_case** (FE `api/subtitleStyle.ts` đã xây theo contract này). |
| GET | `/api/media/subtitle-styles/{key}` | mọi user đã đăng nhập | `{key, name, revision, font_family(Arial\|DejaVu Sans), font_size(16..120), primary_color(#RRGGBB), outline_color, outline_width(0..8), shadow, bold, italic, alignment(left\|center\|right), margin_v, line_spacing, background?(#RRGGBBAA), opacity(0..100)}`. Key sai định dạng → `INVALID_STYLE_KEY` (400); không tồn tại → `STYLE_NOT_FOUND` (404). |
| GET | `/api/media/jobs/{jobId}/subtitle-style` | LEAD/MEMBER/CLIENT (project của job) | Snapshot 13 trường đang áp dụng (`media_jobs.subtitle_style`). Chưa gán → `STYLE_NOT_FOUND` (404) — FE coi là "chưa chọn style". |
| POST | `/api/media/jobs/{jobId}/subtitle-style` | LEAD; MEMBER chỉ job của mình | `{key}` → **ghi đè** snapshot, trả snapshot mới. Khoá job `FOR UPDATE`; snapshot thay đổi và `RENDER` đã COMPLETED → `STALE` (gán lại đúng style đang có là no-op). Sau khi gán, `render-config.effective.ownedByStyle=true`. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/export?format=VIDEO\|SRT\|VTT\|SUBTITLE` | LEAD/MEMBER/CLIENT | Kết quả đã publish: `{format, fileName, downloadUrl, content}`. `VIDEO` → `downloadUrl` là presigned URL video RENDER (TTL `app.storage.presigned-ttl-seconds`, mặc định 3600s); `SUBTITLE` → `content` là nội dung SRT. `409 STAGE_NOT_READY` nếu job chưa `COMPLETED`/chưa có output RENDER; `400 VALIDATION_ERROR` nếu `format` sai; `403 QA_BLOCKED` nếu còn `qa_issues` chưa resolve/override có `BLOCK_PUBLISH` (SRS §5.3). `SRT`/`VTT` trả nội dung trong `content` (`SUBTITLE` là alias của `SRT`; VTT có header `WEBVTT`, mốc `HH:MM:SS.mmm`). |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/output-package` | LEAD/MEMBER/CLIENT (project) | Gói kỹ thuật cho Quick Preview: `{jobId, primaryVideoRef, primaryVideoDownloadUrl, audioTracks:[{role(ORIGINAL\|DUB\|MIX), storageRef?, downloadUrl?}], subtitleTracks:[{format(SRT\|VTT), language, available}], durationMs?, checksumSha256(null), artifactPins([])}`. Stage `RENDER` phải `COMPLETED`, không thì `STAGE_NOT_READY` (409). **Không** áp QA gate (dùng để xem trước). `ORIGINAL` khi job giữ âm thanh gốc; `DUB`/`MIX` lấy từ `output_ref` của stage `TTS`/`AUDIO_MIX` nếu có. `downloadUrl` là presigned URL (null nếu ký lỗi). `durationMs` lấy từ asset gốc. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/publish-package` | LEAD/MEMBER/CLIENT (project) | Bản nháp thông tin đăng bài (GENERIC, không auto-post): `{profile:"GENERIC", title?, description?, language, tags[], thumbnailRef?, sourceJobId, status:"DRAFT"}`; chưa lưu → nháp rỗng (`language` = `targetLang` của job). Lưu ở `media_jobs.publish_package`. |
| PUT | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/publish-package` | LEAD; MEMBER chỉ job của mình | Body `{title?(≤100), description?(≤5000), language?(mã ngôn ngữ, chỉ kiểm định dạng), tags?(≤30 mục, mỗi mục ≤50), thumbnailRef?(≤1000)}`; field null/vắng = giữ nguyên. Sai giới hạn → `VALIDATION_ERROR`; còn issue `BLOCK_PUBLISH` chưa xử lý → `QA_BLOCKED` (403). Khoá job `FOR UPDATE`. Trả như GET. |

**Body mẫu — tạo job Localization:**
```json
{
  "projectId": "uuid",
  "rootAssetId": "uuid",
  "recipeId": "localization.full",
  "processingMode": "HYBRID",
  "targetLang": "en",
  "subtitleMode": "SOFT_SUB",
  "outputAudioMode": "DUB_MIX",
  "sourceSeparationEnabled": true,
  "ttsVoiceId": "uuid",
  "workflowMode": "MANUAL",
  "presetId": "uuid"
}
```

**Body mẫu — tạo job Summarization:**
```json
{
  "projectId": "uuid",
  "rootAssetId": "uuid",
  "recipeId": "summary.script_match",
  "targetLang": "vi",
  "requestedDurationSeconds": 60,
  "visualContextEnabled": false,
  "subtitleMode": "SOFT_SUB",
  "workflowMode": "MANUAL"
}
```

### 5.1 Summarization — proposal & refine (SRS §5.5; Arch §7)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/proposals` | LEAD/MEMBER/CLIENT | List proposal còn active (`archived_at IS NULL`): AI round mới nhất + mọi Custom Proposal. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/proposals/custom` | LEAD/MEMBER (project) | `{segments:[{startMs,endMs}], reasoningNote?}` → tạo `summary_proposals(generated_by=HUMAN)`. Không bị archive khi có đề xuất AI mới. |
| PUT | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/proposals/{proposalId}` | LEAD/MEMBER (project) | Sửa Custom Proposal (chỉ áp dụng cho `generated_by=HUMAN`). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/proposals/{proposalId}/select` | LEAD/MEMBER (project) | Đặt `media_jobs.selected_proposal_id`. `409` nếu proposal đã dùng để tạo bản dịch và job yêu cầu đổi phương án trước khi refine tiếp (SRS §5.5). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/refine` | LEAD/MEMBER (project) | `{feedbackText}` → AI viết lại kịch bản (round mới). Tối đa **5 lần/phiên**; phiên lưu Redis TTL, hết hạn không mất proposal đã lưu (Arch §7.4). `429` khi vượt 5 lần. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/summary-languages` | LEAD/MEMBER (project) | `{targetLang, ttsVoiceId?}` — chỉ khi phương án đã chọn là AI. Tạo 1 `media_jobs` mới với `source_summary_job_id` trỏ về job gốc, giữ nguyên đoạn đã chọn, `SUMMARIZE` = `SKIPPED` (Arch §7.7). |

---

## 6. Video Batch Localization (SRS §5.4; Arch §6)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| POST | `/api/workspaces/{workspaceId}/projects/{projectId}/batches` | LEAD/MEMBER (project) | `{name?, sourceAssetIds:[uuid] (1..20), targetLang, sharedConfig:{...cùng field job Localization}}` → tạo `localization_batches` + N `media_jobs` con. `429` nếu vượt rate limit tạo batch. |
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/batches` | LEAD/MEMBER/CLIENT | List batch trong Project. |
| GET | `/api/workspaces/{workspaceId}/batches/{batchId}` | LEAD/MEMBER/CLIENT | Chi tiết batch + danh sách job con kèm trạng thái (không phải ma trận — SRS v1.4). |
| POST | `/api/workspaces/{workspaceId}/batches/{batchId}/cancel` | LEAD/MEMBER (project) | Huỷ toàn bộ batch (huỷ mọi job con chưa `COMPLETED/FAILED/CANCELLED`). |
| POST | `/api/workspaces/{workspaceId}/batches/{batchId}/jobs/{jobId}/retry` | LEAD/MEMBER (project) | Chạy lại riêng 1 job con `FAILED`, không ảnh hưởng job con khác. |

---

## 7. Glossary — 1 bảng thuật ngữ/Project (SRS §5.7; DB §8.2)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/glossary` | LEAD/MEMBER/CLIENT | Lấy glossary của Project (tự tạo rỗng nếu chưa có — `UNIQUE(project_id)`). |
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/glossary/terms` | LEAD/MEMBER/CLIENT | List term. |
| POST | `/api/workspaces/{workspaceId}/projects/{projectId}/glossary/terms` | LEAD/MEMBER (project) | `{sourceTerm,targetTerm,targetLang}`. |
| PUT | `/api/workspaces/{workspaceId}/projects/{projectId}/glossary/terms/{termId}` | LEAD/MEMBER (project) | Sửa term. |
| DELETE | `/api/workspaces/{workspaceId}/projects/{projectId}/glossary/terms/{termId}` | LEAD/MEMBER (project) | Xoá term. |
| POST | `/api/workspaces/{workspaceId}/projects/{projectId}/glossary/terms/import` | LEAD/MEMBER (project) | Multipart CSV (`source_term,target_term,target_lang`) → import hàng loạt. |

---

## 8. QA — quality gate tích hợp trong Media Job (SRS §5.7; Arch §8; DB §8.3)

QA issue được pipeline tự sinh sau stage `TRANSLATE`/`SUMMARIZE`, không có endpoint "chạy QA" thủ công.

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/qa-issues?resolved=false` | LEAD/MEMBER/CLIENT | List `qa_issues` (kèm `severity`, `blocking_actions`) của job. |
| POST | `/api/workspaces/{workspaceId}/qa-issues/{issueId}/override` | **job-ownership** (Lead mọi job; Member chỉ job của mình; Client luôn `403`) | `{reason}` (≥10 ký tự, bắt buộc). Ghi `qa_issue_overrides`, luôn lưu vết. `403` với `ErrorCode.OVERRIDE_NOT_ALLOWED` (§15) nếu `issue_type` thuộc nhóm không bao giờ override được (ví dụ `subtitle_overlap` CRITICAL) — áp dụng cả với Lead. |

---

## 9. Preset — 3 cấp + template dùng chung (SRS §5.7; DB §9)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/presets?scope=&projectId=` | LEAD/MEMBER/CLIENT | List preset khả dụng (SYSTEM + WORKSPACE + PROJECT được gán), đã resolve thứ tự ưu tiên hiển thị. |
| GET | `/api/media/presets/templates` | JWT (không cần workspace) | Danh mục preset `scope=SYSTEM` được công bố công khai trong app — chỉ đọc, không chứa dữ liệu tenant. |
| POST | `/api/workspaces/{workspaceId}/presets` | LEAD (scope `WORKSPACE`) hoặc LEAD/MEMBER (scope `PROJECT`, trong Project được gán) | `{scope, projectId?, name, subtitleStyle, voiceConfig, renderConfig, isDefault}`. `scope=SYSTEM` không tạo được qua API workspace. |
| PUT | `/api/workspaces/{workspaceId}/presets/{presetId}` | như trên theo `scope` của preset | Sửa preset. |
| DELETE | `/api/workspaces/{workspaceId}/presets/{presetId}` | như trên | Xoá preset (không xoá được preset đang là default duy nhất của scope nếu không chỉ định preset thay thế). |

> Preset áp dụng vào job theo thứ tự: `presetId` tường minh trong request tạo job (§5) > default PROJECT >
> default WORKSPACE > default SYSTEM; kết quả được **freeze** vào `media_jobs.preset_snapshot` tại thời điểm
> tạo job — không có endpoint sửa preset ảnh hưởng ngược lại job đã tạo.

---

## 10. Credit & Thanh toán (SRS §5.6; DB §4)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/users/me/credit` | JWT | `{balance}` — số dư `credit_accounts` của user hiện tại. |
| GET | `/api/users/me/credit/transactions?type=&from=&to=` | JWT | List `credit_transactions` mà user là `user_id` (charged) hoặc `performed_by_user_id`. |
| GET | `/api/credit/packages` | JWT | List `credit_packages` đang `is_active`. |
| POST | `/api/credit/packages/{packageId}/purchase` | JWT | `{paymentReference}` → tạo `credit_package_purchases` + `credit_transactions(type=PACKAGE_PURCHASE)`. **Chưa tích hợp cổng thanh toán thật** (Arch §14 mục 3) — `paymentReference` hiện là input thủ công/giả lập. |
| GET | `/api/workspaces/{workspaceId}/usage?groupBy=project\|user\|operation&from=&to=` | LEAD (toàn Workspace) / MEMBER (chỉ dữ liệu Project được gán) | Tổng hợp `ai_usage_logs` theo SRS §5.6 "Bảng theo dõi mức sử dụng AI". |

---

## 11. Nguồn AI cá nhân (BYOK) & TTS voices (SRS §5.6; DB §5)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/users/me/providers` | JWT | List `user_ai_providers` của chính user (không trả `api_key_enc`, chỉ `api_key_hint`). |
| POST | `/api/users/me/providers` | JWT | `{protocol, capabilities:[...], baseUrl, apiKey, defaultModel?}` → mã hoá AES-GCM trước khi lưu. |
| PUT | `/api/users/me/providers/{id}` | JWT (owner) | Sửa cấu hình. |
| DELETE | `/api/users/me/providers/{id}` | JWT (owner) | Xoá provider cá nhân. |
| POST | `/api/users/me/providers/{id}/test` | JWT (owner) | Gọi thử kết nối provider (qua FastAPI), trả kết quả pass/fail. |
| GET | `/api/users/me/providers/{id}/voices?language=` | JWT (owner) | List `tts_voices(provider_source=USER)` đã cache. |
| POST | `/api/users/me/providers/{id}/voices/refresh` | JWT (owner) | Đồng bộ lại danh sách voice từ provider. |
| GET | `/api/tts-voices?language=&providerSource=PLATFORM` | JWT | Danh mục voice nền tảng (`platform_ai_providers`) dùng khi user không có BYOK phù hợp — phục vụ UI chọn giọng khi tạo job. |
| POST | `/api/tts-voices/preview` | JWT | `{voiceId, text}` (`text` ≤ 50 ký tự, `@NotBlank`) → `{audioUrl, expiresInSeconds}` — nghe thử giọng: tổng hợp audio ngắn qua `POST /media/tts` của `backend-ai`, upload MinIO (`temp/voice-preview/<userId>/<uuid>.<ext>`), `audioUrl` là presigned GET (TTL `app.storage.presigned-ttl-seconds`, mặc định 3600s). `voiceId` là `tts_voices.id` (UUID). Voice `providerSource=USER` chỉ owner của `user_ai_providers` đó gọi được (không khớp → `404`). **Không trừ Credit** — chỉ rate limit theo user. Lỗi: `404 TTS_VOICE_NOT_FOUND`, `400 PROVIDER_CAPABILITY_NOT_SUPPORTED`, `400 PLATFORM_PROVIDER_NOT_CONFIGURED`, `429 TTS_PREVIEW_RATE_LIMIT_EXCEEDED`, `502 TTS_PREVIEW_FAILED`. |

---

## 12. Thông báo (SRS §5.7)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/notifications?unread=true` | LEAD/MEMBER/CLIENT | List `notifications` của user hiện tại trong Workspace. |
| POST | `/api/workspaces/{workspaceId}/notifications/{id}/read` | LEAD/MEMBER/CLIENT (owner) | Đánh dấu đã đọc. |
| POST | `/api/workspaces/{workspaceId}/notifications/read-all` | LEAD/MEMBER/CLIENT (owner) | Đánh dấu toàn bộ đã đọc. |

---

## 13. Dashboard (SRS §2.4)

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/workspaces/{workspaceId}/dashboard` | LEAD/MEMBER/CLIENT | Tổng hợp nhanh: số job theo status, batch đang chạy, Credit còn lại (nếu Lead: của Workspace theo cost_mode). |

---

## 14. Callback nội bộ Worker → Spring (Arch §1 mục 4, §12)

Không dùng JWT. Xác thực bằng HMAC-SHA256: header `X-Signature` (ký trên raw body + timestamp),
`X-Timestamp` (bị từ chối nếu lệch quá **±5 phút**). Idempotent theo `dedupeKey` trong body — gọi lại với
cùng `dedupeKey` không xử lý 2 lần.

| Method | Path | Mô tả |
|---|---|---|
| POST | `/internal/media/render/progress` | `{jobId, stageId, dedupeKey, progressPercent}` — cập nhật `media_job_stages.progress_percent`. |
| POST | `/internal/media/render/complete` | `{jobId, stageId, dedupeKey, outputRef, success, errorMessage?}` — set `COMPLETED`/`FAILED`, tiếp tục pipeline. |
| POST | `/internal/media/audio-mix/progress` | Cùng shape, stage `AUDIO_MIX`. |
| POST | `/internal/media/audio-mix/complete` | Cùng shape, stage `AUDIO_MIX`. |

> `EXTRACT_AUDIO`/`SOURCE_SEPARATION` (FFmpeg, cũng do `backend-media-worker` xử lý) dùng đúng cùng hợp đồng
> HMAC + shape `{jobId, stageId, dedupeKey, ...}` qua `/internal/media/{stage}/progress|complete` tương ứng
> — mọi mutation trạng thái job qua callback phải serialize bằng `SELECT ... FOR UPDATE` trên `media_jobs`
> trong cùng transaction (Arch §12, invariant khoá ghi). `STT`/`TRANSLATE`/`SUMMARIZE`/`TTS`/`VISION` là lời
> gọi đồng bộ Spring→FastAPI (không qua queue/callback vì FastAPI stateless, trả kết quả ngay trong response).

---

## 15. Mã lỗi (`ErrorCode` — theo `api-response-convention.md`)

`code` trong `ApiResponse` là **số nguyên**, tra bảng `com.app.common.exception.ErrorCode`. Enum này là
**nguồn sự thật cho toàn bộ mã lỗi của `backend-main`** — controller không tự tạo message/status rời rạc,
mọi lỗi nghiệp vụ ném qua `new AppException(ErrorCode.XXX)`.

### 15.1 Mã hệ thống dùng chung (module nào cũng có thể ném)

| `ErrorCode` | `code` | HTTP | Khi nào |
|---|---|---|---|
| `SUCCESS` | 1000 | 200 | Mặc định cho mọi response thành công. |
| `RESOURCE_NOT_FOUND` | 9995 | 404 | Không thấy resource hoặc không có quyền xem (không phân biệt để tránh lộ thông tin). |
| `UNAUTHORIZED` | 9996 | 403 | Không đủ quyền (role/project assignment/job-ownership) — dùng chung, không thay thế mã nghiệp vụ cụ thể hơn ở §15.3 khi đã có. |
| `UNAUTHENTICATED` | 9997 | 401 | Thiếu/hết hạn JWT. |
| `VALIDATION_ERROR` | 9998 | 400 | Lỗi `@Valid` — lỗi theo field nằm trong `data` (xem ví dụ §0). |
| `UNCATEGORIZED_EXCEPTION` | 9999 | 500 | Lỗi không lường trước — không lộ stacktrace/message gốc ra `message`, chỉ log server-side. |

### 15.2 Dải mã theo module (đúng thứ tự bảng §4.8 của `CLAUDE.md`)

Mỗi module sở hữu 1 dải 100 mã — chỉ được thêm `ErrorCode` mới trong đúng dải của module mình, không dùng
chung/lấn dải module khác (tránh 2 người thêm trùng số khi làm song song, tương tự quy ước `pom.xml` §4.9).

| Module | Dải `code` | Đã dùng |
|---|---|---|
| `auth` | 2000–2099 | — |
| `workspace` | 2100–2199 | `WORKSPACE_NOT_FOUND` = 2100, `WORKSPACE_MEMBER_NOT_FOUND` = 2101, `LEAD_CANNOT_BE_REMOVED` = 2102, `WORKSPACE_MEMBER_ALREADY_EXISTS` = 2103, `CANNOT_ASSIGN_LEAD_ROLE` = 2104, `WORKSPACE_SLUG_ALREADY_EXISTS` = 2105 |
| `project` | 2200–2299 | `PROJECT_NOT_FOUND` = 2200, `PROJECT_MEMBER_NOT_FOUND` = 2201, `PROJECT_ACCESS_DENIED` = 2202, `USER_NOT_WORKSPACE_MEMBER` = 2203, `LEAD_ALREADY_HAS_FULL_PROJECT_ACCESS` = 2204, `PROJECT_MEMBER_ALREADY_EXISTS` = 2205 |
| `credit` | 2300–2399 | `INSUFFICIENT_CREDIT` = 2300, `CREDIT_PACKAGE_NOT_FOUND` = 2301, `CREDIT_PACKAGE_INACTIVE` = 2302, `CREDIT_ACCOUNT_NOT_FOUND` = 2303 |
| `provider` | 2400–2499 | `PROVIDER_NOT_FOUND` = 2400, `PROVIDER_CAPABILITY_NOT_SUPPORTED` = 2401, `PROVIDER_TEST_FAILED` = 2402, `PROVIDER_VOICES_FETCH_FAILED` = 2403, `PLATFORM_PROVIDER_NOT_CONFIGURED` = 2404, `INVALID_PROVIDER_PROTOCOL` = 2405, `TTS_VOICE_NOT_FOUND` = 2406, `TTS_PREVIEW_RATE_LIMIT_EXCEEDED` = 2407, `TTS_PREVIEW_FAILED` = 2408 |
| `preset` | 2500–2599 | `PRESET_NOT_FOUND` = 2500, `PRESET_INACTIVE` = 2501, `PRESET_SCOPE_INVALID` = 2502, `CANNOT_DELETE_ONLY_DEFAULT_PRESET` = 2503, `SYSTEM_PRESET_READ_ONLY` = 2504, `PRESET_DEFAULT_CONFLICT` = 2505, `REPLACEMENT_PRESET_INVALID` = 2506 |
| `notification` | 2600–2699 | `NOTIFICATION_NOT_FOUND` = 2600, `NOTIFICATION_TYPE_INVALID` = 2601 |
| `dashboard` | 2700–2799 | `DASHBOARD_DATE_RANGE_INVALID` = 2700, `DASHBOARD_GROUP_BY_INVALID` = 2701 |
| `media_asset` | 2800–2899 | `TERMS_NOT_ACCEPTED` = 2800, `MEDIA_FILE_TOO_LARGE` = 2801, `MEDIA_DURATION_EXCEEDED` = 2802, `TERMS_VERSION_MISMATCH` = 2803 |
| `media_job` | 2900–2999 | `VOICE_LANGUAGE_MISMATCH` = 2900, `JOB_OWNERSHIP_REQUIRED` = 2901, `STAGE_NOT_READY` = 2902, `STYLE_NOT_FOUND` = 2903, `INVALID_STYLE_KEY` = 2904, `DOWNLOAD_SELECTION_TOO_LARGE` = 2905 |
| `summarization` | 3000–3099 | `REFINE_LIMIT_REACHED` = 3000, `PROPOSAL_ALREADY_TRANSLATED` = 3001 |
| `batch` | 3100–3199 | `BATCH_SIZE_EXCEEDED` = 3100, `BATCH_RATE_LIMIT_EXCEEDED` = 3101 |
| `glossary` | 3200–3299 | — |
| `qa` | 3300–3399 | `QA_BLOCKED` = 3300, `OVERRIDE_NOT_ALLOWED` = 3301 |

### 15.3 Mã nghiệp vụ đã xác định (đối chiếu 1:1 với bản `code` string cũ trước bản 1.1)

| `ErrorCode` | `code` | HTTP | Khi nào |
|---|---|---|---|
| `WORKSPACE_NOT_FOUND` | 2100 | 404 | Workspace không tồn tại hoặc user không có quyền xem. |
| `WORKSPACE_MEMBER_NOT_FOUND` | 2101 | 404 | Thành viên không tồn tại trong Workspace. |
| `LEAD_CANNOT_BE_REMOVED` | 2102 | 400 | Cố xoá hoặc hạ role của Workspace Lead. |
| `WORKSPACE_MEMBER_ALREADY_EXISTS` | 2103 | 409 | User đã là thành viên trong Workspace. |
| `CANNOT_ASSIGN_LEAD_ROLE` | 2104 | 400 | Cố mời hoặc đổi role thành Lead (chỉ đúng 1 Lead/workspace). |
| `WORKSPACE_SLUG_ALREADY_EXISTS` | 2105 | 409 | Slug của Workspace đã được sử dụng. |
| `PROJECT_NOT_FOUND` | 2200 | 404 | Project không tồn tại hoặc không thuộc Workspace. |
| `PROJECT_MEMBER_NOT_FOUND` | 2201 | 404 | User không được gán vào Project này. |
| `PROJECT_ACCESS_DENIED` | 2202 | 403 | User không có quyền truy cập Project. |
| `USER_NOT_WORKSPACE_MEMBER` | 2203 | 400 | User phải là thành viên Workspace trước khi được gán vào Project. |
| `LEAD_ALREADY_HAS_FULL_PROJECT_ACCESS` | 2204 | 400 | Workspace Lead đã có toàn quyền truy cập Project, không thể gán qua project_members. |
| `PROJECT_MEMBER_ALREADY_EXISTS` | 2205 | 409 | User đã được gán vào Project này. |
| `VOICE_LANGUAGE_MISMATCH` | 2900 | 400 | Giọng chọn không cùng ngôn ngữ với `target_lang`. |
| `JOB_OWNERSHIP_REQUIRED` | 2901 | 403 | Member cố QA/override/checkpoint trên job không do mình tạo. |
| `STAGE_NOT_READY` | 2902 | 409 | Rerun-from-stage khi stage trước chưa `COMPLETED/SKIPPED`; override-source-lang khi STT chưa xong / job đã kết thúc lỗi / có stage đang chạy. |
| `STYLE_NOT_FOUND` | 2903 | 404 | Key style hệ thống không tồn tại, hoặc job chưa được gán style. |
| `INVALID_STYLE_KEY` | 2904 | 400 | Key style sai định dạng (`^[a-z0-9][a-z0-9-]{0,63}$`). |
| `DOWNLOAD_SELECTION_TOO_LARGE` | 2905 | 400 | Chọn quá số video tối đa cho 1 lần tải zip (mặc định 20). |
| `TERMS_NOT_ACCEPTED` | 2800 | 403 | Tạo job từ asset chưa có `media_consents` khớp `terms_version` hiện hành. |
| `MEDIA_FILE_TOO_LARGE` | 2801 | 400 | Upload video vượt 500MB (SRS §6), enforce ở service layer. |
| `MEDIA_DURATION_EXCEEDED` | 2802 | 400 | Video vượt 30 phút (SRS §6), enforce ở service layer sau khi ffprobe. |
| `TERMS_VERSION_MISMATCH` | 2803 | 400 | `termsVersion` gửi lên không khớp `terms_versions.is_current` tại thời điểm consent. |
| `INSUFFICIENT_CREDIT` | 2300 | 402 | Số dư không đủ khi tạo job hoặc trừ credit. |
| `CREDIT_PACKAGE_NOT_FOUND` | 2301 | 404 | Gói credit không tồn tại. |
| `CREDIT_PACKAGE_INACTIVE` | 2302 | 400 | Gói credit đang tạm ngưng không khả dụng để mua. |
| `CREDIT_ACCOUNT_NOT_FOUND` | 2303 | 404 | Không tìm thấy tài khoản credit của người dùng. |
| `REFINE_LIMIT_REACHED` | 3000 | 429 | Vượt 5 lần refine/phiên Summarization. |
| `PROPOSAL_ALREADY_TRANSLATED` | 3001 | 409 | Đổi `selected_proposal_id` hoặc refine phương án đang chọn khi stage `TRANSLATE` của job đã `COMPLETED` từ phương án đó (SRS §5.5 — phải rerun-from-stage `TRANSLATE` trước). |
| `BATCH_SIZE_EXCEEDED` | 3100 | 400 | `sourceAssetIds` rỗng hoặc > 20 khi tạo batch. |
| `BATCH_RATE_LIMIT_EXCEEDED` | 3101 | 429 | Vượt giới hạn tạo batch/khoảng thời gian của user (mặc định 5 lần/10 phút — cần BA xác nhận). |
| `QA_BLOCKED` | 3300 | 403 | Xuất bản/dựng video/publish-package khi còn `qa_issues` chặn hành động tương ứng chưa resolve/override. |
| `OVERRIDE_NOT_ALLOWED` | 3301 | 403 | Cố override `issue_type` thuộc nhóm không bao giờ override được. |
| `PROVIDER_NOT_FOUND` | 2400 | 404 | Nguồn AI (BYOK) không tồn tại hoặc không thuộc quyền sở hữu của user. |
| `PROVIDER_CAPABILITY_NOT_SUPPORTED` | 2401 | 400 | Nguồn AI không hỗ trợ capability được yêu cầu (ví dụ cố refresh voice trên provider không hỗ trợ TTS). |
| `PROVIDER_TEST_FAILED` | 2402 | 400 | Thử nghiệm kết nối tới nhà cung cấp AI thất bại. |
| `PROVIDER_VOICES_FETCH_FAILED` | 2403 | 502 | Không thể đồng bộ danh sách giọng đọc từ nhà cung cấp AI. |
| `PLATFORM_PROVIDER_NOT_CONFIGURED` | 2404 | 400 | Hệ thống chưa cấu hình nguồn AI nền tảng cho capability này. |
| `INVALID_PROVIDER_PROTOCOL` | 2405 | 400 | Giao thức provider không hợp lệ hoặc không được hỗ trợ. |
| `TTS_VOICE_NOT_FOUND` | 2406 | 404 | Giọng đọc TTS không tồn tại. |
| `TTS_PREVIEW_RATE_LIMIT_EXCEEDED` | 2407 | 429 | Vượt giới hạn nghe thử giọng TTS của user (mặc định 5 lần/60 giây, cấu hình `app.rate-limit.voice-preview.*`). |
| `TTS_PREVIEW_FAILED` | 2408 | 502 | Provider TTS không trả về audio preview (lỗi gateway/provider hoặc audio rỗng). |
| `PRESET_NOT_FOUND` | 2500 | 404 | Preset không tồn tại hoặc không thuộc quyền xem của user. |
| `PRESET_INACTIVE` | 2501 | 400 | Preset đang ở trạng thái ngừng kích hoạt. |
| `PRESET_SCOPE_INVALID` | 2502 | 400 | Scope hoặc ràng buộc sở hữu workspace/project của preset không hợp lệ. |
| `CANNOT_DELETE_ONLY_DEFAULT_PRESET` | 2503 | 400 | Không thể xóa preset mặc định duy nhất trong scope nếu không chỉ định preset thay thế. |
| `SYSTEM_PRESET_READ_ONLY` | 2504 | 403 | Preset cấp hệ thống do nền tảng quản trị, không thể tạo, sửa hoặc xóa qua API tenant. |
| `PRESET_DEFAULT_CONFLICT` | 2505 | 409 | Đã tồn tại preset mặc định trong scope này. |
| `REPLACEMENT_PRESET_INVALID` | 2506 | 400 | Preset thay thế phải tồn tại, đang active và thuộc cùng scope. |
| `NOTIFICATION_NOT_FOUND` | 2600 | 404 | Không tìm thấy thông báo hoặc không thuộc quyền sở hữu của người dùng. |
| `NOTIFICATION_TYPE_INVALID` | 2601 | 400 | Loại thông báo không hợp lệ. |
| `DASHBOARD_DATE_RANGE_INVALID` | 2700 | 400 | Khoảng thời gian không hợp lệ: 'from' phải trước hoặc bằng 'to'. |
| `DASHBOARD_GROUP_BY_INVALID` | 2701 | 400 | Tham số groupBy không hợp lệ (chỉ hỗ trợ 'project', 'user', 'operation'). |

Thêm mã mới: phụ trách module nào tự thêm `ErrorCode` trong đúng dải của mình (§15.2), cập nhật bảng §15.3
trong cùng PR — không để `ErrorCode` trong code lệch với bảng ở đây.

