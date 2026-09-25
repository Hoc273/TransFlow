# API Contract — TransFlow Media (transflow_mini)

> Phiên bản: **1.2** · Bám sát `SRS.md` 1.4b, `System_Architecture.md` 3.3, `Database_Design.md` 3.4,
> `api-response-convention.md`. Chỉ mô tả API của `backend-main` (Spring Boot) — nguồn sự thật duy nhất chạm
> PostgreSQL. FastAPI (`backend-ai`) và `backend-media-worker` không có API public, chỉ được Spring gọi nội bộ.
> Không có endpoint nào cho Document/Translation Job/Text Editor/Translation Memory/Batch dịch file hoặc
> Creative Production. Platform Admin là bề mặt vận hành nội bộ trong phạm vi, xem §13.1.
>
> **Ghi chú cập nhật — 1.1:** đổi response envelope theo `api-response-convention.md` — mọi response (kể cả
> thành công) bọc trong `ApiResponse<T>{code:int, message, data}`; envelope cũ
> `{status,error,message,path,code:string,details}` không còn dùng. Mã lỗi HTTP trước đây nằm trong body
> (`status`) nay chỉ còn ở HTTP status code thật của response; `code` trong body chuyển từ string sang số
> nguyên tra theo `ErrorCode` (§15).
>
> **Ghi chú cập nhật — 1.2 (23/09/2026):** bổ sung các endpoint đã có trong code nhưng chưa được mô tả:
> Auth `PUT /api/auth/me`, `DELETE /api/auth/avatar`, `PUT /api/auth/password` (§1); Platform
> `GET /api/platform/realtime` và điều chỉnh Credit của user `GET|POST /api/platform/users/{userId}/credit/*`
> (§13.1 — nhóm Platform không còn read-only hoàn toàn); presence heartbeat `POST /api/presence/heartbeat`
> (§13.1); module Hướng dẫn — public `/api/guides/*` và quản trị `/api/platform/guides/*` (§13.2); mã lỗi
> Guide 3400–3404 (§15).

---

## 0. Quy ước chung

- **Base path**: mọi API người dùng nằm dưới `/api/...`; callback nội bộ từ Worker nằm dưới `/internal/...`
  (không đi qua JWT, xác thực bằng HMAC — xem §14).
- **Auth**: Bearer JWT (`Authorization: Bearer <accessToken>`) cho toàn bộ `/api/...`, trừ
  `/api/auth/register/**|login|refresh|forgot-password/**|google/*` và `/api/guides/**` (trang Hướng dẫn
  công khai, §13.2).
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
- **Đa tenant**: API nghiệp vụ chỉ trả dữ liệu thuộc `workspaceId` trên path. Ngoại lệ duy nhất là nhóm
  read-only `/api/platform/*`, chỉ dành cho user có `isPlatformAdmin=true` để quan sát toàn hệ thống.

---

