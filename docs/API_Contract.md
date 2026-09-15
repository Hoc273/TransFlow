# API Contract — TransFlow Media (transflow_mini)

> Phiên bản: **1.0** · Bám sát `SRS.md` 1.4b, `System_Architecture.md` 3.3, `Database_Design.md` 3.3.
> Chỉ mô tả API của `backend-main` (Spring Boot) — nguồn sự thật duy nhất chạm PostgreSQL. FastAPI
> (`backend-ai`) và `backend-media-worker` không có API public, chỉ được Spring gọi nội bộ.
> Không có endpoint nào cho Document/Translation Job/Text Editor/Translation Memory/Batch dịch file/
> Creative Production/Platform Admin — các domain này ngoài phạm vi (xem `CLAUDE.md` §3).

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
- **Lỗi** — response envelope thống nhất:
  ```json
  {
    "status": 400,
    "error": "Bad Request",
    "message": "targetLang phải cùng ngôn ngữ với voice đã chọn",
    "path": "/api/workspaces/{workspaceId}/media/jobs",
    "code": "VOICE_LANGUAGE_MISMATCH",
    "details": { "field": "reason cụ thể theo từng field, chỉ có ở lỗi validate" }
  }
  ```
  - `400` lỗi validate/nghiệp vụ (kèm `code` máy đọc được cho các luật nghiệp vụ quan trọng — xem §15).
  - `401` thiếu/hết hạn JWT. `403` không đủ quyền (role/project assignment/job-ownership). `404` không thấy
    resource hoặc không có quyền xem (không phân biệt để tránh lộ thông tin). `409` xung đột trạng thái
    (ví dụ rerun-from-stage khi stage trước chưa COMPLETED). `429` rate limit (tạo batch).
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
| `summary.script_match` | `requestedDurationSeconds` (giây, > 0) |

| Method | Path | Role | Mô tả |
|---|---|---|---|
| POST | `/api/workspaces/{workspaceId}/media/jobs` | LEAD/MEMBER (project của asset) | Tạo job — xem body mẫu dưới. Yêu cầu asset đã có consent. |
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/media/jobs?status=&recipeId=` | LEAD/MEMBER/CLIENT | List job trong Project (không lọc theo `created_by`). |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}` | LEAD/MEMBER/CLIENT | Chi tiết job + `stages[]` (8 stage kỹ thuật, FE tự ẩn stage `SKIPPED`). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/cancel` | LEAD/MEMBER (project) | Huỷ job đang chạy; gửi cancel xuống Worker sau khi transaction commit (Arch §6.2). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/voice` | LEAD/MEMBER (project) | `{ttsVoiceId}` (null = bỏ chọn giọng, chỉ hợp lệ nếu `output_audio_mode=ORIGINAL_ONLY`). Từ chối nếu `tts_voices.language ≠ target_lang`. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/checkpoints/{checkpoint}/confirm` | **job-ownership** (Lead mọi job; Member chỉ job `created_by_user_id = mình`; Client bị chặn) | `{checkpoint}` ∈ `CUT_CONFIRMED\|REVIEW_CONFIRMED\|PUBLISH_CONFIRMED`. Chỉ áp dụng khi `workflow_mode=MANUAL` (Arch §5.6). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/stages/{stageName}/rerun` | LEAD/MEMBER (project) | Rerun-from-stage (Arch §5.7). `409` nếu stage trước chưa `COMPLETED/SKIPPED`. Không tính lại Credit cho stage output tái sử dụng. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/subtitles` | LEAD/MEMBER/CLIENT | List `subtitle_segments` theo `seq`. |
| PATCH | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/subtitles/{segmentId}` | LEAD/MEMBER (project) | `{targetText?, startMs?, endMs?}`. Nếu job đã qua TTS/RENDER → set các stage sau `STALE`, không tự rerun (SRS §5.3). |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/export?format=VIDEO\|SUBTITLE` | LEAD/MEMBER/CLIENT | URL tải kết quả đã publish. `403` nếu còn QA lỗi `CRITICAL` chưa override (SRS §5.3). |

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
| GET | `/api/workspaces/{workspaceId}/batches/{batchId}/download` | LEAD/MEMBER/CLIENT | URL gói nén kết quả các job con đã `COMPLETED`. |

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
| POST | `/api/workspaces/{workspaceId}/qa-issues/{issueId}/override` | **job-ownership** (Lead mọi job; Member chỉ job của mình; Client luôn `403`) | `{reason}` (≥10 ký tự, bắt buộc). Ghi `qa_issue_overrides`, luôn lưu vết. `403` với `code=OVERRIDE_NOT_ALLOWED` nếu `issue_type` thuộc nhóm không bao giờ override được (ví dụ `subtitle_overlap` CRITICAL) — áp dụng cả với Lead. |

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

## 15. Mã lỗi nghiệp vụ quan trọng (`code` trong `ApiError`)

| `code` | HTTP | Khi nào |
|---|---|---|
| `VOICE_LANGUAGE_MISMATCH` | 400 | Giọng chọn không cùng ngôn ngữ với `target_lang`. |
| `TERMS_NOT_ACCEPTED` | 403 | Tạo job từ asset chưa có `media_consents` khớp `terms_version` hiện hành. |
| `QA_BLOCKED` | 403 | Xuất bản/dựng video/publish-package khi còn `qa_issues` chặn hành động tương ứng chưa resolve/override. |
| `OVERRIDE_NOT_ALLOWED` | 403 | Cố override `issue_type` thuộc nhóm không bao giờ override được. |
| `JOB_OWNERSHIP_REQUIRED` | 403 | Member cố QA/override/checkpoint trên job không do mình tạo. |
| `STAGE_NOT_READY` | 409 | Rerun-from-stage khi stage trước chưa `COMPLETED/SKIPPED`. |
| `REFINE_LIMIT_REACHED` | 429 | Vượt 5 lần refine/phiên Summarization. |
| `BATCH_SIZE_EXCEEDED` | 400 | `sourceAssetIds` > 20 khi tạo batch. |
| `INSUFFICIENT_CREDIT` | 402 | Số dư không đủ khi tạo job — hành vi mặc định `BLOCK_UPFRONT` (Arch §10.4, cấu hình được). |
