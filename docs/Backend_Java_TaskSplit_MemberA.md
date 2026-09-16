# Backend Java — Phân việc Thành viên A: Platform & Support Services

> Bám sát `API_Contract.md`, `docs/SRS.md` 1.4b, `System_Architecture.md` 3.3, `Database_Design.md` 3.3,
> `api-response-convention.md`. Trước khi code: đọc 5 tài liệu trên + khảo sát `../transflow/backend-main`
> theo đúng CLAUDE.md §4 (copy rồi cắt, không viết lại từ đầu, không copy nguyên khối chứa logic TM/Document)
> và nắm rõ cách chia module package ở CLAUDE.md §4.8, quy ước response/lỗi ở CLAUDE.md §4.10.

## 1. Phạm vi phụ trách

Thành viên A là **nền tảng** mà pipeline Media Studio (Thành viên B) phụ thuộc vào. Ưu tiên hoàn thành
trước hoặc song song sớm để B không bị block.

**Chia module theo `CLAUDE.md` §4.8** — mỗi package `com.app.modules.<name>` chỉ chứa đúng 1 nhóm bảng dưới
đây, không truy cập trực tiếp `repository`/`entity` của module do B phụ trách (§4.8 "Quy tắc biên module").

| Module (package) | API_Contract.md | Bảng DB sở hữu |
|---|---|---|
| `auth` — Auth (email/password + Google) | §1 | `users` |
| `workspace` — Workspace + Membership (RBAC 3 role) | §2 | `workspaces`, `workspace_members` |
| `project` — Project + Project assignment | §3 | `projects`, `project_members` |
| `credit` — Credit & Thanh toán | §10 | `credit_accounts`, `credit_transactions`, `credit_packages`, `credit_package_purchases`, `credit_pricing_config`, `workspace_billing_configs` |
| `provider` — Nguồn AI cá nhân (BYOK) + TTS voices | §11 | `user_ai_providers`, `platform_ai_providers`, `tts_voices` |
| `preset` — Preset (3 cấp + template) | §9 | `media_presets` |
| `notification` — Thông báo | §12 | `notifications` |
| `dashboard` — Dashboard (usage) | §13 | đọc `ai_usage_logs` (bảng do module `media_job` của B ghi, xem §4) |

Code dùng chung cả 2 module trở lên (`BaseEntity`, `ApiResponse`/`ErrorCode`/`AppException`/
`GlobalExceptionHandler`, JWT filter, HMAC/AES-GCM util, pagination helper) đặt trong package
`com.app.common` — sửa file trong đó phải báo trước cho B.

**Dải mã lỗi (`ErrorCode`) của Thành viên A** — theo `API_Contract.md` §15.2, chỉ thêm mã mới trong đúng
dải của module đang code, cập nhật đồng thời bảng §15.3: `auth` 2000–2099, `workspace` 2100–2199, `project`
2200–2299, `credit` 2300–2399 (đã dùng `INSUFFICIENT_CREDIT`=2300), `provider` 2400–2499, `preset`
2500–2599, `notification` 2600–2699, `dashboard` 2700–2799.

## 2. Việc cần làm theo từng module

### 2.1 Auth
- Copy `AuthController`, `GoogleAuthController` từ `../transflow/backend-main/src/main/java/com/app/controller`,
  cùng `AuthService`, entity `User`, security JWT filter/`AuthenticatedUser`.
- Sửa đúng response shape theo `API_Contract.md §1` (`{accessToken,refreshToken,user,workspaceId,projectId}`).
- **Quan trọng**: logic auto-init Workspace/Project/Credit/BillingConfig khi đăng nhập lần đầu (Arch §3) đặt
  trong `AuthService`/1 transaction — đây là điểm nối trực tiếp với module Workspace/Credit bên dưới, làm
  cùng lúc để tránh phải sửa lại 2 lần.

### 2.2 Workspace & Project
- Copy `WorkspaceController`, `ProjectController`, entity `Workspace`, `WorkspaceMember`, `Project`, `Role`.
- **Chỉnh sửa bắt buộc** (khác bản gốc): `Role`/`WorkspaceMember.role` chỉ còn `LEAD/MEMBER/CLIENT` — bỏ mọi
  giá trị role cũ (ADMIN/PM/TRANSLATOR/PROOFREADER). Đúng 1 `LEAD`/workspace (partial unique index, xem
  `Database_Design.md` §3).