## 1. Auth (SRS §5.1)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/auth/register` | không | `{email,password,fullName,otp?}` → tạo user; **lần đầu đăng nhập** trigger auto-init Workspace+Project+Credit (Arch §3). Trả `{accessToken,refreshToken,user,workspaceId,projectId}`. Nếu đã gọi `register/otp` cho email này thì `otp` bắt buộc (`OTP_REQUIRED`). |
| POST | `/api/auth/register/otp` | không | `{email}` → gửi OTP 6 số xác thực email đăng ký (Redis `auth:otp:register:<email>`, TTL 5 phút, lưu plain). Trả `{message}`. Email đã tồn tại → `EMAIL_ALREADY_EXISTS`. |
| POST | `/api/auth/login` | không | `{email,password}` → cùng response shape như trên. |
| POST | `/api/auth/refresh` | không (refresh token) | `{refreshToken}` → `{accessToken,refreshToken}`. Refresh token cũ **không** bị thu hồi sau reset mật khẩu (JWT stateless, chưa có cơ chế revocation). |
| GET | `/api/auth/me` | JWT | Thông tin user hiện tại (`UserResponse`): `{id,email,fullName,googleLinked,isPlatformAdmin,avatarUrl}`. |
| PUT | `/api/auth/me` | JWT | `{fullName, avatarUrl?}` → cập nhật hồ sơ (`fullName` bắt buộc, tối đa 200 ký tự). Trả `UserResponse`. |
| DELETE | `/api/auth/avatar` | JWT | Xoá avatar của user hiện tại (`users.avatar_url = null`). Trả `UserResponse`. |
| PUT | `/api/auth/password` | JWT | `{currentPassword?, newPassword}` → đổi mật khẩu (`newPassword` ≥ 8 ký tự). Nếu user đã có mật khẩu thì `currentPassword` bắt buộc và phải khớp, sai → `INVALID_CREDENTIALS`; tài khoản Google-only (chưa có `password_hash`) được đặt mật khẩu mới mà không cần `currentPassword`. `data` rỗng. |
| GET | `/api/auth/google/start` | không | Redirect sang Google OAuth2 consent screen. |
| GET | `/api/auth/google/callback` | không | Google redirect về; set cookie/state tạm, FE gọi `exchange` tiếp theo. |
| POST | `/api/auth/google/exchange` | không | `{code}` → cùng response shape `register/login`; nếu `google_sub` chưa gắn user nào thì chạy auto-init như lần đầu (Arch §3). |
| POST | `/api/auth/forgot-password/otp` | không | `{email}` → sinh OTP 6 số, lưu Redis `auth:otp:forgot:<email>` TTL 5 phút (plain text), gửi email (dev fallback: log console). **Luôn trả 200 `{message}` dù email không tồn tại/bị khoá** (chống dò tài khoản); tài khoản Google-only vẫn được gửi OTP để đặt mật khẩu. Rate limit theo email (mặc định 5 lần/10 phút) → `OTP_RATE_LIMIT_EXCEEDED`. |
| POST | `/api/auth/forgot-password/verify` | không | `{email,otp}` → kiểm tra khớp (không consume OTP), trả `{valid:true, token}` (`token` echo lại otp). OTP sai/hết hạn → `INVALID_OTP`. Sai ≥5 lần → OTP bị xoá (OTP đúng cũng `INVALID_OTP`). |
| POST | `/api/auth/forgot-password/reset` | không | `{email,otp,newPassword}` → verify lại OTP rồi xoá atomic, BCrypt cập nhật `users.password_hash`. OTP sai/hết hạn → `INVALID_OTP`. Trả `{message}`. |

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
| POST | `/api/workspaces/{workspaceId}/projects` | LEAD | `{name, sourceLang?, defaultGlossaryId?, tmEnabled?, domain?, tone?}` → tạo Project mới. `tmEnabled` là field tương thích UI cũ và không kích hoạt Translation Memory trong phạm vi v1.4b. |
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
| POST | `/api/workspaces/{workspaceId}/media/jobs` | LEAD/MEMBER (project của asset) | Tạo job — xem body mẫu dưới. Hỗ trợ recipe `localization.full`, `summary.script_match` (và alias `summary.generative`), `sourceLang`, `ttsProviderId`, `ttsVoiceId` (UUID row `tts_voices`), `keepOriginalAudio`. Voice active phải thuộc provider active và tương thích `targetLang` theo primary subtag trên `language` + `languages[]`. Yêu cầu asset đã có consent. |
| GET | `/api/workspaces/{workspaceId}/projects/{projectId}/media/jobs?status=&recipeId=` | LEAD/MEMBER/CLIENT | List job trong Project (không lọc theo `created_by`). |
| POST | `/api/workspaces/{workspaceId}/projects/{projectId}/media/jobs/download` | LEAD/MEMBER/CLIENT (project) | Tải nhiều video đã hoàn thành do user chọn (thay cho "tải theo Batch"; danh sách lấy từ endpoint trên với `status=COMPLETED`). Body `{jobIds:[uuid]}` (không rỗng, loại trùng, tối đa `app.media-job.max-bulk-download`=20 → `DOWNLOAD_SELECTION_TOO_LARGE`). Mỗi job phải thuộc project, `COMPLETED` và qua quality gate như `/export`; job không đạt vào `skipped` với `reason` `NOT_FOUND` (không tồn tại/khác project) `|` `NOT_COMPLETED` `|` `QA_BLOCKED`. Không job nào đạt → `QA_BLOCKED` (có job bị QA chặn) hoặc `STAGE_NOT_READY`. Trả `{downloadUrl, fileName, expiresAt, includedJobIds[], skipped[{jobId, reason}]}`: zip `<tên gốc>_<lang>_<jobId8>.mp4` được nén tạm rồi upload lên MinIO `tmp/downloads/` (tự hết hạn bằng lifecycle rule), `downloadUrl` là presigned URL. Chạy đồng bộ. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}` | LEAD/MEMBER/CLIENT | Chi tiết job + `stages[]` (8 stage kỹ thuật, FE tự ẩn stage `SKIPPED`). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/cancel` | LEAD/MEMBER (project) | Huỷ job đang chạy; gửi cancel xuống Worker sau khi transaction commit (Arch §6.2). Trả `200 OK` kèm `MediaJob` và `stages[]`. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/voice` | LEAD/MEMBER (project) | `{ttsProviderId,ttsVoiceId}` (cả hai null = bỏ chọn giọng, chỉ hợp lệ nếu `output_audio_mode=ORIGINAL_ONLY`). Hai ID phải được gửi theo cặp; provider phải active, có capability `TTS`, khả dụng với user; `ttsVoiceId` là UUID của row `tts_voices`, voice phải active, thuộc đúng provider và tương thích với `target_lang`. Tương thích được so case-insensitive theo primary subtag (`en`, `en-US`, `en_US` → `en`) trên `language` và mọi phần tử `languages[]`; blank/`und` không tự khớp ngôn ngữ thật. Trả `200 OK` kèm `MediaJob` và `stages[]`. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/checkpoints/{checkpoint}/confirm` | **job-ownership** (Lead mọi job; Member chỉ job `created_by_user_id = mình`; Client bị chặn) | `{checkpoint}` ∈ `CUT_CONFIRMED\|REVIEW_CONFIRMED\|PUBLISH_CONFIRMED`. Chỉ áp dụng khi `workflow_mode=MANUAL` (Arch §5.6). |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/stages/{stageName}/rerun` | LEAD/MEMBER (project) | Rerun-from-stage (Arch §5.7). `409` nếu stage trước chưa `COMPLETED/SKIPPED`. Không tính lại Credit cho stage output tái sử dụng. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/subtitles` | LEAD/MEMBER/CLIENT | List `subtitle_segments` theo `seq`. |
| PATCH | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/subtitles/{segmentId}` | LEAD; MEMBER chỉ job của mình | `{targetText?, startMs?, endMs?}`. Khoảng thời gian sau merge phải thoả `0 <= startMs < endMs`, sai → `VALIDATION_ERROR`. Nếu job đã qua TTS/RENDER → set các stage sau `STALE`, không tự rerun (SRS §5.3). |
| PUT | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/segments/batch` | LEAD; MEMBER chỉ job của mình | `{updates:[{segmentId, targetText?, startMs?, endMs?}]}` (tối đa 200, cấu hình `app.media-job.max-batch-subtitle-updates`). Một transaction, khoá job; field null = giữ nguyên; `segmentId` trùng/không thuộc job/vượt giới hạn/thời gian sai → `VALIDATION_ERROR` và không segment nào bị đổi. Stage sau TTS/RENDER `STALE` đúng 1 lần. Trả `List<SubtitleSegment>` theo thứ tự request; gọi lại cùng body là idempotent. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/override-source-lang` | LEAD; MEMBER chỉ job của mình | Body `{sourceLang}` (mã ISO 639-1, không phân biệt hoa/thường; danh sách hỗ trợ cấu hình `app.media-job.supported-source-langs`, mặc định `vi,en,zh,ja,ko,fr,de,es,th,id,ru`). Ghi `media_jobs.source_language` (khoá job `FOR UPDATE`); các stage `TRANSLATE` trở đi đang `COMPLETED` → `STALE`, **không tự chạy lại** — FE gọi `stages/TRANSLATE/rerun`. STT giữ nguyên. Ngôn ngữ không hỗ trợ, rỗng hoặc trùng ngôn ngữ đích → `VALIDATION_ERROR`; STT chưa `COMPLETED`, job `FAILED`/`CANCELLED` hoặc có stage đang chạy → `STAGE_NOT_READY` (409); đặt lại đúng ngôn ngữ hiện có là no-op. Trả `MediaJob`. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/render-config` | LEAD/MEMBER/CLIENT | Cấu hình dựng hình (`media_jobs.render_config`, chưa cấu hình → trả mặc định, không null): `{subtitleMode, subtitlePosition(TOP\|CENTER\|BOTTOM, mặc định BOTTOM), verticalOffsetPercent(-30..30), backgroundBox, backgroundColor(#RRGGBBAA)?, textColor(#RRGGBB)?, outputAspectRatio(ORIGINAL\|16:9\|9:16\|1:1\|4:3), confirmed(checkpoint PUBLISH_CONFIRMED), sourceVideoUrl?, sourceVideoUrlExpiresInSeconds, presentation?, effective{boxMode,ownedByStyle,resolvedLinePercent,deadControls[]}}`. `presentation = {subtitle:{displayMode(SENTENCE\|PHRASE\|WORD), wordsPerPhrase(3..10, chỉ PHRASE, mặc định 5; RENDER ngắt mỗi phân đoạn thành cụm ≤ N từ, chia đều, thời gian theo độ dài), layers[≤4, khớp giới hạn của worker]{layerType(COVER_BOX\|IMAGE\|WATERMARK), anchor(SUBTITLE\|TOP\|CENTER\|BOTTOM)?, xPercent/yPercent 0..100, widthPercent 20..100, heightPercent 5..50, colorHex?, opacity 0..1?}}, audio:{originalGainDb/ttsGainDb -30..12, ducking{enabled,gainDb -30..0,attackMs 0..1000,releaseMs 0..2000}}}`. `effective` chỉ tính từ dữ liệu đã lưu (không lưu DB); `ownedByStyle=false`, `deadControls=[]` cho tới khi có subtitle-styles. `sourceVideoUrl` là presigned URL (null nếu ký lỗi). |
| PUT | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/render-config` | LEAD; MEMBER chỉ job của mình | Body cùng các field ghi được ở trên (`subtitleMode(HARD_SUB\|SOFT_SUB)`, `subtitlePosition`, `verticalOffsetPercent`, `backgroundBox`, `backgroundColor`, `textColor`, `outputAspectRatio`, `presentation`); **field null/vắng = giữ nguyên**, `presentation` gửi thì thay cả khối. Enum/khoảng số/màu sai → `VALIDATION_ERROR`. Khoá job `FOR UPDATE`; stage `RENDER` đã COMPLETED → `STALE`. Trả như GET. |
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/rerun-render` | LEAD; MEMBER chỉ job của mình | Body tuỳ chọn = body PUT: lưu cấu hình (nếu có) rồi chạy lại từ stage `RENDER` (dùng chung logic `stages/RENDER/rerun`); stage trước chưa COMPLETED/SKIPPED → `STAGE_NOT_READY` (409, không lưu gì). `202 Accepted`, trả `MediaJob`. |
| GET | `/api/media/subtitle-styles` | mọi user đã đăng nhập | Danh sách style hệ thống (catalog cố định trong code `subtitle-styles.json`): `[{key, name, language?, thumbnail?, preview_text?, revision}]` — `style-classic`, `style-modern-clean`, `style-tiktok`, `style-cinema`, `style-neon`. **Ngoại lệ có chủ đích:** route không có `workspaceId` và field **snake_case** (FE `api/subtitleStyle.ts` đã xây theo contract này). |
| GET | `/api/media/subtitle-styles/{key}` | mọi user đã đăng nhập | `{key, name, revision, font_family(Arial\|DejaVu Sans), font_size(16..120), primary_color(#RRGGBB), outline_color, outline_width(0..8), shadow, bold, italic, alignment(left\|center\|right), margin_v, line_spacing, background?(#RRGGBBAA), opacity(0..100)}`. Key sai định dạng → `INVALID_STYLE_KEY` (400); không tồn tại → `STYLE_NOT_FOUND` (404). |
| GET | `/api/media/jobs/{jobId}/subtitle-style` | LEAD/MEMBER/CLIENT (project của job) | Snapshot 13 trường đang áp dụng (`media_jobs.subtitle_style`). Chưa gán → `STYLE_NOT_FOUND` (404) — FE coi là "chưa chọn style". |
| POST | `/api/media/jobs/{jobId}/subtitle-style` | LEAD; MEMBER chỉ job của mình | `{key}` → **ghi đè** snapshot, trả snapshot mới. Khoá job `FOR UPDATE`; snapshot thay đổi và `RENDER` đã COMPLETED → `STALE` (gán lại đúng style đang có là no-op). Sau khi gán, `render-config.effective.ownedByStyle=true`. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/export?format=VIDEO\|SRT\|VTT\|SUBTITLE` | LEAD/MEMBER/CLIENT | Kết quả đã publish: `{format, fileName, downloadUrl, content}`. `VIDEO` → `downloadUrl` là presigned URL video RENDER (TTL `app.storage.presigned-ttl-seconds`, mặc định 3600s); `SUBTITLE` → `content` là nội dung SRT. `409 STAGE_NOT_READY` nếu (`VIDEO`) job chưa `COMPLETED`/chưa có output RENDER, hoặc (`SRT`/`VTT`/`SUBTITLE`) stage `TRANSLATE` chưa `COMPLETED` — phụ đề tải được ngay sau TRANSLATE, không chờ RENDER; `400 VALIDATION_ERROR` nếu `format` sai; `403 QA_BLOCKED` nếu còn `qa_issues` chưa resolve/override có `BLOCK_PUBLISH` (SRS §5.3). `SRT`/`VTT` trả nội dung trong `content` (`SUBTITLE` là alias của `SRT`; VTT có header `WEBVTT`, mốc `HH:MM:SS.mmm`). |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/output-package` | LEAD/MEMBER/CLIENT (project) | Gói kỹ thuật cho Quick Preview: `{jobId, primaryVideoRef, primaryVideoDownloadUrl, audioTracks:[{role(ORIGINAL\|DUB\|MIX), storageRef?, downloadUrl?}], subtitleTracks:[{format(SRT\|VTT), language, available}], durationMs?, checksumSha256(null), artifactPins([])}`. Stage `RENDER` phải `COMPLETED`, không thì `STAGE_NOT_READY` (409). **Không** áp QA gate (dùng để xem trước). `ORIGINAL` khi job giữ âm thanh gốc; `DUB`/`MIX` lấy từ `output_ref` của stage `TTS`/`AUDIO_MIX` nếu có. `downloadUrl` là presigned URL (null nếu ký lỗi). `durationMs` lấy từ asset gốc. |
| GET | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/publish-package` | LEAD/MEMBER/CLIENT (project) | Bản nháp thông tin đăng bài (GENERIC, không auto-post): `{profile:"GENERIC", title?, description?, language, tags[], thumbnailRef?, sourceJobId, status:"DRAFT"}`; chưa lưu → nháp rỗng (`language` = `targetLang` của job). Lưu ở `media_jobs.publish_package`. |
| PUT | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/publish-package` | LEAD; MEMBER chỉ job của mình | Body `{title?(≤100), description?(≤5000), language?(mã ngôn ngữ, chỉ kiểm định dạng), tags?(≤30 mục, mỗi mục ≤50), thumbnailRef?(≤1000)}`; field null/vắng = giữ nguyên. Sai giới hạn → `VALIDATION_ERROR`; còn issue `BLOCK_PUBLISH` chưa xử lý → `QA_BLOCKED` (403). Khoá job `FOR UPDATE`. Trả như GET. |