- **Viết mới**: entity/repository `ProjectMember` — bảng này KHÔNG có cột role (khác bản gốc nếu có), chỉ
  xác nhận assignment. Toàn bộ endpoint `/projects/{projectId}/members` là code mới, không có tương đương
  1:1 trong `transflow` gốc (project ở bản gốc dùng role riêng theo project — bỏ hẳn logic đó).
- Viết `WorkspaceAccessService` (hoặc tương đương) cung cấp API dùng chung cho toàn team:
  - `requireProjectAccess(workspaceId, userId, projectId)` — Lead luôn pass; Member/Client cần row
    `project_members`.
  - `requireProjectWriteAccess(...)` — như trên + role phải là `LEAD`/`MEMBER` (không phải `CLIENT`).
  - `getRole(workspaceId, userId)` — trả `LEAD/MEMBER/CLIENT`.
  - **Đây là dependency mà Thành viên B cần** để enforce quyền trên Media Job/Batch/Glossary/QA — thống
    nhất interface này sớm với B (xem §4).

### 2.3 Credit & Thanh toán
- Copy `TokenLog`, `ModelPricing`/`credit_pricing_config` tương đương, entity liên quan Provider*.
- Entity mới theo `Database_Design.md` §4: `CreditAccount`, `CreditTransaction`, `WorkspaceBillingConfig`,
  `CreditPricingConfig`, `CreditPackage`, `CreditPackagePurchase`.
- Viết `CreditService` với 2 method lõi mà B sẽ gọi khi mỗi thao tác AI hoàn tất:
  - `chargeUsage(workspaceId, performedByUserId, capability, tokensUsed, hasPersonalApiKey)` — tự tính công
    thức Trường hợp 1/2 (`x×token` hoặc `x×token + y×token`), tự resolve `charged_user_id` theo
    `workspace_billing_configs.cost_mode`, ghi `credit_transactions` + `ai_usage_logs`
    (`ai_usage_logs` join dữ liệu do B cung cấp — xem §4), **serialize bằng `SELECT ... FOR UPDATE`** trên
    `credit_accounts` (Arch §12 invariant khoá ghi).
  - `hasSufficientBalance(userId)` — dùng ở bước tạo job (`BLOCK_UPFRONT` default, đọc Arch §10.4/§14); nếu
    không đủ, B ném `new AppException(ErrorCode.INSUFFICIENT_CREDIT)` (code 2300, xem CLAUDE.md §4.10).
- Endpoint mua gói Credit: chưa có cổng thanh toán thật (ghi rõ trong response/log), chỉ ghi nhận
  `payment_reference` do FE gửi.

### 2.4 Nguồn AI cá nhân (BYOK) + TTS voices
- Copy `ProviderConfigController`, `TtsProviderConfigController` và service liên quan.
- Entity mới/đổi tên theo `Database_Design.md` §5: `UserAiProvider`, `PlatformAiProvider`, `TtsVoice` (đối
  chiếu `capabilities <@ ARRAY['STT','TRANSLATE','TTS','VISION']`).
- API key mã hoá AES-GCM (giữ nguyên cơ chế gốc).
- Cung cấp cho B: `ProviderResolverService.resolveForCapability(userId, capability)` → trả provider cá nhân
  nếu có và active, ngược lại `platform_ai_providers` — B dùng kết quả này để gọi FastAPI và biết
  `used_personal_api_key` (field cần cho `ai_usage_logs`).

### 2.5 Preset
- Copy `WorkflowPresetController` → đổi thành `PresetController` theo route `API_Contract.md §9`.
- Entity `MediaPreset` theo `Database_Design.md` §9 (scope `SYSTEM/WORKSPACE/PROJECT`, đúng 1 default/scope
  — partial unique index).
- Viết `PresetResolverService.resolveForJobCreation(explicitPresetId, projectId, workspaceId)` — trả preset
  đã resolve theo thứ tự ưu tiên (SRS §5.7) để B snapshot vào `media_jobs.preset_snapshot` lúc tạo job.
  **Đây là 1 trong 2 hàm B cần từ A trước khi B code xong Media Job creation.**

### 2.6 Notification & Dashboard
- Copy `NotificationController`, `DashboardController`, `NotificationService`.
- `notifications` được tạo bởi B khi job/batch đổi trạng thái (`JOB_COMPLETED/JOB_FAILED/...`) — A chỉ cần
  cung cấp `NotificationService.notify(workspaceId, userId, type, refId, message)` cho B gọi, còn API
  đọc/đánh dấu-đã-đọc do A làm toàn bộ.