`stages[]` trong chi tiết job và response mutation chứa `errorCode` cùng `errorDetail` khi stage lỗi; `errorMessage` là safe message để hiển thị dự phòng cho lỗi cũ/không nhận diện.

`stages[].outputRef` là storage ref bucket/key của artifact (RENDER/AUDIO_MIX/TTS/EXTRACT_AUDIO…), null với stage chỉ sinh dữ liệu (STT/TRANSLATE/SUMMARIZE) — không bao giờ trả JSON output gốc.

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
  "ttsProviderId": "uuid",
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
| POST | `/api/workspaces/{workspaceId}/media/jobs/{jobId}/summary-languages` | LEAD/MEMBER (project) | `{targetLang, ttsProviderId?, ttsVoiceId?}` — hai ID TTS phải cùng có hoặc cùng vắng; `ttsVoiceId` là UUID row `tts_voices` và phải tương thích `targetLang` theo primary subtag trên `language` + `languages[]`; chỉ khi phương án đã chọn là AI. Tạo 1 `media_jobs` mới với `source_summary_job_id` trỏ về job gốc, giữ nguyên đoạn đã chọn, `SUMMARIZE` = `SKIPPED` (Arch §7.7). |

### 5.2 Worker Capabilities & Readiness

| Method | Path | Role | Mô tả |
|---|---|---|---|
| GET | `/api/transformation/capabilities` | JWT (mọi user đã đăng nhập) | Projection toàn hệ thống (không workspace-scoped) về chế độ xử lý video khả dụng — FE gọi khi mở màn tạo job và revalidate ngay trước khi tạo để không đẩy job vào hàng đợi chết. `FAST` = dịch/lồng tiếng chuẩn, `STUDIO` = lồng tiếng nâng cao giữ ngữ điệu (cần source separation). Read-only; **luôn trả 200** — hạ tầng lỗi được báo qua cờ `available`/`unavailableReason`/`state`, **không** qua mã lỗi nghiệp vụ (không có `ErrorCode` riêng). |