- Dashboard usage (`GET /workspaces/{workspaceId}/usage`) đọc `ai_usage_logs` — bảng do B ghi khi AI xử lý
  xong; A chỉ viết query/aggregation, không tạo dữ liệu.

## 3. Migration do A phụ trách (thứ tự tạo bảng — theo `Database_Design.md` §13)
1. `users` → `workspaces` → `workspace_members` → `projects` → `project_members`.
2. `terms_versions`, `credit_packages`, `platform_ai_providers` (độc lập — `terms_versions` để B dùng ở §4
   Media Asset, tạo giúp B luôn).
3. `credit_accounts`, `workspace_billing_configs`, `credit_pricing_config`.
4. `user_ai_providers` → `tts_voices`.
5. `media_presets`.
- Các bảng còn lại (`localization_batches`, `media_assets`, `media_jobs`, ...) do B tạo tiếp theo trong
  cùng migration chain — thống nhất thứ tự file migration (Flyway/Liquibase) với B trước khi bắt đầu.

## 4. Interface cần chốt với Thành viên B (chặn nhau nếu không thống nhất sớm)

| Interface A cung cấp | B dùng ở đâu |
|---|---|
| `WorkspaceAccessService.requireProjectAccess/WriteAccess`, `getRole` | Mọi endpoint Media Asset/Job/Batch/Glossary/QA (§4–§8 API_Contract) |
| `CreditService.chargeUsage(...)`, `hasSufficientBalance(...)` | Sau mỗi capability AI hoàn tất trong pipeline; trước khi tạo job |
| `ProviderResolverService.resolveForCapability(...)` | Trước khi B gọi FastAPI cho STT/TRANSLATE/TTS/SUMMARIZE/VISION |
| `PresetResolverService.resolveForJobCreation(...)` | Lúc B tạo `media_jobs` (snapshot preset) |
| `NotificationService.notify(...)` | Khi job/batch đổi trạng thái COMPLETED/FAILED/NEEDS_RERUN |
| `terms_versions` (bảng + `getCurrentVersion()`) | B dùng ở `GET .../media/terms-version` và validate consent |

**Khuyến nghị**: dựng 4 interface Java (không cần implementation đầy đủ ngay) trong tuần đầu, để B mock/gọi
thẳng mà không chờ A xong toàn bộ module.

## 5. Không làm (ngoài phạm vi — xem CLAUDE.md §3, §4.7)
- Không đụng vào `MediaController`, `MediaWorkflowController`, `BatchController` gốc (B phụ trách, và bản
  gốc các controller này gắn Document/CT-legacy nặng, không copy nguyên).
- Không tạo `DocumentController`, `TranslateController`, `TmController`, `PlatformController`,
  `ClipFactoryController`, `AnimatedExplainerController`, `ProductionJobController` hay entity liên quan —
  loại bỏ hoàn toàn theo SRS §4.3.
- Không tái tạo role cấp Project hoặc 5 giá trị role cũ (`ADMIN/PM/TRANSLATOR/PROOFREADER/CLIENT`).

## 6. Checklist hoàn thành
- [ ] Auth register/login/refresh/me + Google OAuth2, kèm auto-init Workspace/Project/Credit 1 transaction.
- [x] RBAC 3 role, đúng 1 Lead/workspace, `project_members` không có cột role.
- [ ] Credit: cấp ban đầu, mua gói (chưa cổng thanh toán thật), 2 cost_mode, công thức x/x+y đúng theo
      người *thực hiện*, `SELECT ... FOR UPDATE` khi trừ Credit.
- [ ] BYOK CRUD + test connection; platform provider fallback; TTS voices cache theo provider.
- [ ] Preset 3 cấp, đúng 1 default/scope, resolver theo thứ tự ưu tiên, SYSTEM template public catalog.
- [ ] Notification list/read; Dashboard usage aggregation.
- [ ] Mọi controller trả `ApiResponse<T>`, mọi lỗi nghiệp vụ ném qua `AppException(ErrorCode.XXX)` với code
      trong đúng dải của module (CLAUDE.md §4.10), không tự tạo response/exception riêng.
- [ ] 4 interface ở §4 đã có signature ổn định, đã thông báo cho B.