**Shape `data` (camelCase):**

```json
{
  "protocolVersion": "1.0",
  "supportedExecutionModes": ["FAST", "STUDIO"],
  "defaultExecutionMode": "FAST",
  "availability": {
    "FAST": { "available": true, "unavailableReason": null },
    "STUDIO": { "available": false, "unavailableReason": "SEPARATION_DISABLED" }
  },
  "workerCapability": {
    "state": "READY",
    "workerCount": 1,
    "compatibleFastWorkers": 1,
    "compatibleStudioWorkers": 0
  },
  "readiness": {
    "status": "DRAINING",
    "readyExecutionModes": ["FAST"],
    "reasons": ["SEPARATION_DISABLED"],
    "evaluatedAt": "2026-09-22T08:00:00Z"
  }
}
```

**Quy tắc chiếu** (probe `GET /health` của `backend-ai` và `backend-media-worker` qua `common/health/ServiceHealthProbe`,
timeout `app.health-probe.timeout-ms` mặc định 2000ms; kết quả cache in-memory
`app.transformation.capabilities-cache-ttl-seconds` mặc định 5s để FE polling không dồn request xuống worker):

- `FAST` available ⇔ backend-ai **và** media-worker đều healthy (2xx + `status="ok"`). Nếu không:
  `unavailableReason` = `AI_GATEWAY_DOWN` hoặc `MEDIA_WORKER_DOWN` (cả hai down → `AI_GATEWAY_DOWN`).
- `STUDIO` available ⇔ `FAST` available **và** backend-ai báo `separation.engine` hợp lệ trong `/health`
  (tức `SEPARATION_ENGINE_ID` được cấu hình; rỗng/`none`/`disabled` → `unavailableReason` = `SEPARATION_DISABLED`).
  Khi `FAST` down, `STUDIO` kế thừa reason hạ tầng của `FAST`.
- `workerCapability.state`: cả hai service healthy → `READY`; chỉ một → `DEGRADED`; không có → `OFFLINE`.
  `workerCount` = số media-worker healthy (hiện tối đa 1); `compatibleFastWorkers` = `workerCount` khi worker
  healthy; `compatibleStudioWorkers` = `workerCount` khi worker healthy **và** separation bật.
- `readiness.status`: `READY` khi mọi `supportedExecutionModes` đều available, ngược lại `DRAINING`;
  `readyExecutionModes` = các mode đang available; `reasons` = tập `unavailableReason` không trùng.

> Backend **không** validate `requestedMode` khi tạo job — chống job chết là trách nhiệm của FE
> (revalidate bằng endpoint này ngay trước khi gọi `POST .../media/jobs`).

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
> Khi freeze, `renderConfig` của preset seed `media_jobs.render_config` và `subtitleStyle` (snapshot 13 field)
> seed `media_jobs.subtitle_style`; field tường minh của request tạo job (vd. `subtitleMode`) thắng preset.
> Hệ thống hiện không có preset SYSTEM mặc định, nên job không chọn preset (và không có default PROJECT/WORKSPACE)
> giữ `SOFT_SUB` + `outputAspectRatio=ORIGINAL`.

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
| POST | `/api/users/me/providers` | JWT | `{protocol, capabilities:[...], baseUrl, apiKey, defaultModel?, defaultForCapabilities:[...]}` → mã hoá AES-GCM trước khi lưu; default theo user + capability, capability phải được provider hỗ trợ và provider phải active. |
| PUT | `/api/users/me/providers/{id}` | JWT (owner) | Sửa cấu hình; `defaultForCapabilities` nếu có sẽ thay thế các capability đang default cho provider này. Response GET/POST/PUT trả `defaultForCapabilities`. |
| DELETE | `/api/users/me/providers/{id}` | JWT (owner) | Xoá provider cá nhân. |
| POST | `/api/users/me/providers/{id}/test?capability=TRANSLATE` | JWT (owner) | Tách auth probe và model/capability probe; capability probe gửi đúng `defaultModel` tới FastAPI. Trả `authSuccess` và `capabilityResults[]` có kết quả, code lỗi và model theo capability. Không truyền capability thì test các capability default; nếu chưa có default thì test các capability provider khai báo. |
| GET | `/api/users/me/providers/{id}/voices?language=` | JWT (owner) | List `tts_voices(provider_source=USER)` đã cache; filter `language` dùng chung primary-subtag compatibility trên cả `language` và `languages[]`. |
| POST | `/api/users/me/providers/{id}/voices/refresh` | JWT (owner) | Đồng bộ lại danh sách voice từ provider. |
| GET | `/api/tts-voices?language=&providerSource=PLATFORM` | JWT | Danh mục voice nền tảng (`platform_ai_providers`) dùng khi user không có BYOK phù hợp — phục vụ UI chọn giọng khi tạo job; filter `language` dùng chung primary-subtag compatibility trên cả `language` và `languages[]`. |
| POST | `/api/tts-voices/preview` | JWT | `{voiceId, text}` (`text` ≤ 50 ký tự, `@NotBlank`) → `{audioUrl, expiresInSeconds}` — nghe thử giọng: tổng hợp audio ngắn qua `POST /media/tts` của `backend-ai`, upload MinIO (`temp/voice-preview/<userId>/<uuid>.<ext>`), `audioUrl` là presigned GET (TTL `app.storage.presigned-ttl-seconds`, mặc định 3600s). `voiceId` là UUID `tts_voices.id`, không phải `tts_voices.voice_id`. Voice `providerSource=USER` chỉ owner của `user_ai_providers` đó gọi được (không khớp → `404`). **Không trừ Credit** — chỉ rate limit theo user. Lỗi: `404 TTS_VOICE_NOT_FOUND`, `400 PROVIDER_CAPABILITY_NOT_SUPPORTED`, `400 PLATFORM_PROVIDER_NOT_CONFIGURED`, `429 TTS_PREVIEW_RATE_LIMIT_EXCEEDED`, `502 TTS_PREVIEW_FAILED`. |

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

### 13.1 Platform Super Admin (SRS §5.8; Arch §11.1)

Tất cả endpoint dưới đây yêu cầu JWT và `users.is_platform_admin = true`. Cờ này độc lập với role
Workspace; tài khoản thường nhận `UNAUTHORIZED` (HTTP 403). Response vẫn bọc `ApiResponse<T>`.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/platform/overview?from=&to=&topLimit=10` | KPI toàn hệ thống trong khoảng thời gian: user, Workspace, Media Job theo trạng thái, token AI, tỉ lệ lỗi và top Workspace. |
| GET | `/api/platform/status` | Trạng thái và độ trễ của PostgreSQL, Redis, RabbitMQ, MinIO và AI/Media Worker tại `checkedAt`, kèm trạng thái tổng hợp. |
| GET | `/api/platform/realtime` | Snapshot hoạt động trực tiếp (job đang chạy, job hoàn thành hôm nay, token 1 giờ qua, user đang online). FE polling mỗi ~3s. |
| GET | `/api/platform/users?page=0&size=20&q=&isPlatformAdmin=` | Danh bạ user có phân trang; hỗ trợ tìm kiếm và lọc theo cờ Platform Admin. Không trả dữ liệu bí mật. |
| GET | `/api/platform/users/{userId}/credit/balance` | Số dư Credit hiện tại của một user bất kỳ. |
| POST | `/api/platform/users/{userId}/credit/adjust` | Cộng (`amount > 0`) hoặc trừ (`amount < 0`) Credit của một user bất kỳ, có ghi `credit_transactions`. |
| GET | `/api/platform/workspaces?page=0&size=20&q=` | Danh sách Workspace có phân trang, owner và số thành viên. |
| GET | `/api/platform/audit-logs?page=0&size=20&action=` | Nhật ký kiểm toán cấp nền tảng có phân trang, lọc theo action. |

Ngoài ra, quản trị nội dung trang Hướng dẫn nằm dưới `/api/platform/guides/*` — xem §13.2.

Nhóm API này read-only trong MVP, **trừ** điều chỉnh Credit của user (`POST .../credit/adjust`) và quản
trị Hướng dẫn (§13.2); không cấp endpoint sửa user/Workspace và không bỏ qua RBAC nghiệp vụ.

Quy tắc chung cho nhóm:

- **AuthZ**: mọi request phải có JWT hợp lệ **và** `users.is_platform_admin = true` — cờ được đọc lại từ
  DB ở tầng service cho từng request (không tin claim JWT), nên thu hồi quyền có hiệu lực ngay.
  Thiếu/sai JWT → `UNAUTHENTICATED` (401); user thường → `UNAUTHORIZED` (403).
- **Audit**: mọi request `/api/platform/*` (kể cả bị từ chối) được ghi vào `platform_admin_audit_logs`
  bởi `PlatformAdminAuditFilter` (chạy sau `JwtAuthFilter`). `DENIED` chỉ cho 401/403; các lỗi khác
  (400 validation, 500) vẫn ghi action theo endpoint đã gọi.
- **Phân trang**: `page` 0-based (mặc định 0), `size` mặc định 20, **clamp tối đa 100** (không báo lỗi).
  Envelope: `{content, page, size, totalElements, totalPages}`.

**`GET /api/platform/overview?from=&to=&topLimit=`**

- `from`/`to`: ISO-8601 instant. Mặc định `to = now`, `from = to − 7 ngày`. `from ≥ to` → `VALIDATION_ERROR` (400).
- `topLimit`: mặc định 10, clamp 1–50.

Response `data`:

```json
{
  "from": "...", "to": "...",
  "users":      { "total": 120, "newInRange": 8 },
  "workspaces": { "total": 34,  "newInRange": 2 },
  "jobs": {
    "mediaJobs":      { "created": 40, "completed": 30, "failed": 4, "processing": 3, "other": 3 },
    "batchJobs":      { "created": 10, "completed": 7,  "failed": 2, "processing": 1, "other": 0 },
    "textJobs":       { "available": false },
    "productionJobs": { "available": false }
  },
  "tokens": {
    "inputTokens": 1000, "outputTokens": 500, "totalTokens": 1500,
    "byOperation": { "TRANSLATE": { "inputTokens": 600, "outputTokens": 300 } }
  },
  "failRate": { "rate": 0.16, "failedCount": 6, "terminalCount": 37 },
  "topWorkspaces": [ { "workspaceId": "...", "workspaceName": "...", "totalTokens": 900, "jobCount": 5 } ]
}
```

- `jobs`: chỉ `mediaJobs` (`media_jobs`) và `batchJobs` (`localization_batches`) có số liệu thật —
  `textJobs`/`productionJobs` là marker `{"available": false}` vì domain đó không tồn tại trong mini
  (SRS §4.3). `created` = tổng các bucket còn lại; `other` gồm `PENDING`/`CANCELLED`/giá trị lạ;
  `PARTIALLY_FAILED` của batch tính vào `failed`.
- `failRate`: gộp cả 2 loại job — `rate = failed / (completed + failed)`, `null` khi `terminalCount = 0`.
- `tokens`/`topWorkspaces`: aggregate `ai_usage_logs` trong range (sẽ là 0/rỗng cho tới khi pipeline ghi log).

**`GET /api/platform/status`**

```json
{
  "checkedAt": "...",
  "overall": "UP | DEGRADED",
  "services": [
    { "id": "postgresql",  "name": "PostgreSQL",          "status": "UP|DOWN", "latencyMs": 3, "message": null },
    { "id": "redis",       "name": "Redis",               "status": "UP|DOWN", "latencyMs": 2, "message": null },
    { "id": "rabbitmq",    "name": "RabbitMQ",            "status": "UP|DOWN", "latencyMs": 5, "message": null },
    { "id": "minio",       "name": "MinIO",               "status": "UP|DOWN", "latencyMs": 8, "message": null },
    { "id": "ai_gateway",  "name": "AI Gateway (FastAPI)","status": "UP|DOWN", "latencyMs": 4, "message": null },
    { "id": "worker",      "name": "Media Worker",        "status": "UP|DOWN", "latencyMs": 4, "message": null }
  ]
}
```

- Probe song song (fail-open từng service): PostgreSQL `SELECT 1`; Redis `PING`; RabbitMQ mở connection;
  MinIO `bucketExists`; `ai_gateway`/`worker` gọi `GET {baseUrl}/health` (`app.ai.base-url`,
  `app.media-worker.base-url`, timeout `app.health-probe.timeout-ms`).
- `overall = UP` khi cả 6 `UP`, ngược lại `DEGRADED`. `message` đã lọc — không lộ connection string/credential.

**`GET /api/platform/realtime`**

```json
{ "processingJobs": 3, "completedToday": 12, "tokensLastHour": 4500, "onlineUsers": 7, "checkedAt": "..." }
```

- `processingJobs`: số `media_jobs` đang `PROCESSING` (chỉ Media Job, không tính batch).
- `completedToday`: `media_jobs` `COMPLETED` có `created_at` ≥ 00:00 UTC hôm nay.
- `tokensLastHour`: tổng `input_tokens + output_tokens` của `ai_usage_logs` trong 3600 giây gần nhất.
- `onlineUsers`: số user khác nhau có presence heartbeat trong cửa sổ **120 giây** gần nhất (xem
  `POST /api/presence/heartbeat` bên dưới). Nhiều tab của cùng user chỉ tính 1.
- FE (`PlatformOverviewPage`) polling mỗi ~3s. Endpoint này được audit với action `OTHER`.

**`POST /api/presence/heartbeat`** — không thuộc nhóm `/api/platform/*`

- Auth: JWT bất kỳ (không yêu cầu `isPlatformAdmin`). Body rỗng. Trả `{"recorded": true}`.
- FE gọi mỗi ~60s khi user đang đăng nhập (`usePresence`). Server lưu `userId → epoch giây` vào Redis ZSET
  `platform:presence:online`; entry cũ hơn 120s bị prune khi đọc. Redis lỗi → fallback bộ nhớ trong
  process (chỉ đúng khi chạy 1 instance). Không ghi `platform_admin_audit_logs`.

**`GET /api/platform/users`**

`data` = `PlatformPageResponse<PlatformUserItem>`; item:

```json
{ "id": "...", "email": "...", "fullName": "...", "status": "ACTIVE",
  "isPlatformAdmin": false, "createdAt": "...", "workspaceCount": 3 }
```

- `q` tìm `email` + `full_name` (LIKE, case-insensitive); `isPlatformAdmin=true|false` lọc theo cờ.
- Không trả `password_hash`, `google_sub`, hay thông tin provider.

**`GET /api/platform/users/{userId}/credit/balance`**

```json
{ "userId": "...", "balance": 120.5000 }
```

- User không tồn tại → `RESOURCE_NOT_FOUND` (404). Audit action `VIEW_USER_CREDIT`.

**`POST /api/platform/users/{userId}/credit/adjust`**

Request:

```json
{ "amount": -20.5, "reason": "Hoàn tiền job lỗi" }
```

Response `data`:

```json
{ "userId": "...", "amount": -20.5000, "balanceBefore": 120.5000, "balanceAfter": 100.0000,
  "reason": "Hoàn tiền job lỗi", "adjustedAt": "..." }
```

- `amount` bắt buộc, khác 0 (`amount = 0` hoặc thiếu → `VALIDATION_ERROR` 400); làm tròn 4 chữ số
  (`HALF_UP`). `reason` tuỳ chọn, tối đa 255 ký tự, trim; chuỗi rỗng → `null`.
- User không tồn tại → `RESOURCE_NOT_FOUND` (404). Số dư sau điều chỉnh < 0 → `INSUFFICIENT_CREDIT`.
- Khoá `credit_accounts` bằng `SELECT ... FOR UPDATE`; user chưa có `credit_accounts` thì tạo mới với số dư 0.
- Ghi `credit_transactions(type=ADJUSTMENT, user_id=<target>, performed_by_user_id=<admin>,
  ref_type='ADMIN_ADJUSTMENT', balance_after=...)`. `reason` hiện **chỉ được log server-side**, chưa lưu
  vào DB. Audit action `ADJUST_USER_CREDIT`.

**`GET /api/platform/workspaces`**

`data` = `PlatformPageResponse<PlatformWorkspaceItem>`; item:

```json
{ "id": "...", "name": "...", "slug": "...", "ownerUserId": "...",
  "ownerEmail": "...", "memberCount": 4, "createdAt": "..." }
```

- `q` tìm `name` + `slug`.

**`GET /api/platform/audit-logs`**

`data` = `PlatformPageResponse<PlatformAuditLogItem>`; item:

```json
{ "id": "...", "actorUserId": "...|null", "action": "VIEW_OVERVIEW",
  "httpMethod": "GET", "path": "/api/platform/overview", "queryString": "...|null",
  "ip": "...", "userAgent": "...", "statusCode": 200, "createdAt": "..." }
```

- Sort `createdAt DESC`. `action` ∈ `VIEW_OVERVIEW, VIEW_STATUS, LIST_USERS, LIST_WORKSPACES,
  LIST_AUDIT, VIEW_USER_CREDIT, ADJUST_USER_CREDIT, SEED_GRANT, DENIED, OTHER` (case-insensitive); giá trị
  lạ → `VALIDATION_ERROR` (400). `DENIED` = request bị từ chối 401/403; `OTHER` = path `/api/platform/*`
  không map được (hiện gồm `/realtime` và toàn bộ `/guides/*`).
  `actorUserId` null cho request không JWT và `SEED_GRANT` ghi lúc bootstrap.

**Seed Super Admin (startup)**: khi `app.platform-admin.seed-on-startup=true`, runner đọc
`PLATFORM_ADMIN_EMAILS` (CSV) và grant `is_platform_admin=true` cho user đã tồn tại — grant-only,
không tạo user mới, không revoke; mỗi grant ghi audit `SEED_GRANT`.

> Frontend (22/09/2026): route top-level `/platform/*` (Tổng quan/Trạng thái/Người dùng/Workspace/Audit),
> gate bởi `PlatformGuard` đọc `user.isPlatformAdmin` (lấy từ `GET /api/auth/me`). Link Sidebar chỉ hiện
> khi `isPlatformAdmin === true`.

### 13.2 Trang Hướng dẫn — Guide (DB §3.2)

Nội dung song ngữ vi/en gồm 2 cấp: **Category** → **Article**. Không phân trang (dữ liệu nhỏ), sort theo
`orderIndex ASC`.

**Public — không cần JWT** (`/api/guides/**` nằm trong `PUBLIC_PATHS`):

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/guides/categories?lang=vi` | List Category `isPublished=true`; `articleCount` chỉ đếm Article `PUBLISHED`. |
| GET | `/api/guides/articles?categoryId=&q=&lang=vi` | List Article `PUBLISHED`, lọc theo Category và/hoặc từ khoá `q` (LIKE không phân biệt hoa thường trên title/excerpt/content cả vi lẫn en). |
| GET | `/api/guides/articles/{slug}?lang=vi` | Chi tiết Article theo `slug`. Article không `PUBLISHED` hoặc Category chưa publish → `GUIDE_ARTICLE_NOT_FOUND` (404). |

- `lang` = `vi` (mặc định) | `en`. Các field `title`/`excerpt`/`content` (và `categoryTitle`) trả theo
  `lang`, fallback về bản `vi` khi bản `en` rỗng; các field `*Vi`/`*En` gốc luôn được trả kèm.
- Lưu ý: `GET /api/guides/articles` hiện **không** lọc theo `isPublished` của Category (khác với endpoint
  chi tiết theo slug).

**Quản trị — Platform Super Admin** (JWT + `isPlatformAdmin=true`, audit action `OTHER`):

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/platform/guides/categories` | List toàn bộ Category (kể cả chưa publish); `articleCount` đếm mọi trạng thái. |
| GET | `/api/platform/guides/categories/{id}` | Chi tiết Category. |
| POST | `/api/platform/guides/categories` | Tạo Category (HTTP 201). Body `GuideCategoryRequest`. |
| PUT | `/api/platform/guides/categories/{id}` | Sửa Category. Field `null` được giữ nguyên. |
| DELETE | `/api/platform/guides/categories/{id}` | Xoá Category; còn Article → `GUIDE_CATEGORY_HAS_ARTICLES` (400). |
| PATCH | `/api/platform/guides/categories/{id}/move` | `{orderIndex}` đặt thứ tự tuyệt đối, **hoặc** `{direction:"UP"\|"DOWN"}` hoán đổi `orderIndex` với Category liền kề (đang ở đầu/cuối thì không đổi). |
| GET | `/api/platform/guides/articles?categoryId=&q=&status=` | List Article mọi trạng thái; `status` = `DRAFT`\|`PUBLISHED`. |
| GET | `/api/platform/guides/articles/{id}` | Chi tiết Article (theo `id`, không theo slug). |
| POST | `/api/platform/guides/articles` | Tạo Article (HTTP 201). Body `GuideArticleRequest`. |
| PUT | `/api/platform/guides/articles/{id}` | Sửa Article. `slug`/`categoryId`/`status`/`orderIndex`/`content*` `null` được giữ nguyên; riêng `excerptVi`/`excerptEn`/`coverImageUrl` luôn bị ghi đè (gửi `null` = xoá). |
| DELETE | `/api/platform/guides/articles/{id}` | Xoá Article. |
| PATCH | `/api/platform/guides/articles/{id}/publish` | `{status: "DRAFT"\|"PUBLISHED"}` (bắt buộc). |
| GET | `/api/platform/guides/articles/{id}/preview?lang=vi` | Xem trước Article theo `lang` bất kể trạng thái. |

`GuideCategoryRequest`:

```json
{ "slug": "bat-dau", "titleVi": "Bắt đầu", "titleEn": "Getting started", "orderIndex": 0, "published": true }
```

- `titleVi`/`titleEn` bắt buộc (≤ 200). `slug` tuỳ chọn (≤ 120, `^[a-z0-9-]+$`) — bỏ trống thì sinh từ
  `titleVi`. `orderIndex` mặc định = số Category hiện có; `published` mặc định `true`.

`GuideArticleRequest`:

```json
{ "slug": "tao-job-dau-tien", "categoryId": "uuid", "titleVi": "...", "titleEn": "...",
  "excerptVi": "...", "excerptEn": "...", "contentVi": "# Markdown", "contentEn": "# Markdown",
  "orderIndex": 0, "coverImageUrl": "https://...", "status": "DRAFT" }
```

- Bắt buộc: `categoryId`, `titleVi`/`titleEn` (≤ 300), `contentVi`/`contentEn` (Markdown, ≤ 100 000 ký tự).
  Tuỳ chọn: `slug` (≤ 160, `^[a-z0-9-]+$`, bỏ trống thì sinh từ `titleVi`), `excerptVi`/`excerptEn` (≤ 500),
  `coverImageUrl` (≤ 1000), `orderIndex` (mặc định 0), `status` (mặc định `DRAFT`).
- `categoryId` không tồn tại → `GUIDE_CATEGORY_NOT_FOUND` (404).

Response:

```json
// GuideCategoryDto
{ "id": "...", "slug": "...", "title": "...", "titleVi": "...", "titleEn": "...", "orderIndex": 0,
  "published": true, "articleCount": 3, "createdAt": "...", "updatedAt": "..." }

// GuideArticleDto
{ "id": "...", "categoryId": "...", "categorySlug": "...", "categoryTitle": "...", "slug": "...",
  "title": "...", "titleVi": "...", "titleEn": "...", "excerpt": "...", "excerptVi": "...", "excerptEn": "...",
  "content": "...", "contentVi": "...", "contentEn": "...", "status": "PUBLISHED", "orderIndex": 0,
  "coverImageUrl": null, "createdAt": "...", "updatedAt": "..." }
```

- Slug (Category và Article, mỗi loại unique riêng) trùng → `GUIDE_SLUG_ALREADY_EXISTS` (409); sai định
  dạng → `INVALID_SLUG_FORMAT` (400) hoặc `VALIDATION_ERROR` (400) nếu bị `@Pattern` chặn trước.
- Endpoint admin trả các field đã localize theo `vi` (trừ `preview`).

> Frontend: trang công khai `/guide` và `/guide/:slug` (`GuidePage`), trang quản trị `/platform/guides`
> (`GuideAdminPage`).

---

## 14. Callback nội bộ Worker → Spring (Arch §1 mục 4, §12)

Không dùng JWT. Xác thực bằng HMAC-SHA256: header `X-Signature` (ký trên raw body + timestamp),
`X-Timestamp` (bị từ chối nếu lệch quá **±5 phút**). Idempotent theo `dedupeKey` trong body — gọi lại với
cùng `dedupeKey` không xử lý 2 lần.

| Method | Path | Mô tả |
|---|---|---|
| POST | `/internal/media/render/progress` | `{jobId, stageId, dedupeKey, progressPercent}` — cập nhật `media_job_stages.progress_percent`. |
| POST | `/internal/media/render/complete` | `{jobId, stageId, dedupeKey, outputRef, success, errorMessage?, errorCode?, errorDetail?}` — set `COMPLETED`/`FAILED`, tiếp tục pipeline. |
| POST | `/internal/media/audio-mix/progress` | Cùng shape, stage `AUDIO_MIX`. |
| POST | `/internal/media/audio-mix/complete` | Cùng shape, stage `AUDIO_MIX`. |

> `EXTRACT_AUDIO` (FFmpeg), `AUDIO_MIX` và `RENDER` do `backend-media-worker` xử lý và dùng cùng hợp đồng
> HMAC + shape `{jobId, stageId, dedupeKey, ...}` qua `/internal/media/{stage}/progress|complete` tương ứng
> — mọi mutation trạng thái job qua callback phải serialize bằng `SELECT ... FOR UPDATE` trên `media_jobs`
> trong cùng transaction (Arch §12, invariant khoá ghi). `SOURCE_SEPARATION` (Demucs), `STT`/`TRANSLATE`/
> `SUMMARIZE`/`TTS`/`VISION` là lời gọi đồng bộ Spring→FastAPI; pipeline hiện tại không dùng callback cho
> các stage này. Controller vẫn nhận diện callback path `source-separation` để tương thích.

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
| `auth` | 2000–2099 | `EMAIL_ALREADY_EXISTS` = 2000, `INVALID_CREDENTIALS` = 2001, `ACCOUNT_DISABLED` = 2002, `OAUTH_ONLY_ACCOUNT` = 2003, `INVALID_REFRESH_TOKEN` = 2004, `USER_NOT_FOUND` = 2005, `GOOGLE_OAUTH_FAILED` = 2006, `GOOGLE_EMAIL_UNVERIFIED` = 2007, `GOOGLE_ACCOUNT_CONFLICT` = 2008, `GOOGLE_NOT_CONFIGURED` = 2009, `GOOGLE_STATE_INVALID` = 2010, `INVALID_OTP` = 2011, `OTP_REQUIRED` = 2012, `OTP_RATE_LIMIT_EXCEEDED` = 2013 |
| `workspace` | 2100–2199 | `WORKSPACE_NOT_FOUND` = 2100, `WORKSPACE_MEMBER_NOT_FOUND` = 2101, `LEAD_CANNOT_BE_REMOVED` = 2102, `WORKSPACE_MEMBER_ALREADY_EXISTS` = 2103, `CANNOT_ASSIGN_LEAD_ROLE` = 2104, `WORKSPACE_SLUG_ALREADY_EXISTS` = 2105 |
| `project` | 2200–2299 | `PROJECT_NOT_FOUND` = 2200, `PROJECT_MEMBER_NOT_FOUND` = 2201, `PROJECT_ACCESS_DENIED` = 2202, `USER_NOT_WORKSPACE_MEMBER` = 2203, `LEAD_ALREADY_HAS_FULL_PROJECT_ACCESS` = 2204, `PROJECT_MEMBER_ALREADY_EXISTS` = 2205 |
| `credit` | 2300–2399 | `INSUFFICIENT_CREDIT` = 2300, `CREDIT_PACKAGE_NOT_FOUND` = 2301, `CREDIT_PACKAGE_INACTIVE` = 2302, `CREDIT_ACCOUNT_NOT_FOUND` = 2303 |
| `provider` | 2400–2499 | `PROVIDER_NOT_FOUND` = 2400, `PROVIDER_CAPABILITY_NOT_SUPPORTED` = 2401, `PROVIDER_TEST_FAILED` = 2402, `PROVIDER_VOICES_FETCH_FAILED` = 2403, `PLATFORM_PROVIDER_NOT_CONFIGURED` = 2404, `INVALID_PROVIDER_PROTOCOL` = 2405, `TTS_VOICE_NOT_FOUND` = 2406, `TTS_PREVIEW_RATE_LIMIT_EXCEEDED` = 2407, `TTS_PREVIEW_FAILED` = 2408, `PROVIDER_KEY_DECRYPTION_FAILED` = 2409, `PROVIDER_DEFAULT_NOT_CONFIGURED` = 2410, `PROVIDER_MODEL_NOT_CONFIGURED` = 2411 |
| `preset` | 2500–2599 | `PRESET_NOT_FOUND` = 2500, `PRESET_INACTIVE` = 2501, `PRESET_SCOPE_INVALID` = 2502, `CANNOT_DELETE_ONLY_DEFAULT_PRESET` = 2503, `SYSTEM_PRESET_READ_ONLY` = 2504, `PRESET_DEFAULT_CONFLICT` = 2505, `REPLACEMENT_PRESET_INVALID` = 2506 |
| `notification` | 2600–2699 | `NOTIFICATION_NOT_FOUND` = 2600, `NOTIFICATION_TYPE_INVALID` = 2601 |
| `dashboard` | 2700–2799 | `DASHBOARD_DATE_RANGE_INVALID` = 2700, `DASHBOARD_GROUP_BY_INVALID` = 2701 |
| `media_asset` | 2800–2899 | `TERMS_NOT_ACCEPTED` = 2800, `MEDIA_FILE_TOO_LARGE` = 2801, `MEDIA_DURATION_EXCEEDED` = 2802, `TERMS_VERSION_MISMATCH` = 2803 |
| `media_job` | 2900–2999 | `VOICE_LANGUAGE_MISMATCH` = 2900, `JOB_OWNERSHIP_REQUIRED` = 2901, `STAGE_NOT_READY` = 2902, `STYLE_NOT_FOUND` = 2903, `INVALID_STYLE_KEY` = 2904, `DOWNLOAD_SELECTION_TOO_LARGE` = 2905 |
| `summarization` | 3000–3099 | `REFINE_LIMIT_REACHED` = 3000, `PROPOSAL_ALREADY_TRANSLATED` = 3001 |
| `batch` | 3100–3199 | `BATCH_SIZE_EXCEEDED` = 3100, `BATCH_RATE_LIMIT_EXCEEDED` = 3101 |
| `glossary` | 3200–3299 | — |
| `qa` | 3300–3399 | `QA_BLOCKED` = 3300, `OVERRIDE_NOT_ALLOWED` = 3301 |
| `platform` (gồm `guide`) | 3400–3499 | `GUIDE_CATEGORY_NOT_FOUND` = 3400, `GUIDE_CATEGORY_HAS_ARTICLES` = 3401, `GUIDE_SLUG_ALREADY_EXISTS` = 3402, `GUIDE_ARTICLE_NOT_FOUND` = 3403, `INVALID_SLUG_FORMAT` = 3404 (các API Platform khác vẫn dùng mã chung `VALIDATION_ERROR`/`UNAUTHORIZED`/`RESOURCE_NOT_FOUND`/`INSUFFICIENT_CREDIT`) |

### 15.3 Mã nghiệp vụ đã xác định (đối chiếu 1:1 với bản `code` string cũ trước bản 1.1)

| `ErrorCode` | `code` | HTTP | Khi nào |
|---|---|---|---|
| `EMAIL_ALREADY_EXISTS` | 2000 | 409 | Đăng ký hoặc gửi OTP đăng ký với email đã tồn tại. |
| `INVALID_CREDENTIALS` | 2001 | 401 | Đăng nhập sai email/mật khẩu. |
| `ACCOUNT_DISABLED` | 2002 | 403 | Tài khoản không ở trạng thái ACTIVE. |
| `OAUTH_ONLY_ACCOUNT` | 2003 | 401 | Đăng nhập password cho tài khoản Google-only (chưa có `password_hash`). |
| `INVALID_REFRESH_TOKEN` | 2004 | 401 | Refresh token sai/hết hạn/không đúng loại. |
| `USER_NOT_FOUND` | 2005 | 401 | User không còn tồn tại (JWT/refresh hợp lệ nhưng user đã bị xoá). |
| `GOOGLE_OAUTH_FAILED` | 2006 | 401 | Đăng nhập Google thất bại (exchange code, lỗi provider...). |
| `GOOGLE_EMAIL_UNVERIFIED` | 2007 | 400 | Email Google chưa được xác minh. |
| `GOOGLE_ACCOUNT_CONFLICT` | 2008 | 409 | `google_sub` xung đột với tài khoản khác. |
| `GOOGLE_NOT_CONFIGURED` | 2009 | 400 | Môi trường chưa cấu hình Google OAuth. |
| `GOOGLE_STATE_INVALID` | 2010 | 400 | State OAuth Google không hợp lệ/hết hạn. |
| `INVALID_OTP` | 2011 | 400 | OTP sai, hết hạn, hoặc đã bị xoá do verify sai quá 5 lần (đăng ký & quên mật khẩu). |
| `OTP_REQUIRED` | 2012 | 400 | Đăng ký với email đã gửi OTP nhưng request không kèm `otp`. |
| `OTP_RATE_LIMIT_EXCEEDED` | 2013 | 429 | Vượt giới hạn gửi OTP quên mật khẩu theo email (mặc định 5 lần/10 phút, cấu hình `app.rate-limit.forgot-password-otp.*`). |
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
| `PROVIDER_KEY_DECRYPTION_FAILED` | 2409 | 500 | Decrypt API key lưu trong DB thất bại (`PROVIDER_KEY_ENC_SECRET` đã đổi hoặc data hỏng) — cần re-enter API key cho provider. |
| `PROVIDER_DEFAULT_NOT_CONFIGURED` | 2410 | 400 | Có nhiều personal provider active cho capability nhưng chưa chọn default, hoặc default hiện lưu không còn active/hỗ trợ capability. |
| `PROVIDER_MODEL_NOT_CONFIGURED` | 2411 | 400 | Provider đã được resolve nhưng `defaultModel` trống; cấu hình model trước khi chạy stage. |
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
| `GUIDE_CATEGORY_NOT_FOUND` | 3400 | 404 | Không tìm thấy Category Hướng dẫn (theo `id` hoặc `categoryId` trong body Article). |
| `GUIDE_CATEGORY_HAS_ARTICLES` | 3401 | 400 | Xoá Category khi vẫn còn Article thuộc nó. |
| `GUIDE_SLUG_ALREADY_EXISTS` | 3402 | 409 | Slug Category/Article đã tồn tại. |
| `GUIDE_ARTICLE_NOT_FOUND` | 3403 | 404 | Không tìm thấy Article, hoặc (API public) Article chưa `PUBLISHED`/Category chưa publish. |
| `INVALID_SLUG_FORMAT` | 3404 | 400 | Slug sau khi chuẩn hoá không khớp `^[a-z0-9-]+$` (ví dụ tiêu đề không sinh được slug hợp lệ). |

Thêm mã mới: phụ trách module nào tự thêm `ErrorCode` trong đúng dải của mình (§15.2), cập nhật bảng §15.3
trong cùng PR — không để `ErrorCode` trong code lệch với bảng ở đây.

