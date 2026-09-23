# Kế Hoạch Kết Nối API Phần Admin — TransFlow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kết nối API hoàn chỉnh cho 2 tầng Admin: Workspace Admin (LEAD) và Platform Super Admin (isPlatformAdmin).

**Architecture:** Giữ `docs/API_Contract.md` làm nguồn sự thật duy nhất. Backend là security boundary (check programmatic ở service + `PlatformController.assertPlatformAdmin`). Frontend chỉ guard UI (`permissions.ts`, `RoleGuard`/`PlatformGuard`) + gọi qua `apiRequest` (tự unwrap `{code:1000,data}`, tự refresh 401) + TanStack Query cache.

**Tech Stack:** Spring Boot 3.3.5 (ApiResponse envelope, JWT, JPA), React + TanStack Query (`lib/api/client.ts`, `lib/queryClient.ts`), Vite proxy `/api`, `VITE_API_BASE_URL`.

**Spec:** `docs/API_Contract.md` §1, §2, §9, §10, §11, §13.1 + `docs/API_CONNECTION_ISSUES_AND_CHECKLIST.md` §2 + `docs/Database_Design.md` §4, §5 + file thực tế `backend-main/src/.../platform/controller/PlatformController.java`, `frontend/src/api/*.ts`.

## Global Constraints

- Mọi response backend bọc trong `ApiResponse<T>{code:int,message,data}` (`code=1000` khi thành công, field null bị lược bỏ).
- Mọi `/api/...` cần `Authorization: Bearer <accessToken>`, trừ `/api/auth/register/**|login|refresh|forgot-password/**|google/*` và `/api/transformation/capabilities`.
- Phân trang: `page` 0-based mặc định 0, `size` mặc định 20 tối đa 100.
- Không tạo endpoint mới ngoài plan nếu chưa được duyệt; mọi `ErrorCode` mới phải nằm đúng dải module (§15.2 API_Contract).
- Frontend không gọi `fetch` trực tiếp ở screen — đi qua `api/*.ts` + React Query hooks.
- Không seed tài khoản/mật khẩu Super Admin mặc định; cấp `users.is_platform_admin=true` bằng quy trình vận hành.
- Mỗi task kết thúc bằng verify (test/build) rồi mới commit.

---

## PHẦN 0 — HIỆN TRẠNG CHI TIẾT (ĐÃ ĐỌC KỸ CODE NGÀY 22/09/2026)

### 0.1. Định nghĩa 2 loại "admin" (rất nhiều người nhầm)

| Khái niệm | Nguồn sự thật | Giá trị | Dùng ở đâu |
|---|---|---|---|
| Workspace role | `backend-main/.../workspace/entity/Role.java` | Chỉ `LEAD, MEMBER, CLIENT` — **không có ADMIN** | `WorkspaceController`, `ProjectController`, `PresetController` (check qua `WorkspaceAccessService.requireRole/requireWorkspaceLead/requireProjectWriteAccess`) |
| Platform Admin | `backend-main/.../auth/entity/User.java:isPlatformAdmin:boolean` | `true/false`, độc lập với workspace role | `platform/controller/PlatformController.java:assertPlatformAdmin()` — sai thì `401 UNAUTHENTICATED` hoặc `403 UNAUTHORIZED` |
| Frontend Role | `frontend/src/lib/permissions.ts:Role` | `ADMIN, PM, TRANSLATOR, PROOFREADER, CLIENT, LEAD, MEMBER` (thừa 4 role di sản) | `MATRIX`, `RoleGuard.tsx`, `store/authStore.ts:role` |

### 0.2. Backend hiện tại như thế nào (22 controllers, ~85 endpoints)

Cơ chế chung: `SecurityConfig.java` cho `permitAll()` các path public (`/api/auth/register/**`, `/login`, `/refresh`, `/forgot-password/**`, `/google/**`, `/transformation/capabilities`, `/actuator/health/**`, docs). `/internal/media/**` permitAll ở filter nhưng verify HMAC-SHA256 thủ công (`X-Signature`, `X-Timestamp`). Còn lại `anyRequest().authenticated()`. Không có `@PreAuthorize` nào trong codebase.

Nhóm Workspace Admin (đã đủ, đã đúng contract):

- `auth/controller/AuthController.java` (`/api/auth`): `POST /register (201)`, `POST /register/otp`, `POST /login`, `POST /refresh`, `GET /me → UserResponse{id,email,fullName,googleLinked,isPlatformAdmin}`, `POST /forgot-password/otp|verify|reset`.
- `auth/controller/GoogleAuthController.java` (`/api/auth/google`): `GET /start`, `GET /callback`, `POST /exchange`.
- `workspace/controller/WorkspaceController.java` (`/api/workspaces`): `POST / (201, creator thành LEAD)`, `GET /`, `GET /{workspaceId}`, `GET /{id}/members`, `POST /{id}/members (201, LEAD, body {email,role:MEMBER|CLIENT}, không tạo thêm LEAD)`, `PUT /{id}/members/{memberId} (LEAD)`, `DELETE /{id}/members/{memberId} (LEAD)`, `GET /{id}/billing-config`, `PUT /{id}/billing-config (LEAD, {costMode:LEAD_PAYS_ALL|PAY_PER_USER})`.
- `project/controller/ProjectController.java` (`/api/workspaces/{ws}/projects`): `GET /`, `POST / (201, LEAD)`, `GET /{pid}/members`, `POST /{pid}/members (LEAD, {userId})`, `DELETE /{pid}/members/{userId} (LEAD)`.
- `preset/controller/PresetController.java` (`/api/workspaces/{ws}/presets`): `GET /?scope=&projectId=`, `GET /{presetId}`, `POST / (201)`, `PUT /{presetId}`, `DELETE /{presetId}?replacementPresetId= (204)`. `scope=SYSTEM` không tạo được qua API workspace (sai thì `403 SYSTEM_PRESET_READ_ONLY`).
- `preset/controller/PresetTemplateController.java`: `GET /api/media/presets/templates` (read-only SYSTEM, JWT, không cần workspace).
- `dashboard/controller/DashboardController.java`: `GET /api/workspaces/{ws}/dashboard`, `GET /api/workspaces/{ws}/usage?groupBy=project|user|operation&from=&to=` (+ alias `/dashboard/usage`).
- `credit/controller/CreditController.java`: `GET /api/users/me/credit → {balance}`, `GET /api/users/me/credit/transactions?type=&from=&to=&page=&size=`, `GET /api/credit/packages (list active)`, `POST /api/credit/packages/{packageId}/purchase {paymentReference}` (mock, chưa cổng thanh toán thật).
- `provider/controller/UserAiProviderController.java` (`/api/users/me/providers`, user-scoped BYOK): `GET /`, `POST / (201)`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/test`, `GET /{id}/voices?language=`, `POST /{id}/voices/refresh`.
- `provider/controller/TtsVoiceController.java`: `GET /api/tts-voices?language=&providerSource=PLATFORM`, `POST /api/tts-voices/preview {voiceId,text≤50ký tự} → {audioUrl,expiresInSeconds}` (không trừ credit, rate-limit user).
- Các controller nghiệp vụ khác (đã nối xong Phase 2-6, không thuộc scope admin nhưng admin cần thấy): `MediaAssetController`, `MediaJobController` (16 endpoints), `MediaPackageController`, `SubtitleStyleController`, `BatchController`, `SummarizationController`, `QaController`, `GlossaryController`, `NotificationController`, `TransformationController (GET /capabilities public)`, `MediaCallbackController (/internal/media HMAC)`.

Nhóm Platform Super Admin (`platform/controller/PlatformController.java`, base `/api/platform`, tất cả cần `isPlatformAdmin=true`):

| Method + Path | Response thực tế ngày 22/09/2026 | Đánh giá |
|---|---|---|
| `GET /overview?from=&to=&topLimit=10` | `users{total,newInRange=min(total,5)}`, `workspaces{total,newInRange=min(total,3)}`, `jobs{textJobs,batchJobs,mediaJobs,productionJobs}` toàn `{created:0,...}`, `tokens{input:0,output:0,total:0,byOperation:{}}`, `failRate{rate:0.0,...}`, `topWorkspaces[]` map từ `findAll()` limit topLimit với `totalTokens:0,jobCount:0` | Chạy được nhưng **mock 80%**, chỉ `totalUsers/totalWorkspaces` là thật |
| `GET /status` | `checkedAt, overall:UP, services[db,redis,rabbitmq,minio,ai_worker]` — chỉ DB check connection thật, 4 cái còn lại hardcode `UP` + latency giả (2,3,7,15ms) | Chạy được nhưng **không trung thực hạ tầng** |
| `GET /users?q=&page=&size=&isPlatformAdmin=` | `items[{id,email,fullName,status,isPlatformAdmin,createdAt,workspaceCount}], page,size,totalItems,totalPages` — paging thật qua `findAll(PageRequest sort createdAt DESC)` | Chạy được nhưng **bỏ qua `q` và `isPlatformAdmin`** (lọc không có tác dụng) |
| `GET /workspaces?q=&page=&size=` | `items[{id,name,slug,ownerUserId,ownerEmail,memberCount,createdAt}]` + paging | Chạy được nhưng **bỏ qua `q`** |
| `GET /audit-logs?action=&page=&size=` | Luôn `items:[], totalItems:0, totalPages:0` | **Stub rỗng** |

Không tồn tại: `POST/PUT/DELETE /api/admin/*`, `GET /api/users` quản trị (chỉ có `/users/me/*`), API admin tạo gói credit / cộng trừ balance, API admin CRUD system preset, API admin CRUD platform provider. Contract §13.1 chốt **read-only MVP** nên đây là thiết kế có chủ ý, không phải bug.

### 0.3. Frontend hiện tại bị như thế nào

Router: `src/app/router.tsx` chỉ có `/`, `/login|register|forgot-password`, `/auth/google/done`, `/no-workspace`, `/w/:workspaceId/* → MobileWorkspaceAdapter`, `/dashboard redirect`. **Không có `/platform` hay `/admin`**. Toàn bộ "admin" hiện tại là workspace-scoped trong `mobile/routes/MobileWorkspaceAdapter.tsx`: `index (DashboardPage)`, `dashboard/usage (RoleGuard dashboard.usage)`, `settings/members (usePermission workspace.manage_members)`, `media/presets (PresetSettingsPage, SYSTEM read-only)`, `account/:section (CreditSection...)`, `projects, batches, glossaries, media, notifications`.

API client: `src/config/featureFlags.ts:apiBaseUrl=(VITE_API_BASE_URL??'/api')` (`.env.example: http://localhost:8080/api`). `src/lib/api/client.ts:apiRequest<T>` dùng `fetch`, tự gắn `Bearer`, tự unwrap `{code:1000,data}`, `204→undefined`, 401 thì `POST {apiBaseUrl}/auth/refresh {refreshToken}` retry 1 lần rồi `clearAuthAndRedirect('/login')`. `buildWorkspacePath(ws,suffix)→/workspaces/{ws}{suffix}`. Không dùng axios. Mock chỉ ở `frontend/mock/*.cjs` khi `VITE_USE_MOCK=true`, trong `src` không có mock cứng.

Đối chiếu từng file admin:

- `src/api/members.ts` (4 hàm `GET/POST /members`, `PUT/DELETE /members/{id}`) + `hooks/useMembers.ts` + `pages/settings/MembersPage.tsx` → khớp 100% backend.
- `src/api/workspaces.ts` (`GET /workspaces`, `GET /workspaces/{id}`, `POST /workspaces {name,slug?}`, `GET/PUT /billing-config {costMode}`) + `normalizeWorkspace (myRole??role??MEMBER)` → khớp 100% (đã fix drift `CostMode`).
- `src/api/projects.ts` (`GET/POST /projects`, `GET/POST/DELETE /projects/{pid}/members`) → khớp 100%.
- `src/api/workflowPresets.ts` (`GET /presets?scope=&projectId=`, `POST/PUT/DELETE`) + hook gọi 3 scope `Promise.all` → khớp 100%.
- `src/api/dashboard.ts` (`GET /dashboard/usage`, `GET /dashboard`, normalize `items[]→byOperation[]`, `cost="Coming soon"`) → khớp 100%.
- `src/api/credit.ts` (4 hàm user credit/packages/purchase) → khớp 100%.
- `src/api/providers.ts` → **LỆCH NẶNG**: 14 hàm, trong đó 9 hàm có fallback `catch(()=>buildWorkspacePath(...))` sang endpoint workspace không tồn tại (`/providers/presets`, `/providers`, `/providers/{id}`, `/providers/{id}/default`, `/providers/{id}/test`, `/providers/{id}/validate`, `/providers/{id}/voice-languages`, `/providers/{id}/voices`, `/refresh-voices`, `/voices/preview`). `ProvidersPage.tsx` hiện không mount route nên lỗi bị che. `hooks/useProviders.ts` vẫn truyền `workspaceId` vào mọi query.
- `src/types/auth.ts:User` **thiếu `isPlatformAdmin, googleLinked`** (backend `UserResponse.java` đã có) → Guard platform không đọc được cờ.
- `src/lib/permissions.ts` thừa role + `MATRIX` dùng `ADMIN` (backend không bao giờ trả) → `ADMIN` là dead-role, dễ nhầm với platform admin.
- `src/lib/queryClient.ts:87-95` đã đặt sẵn `platformOverview/Status/Users/Workspaces/Audit` nhưng không có `api/platform.ts`, hooks, pages nào dùng. Chỉ có 2 helper `components/platform/SortableTh.tsx, PlatformPagination.tsx`.
- `src/store/authStore.ts` (`tf-auth` persist, `role` derive từ `myRole`, `getLastWorkspaceId`, `clearAuthAndRedirect`) → đúng, chỉ thiếu selector `isPlatformAdmin`.

Kết luận gap:

1. Workspace Admin: đủ API, đã nối xong (không cần thêm backend).
2. Providers: backend đúng (user-scoped), frontend sai (workspace fallback) — phải sửa frontend.
3. RBAC: backend đúng (3 roles + flag), frontend sai (7 roles) — phải chuẩn hóa frontend.
4. Platform Super Admin: backend 70% (chạy được nhưng mock/lọc thiếu), frontend 0% — phải làm mới frontend + hardening backend.
5. Credit admin mutations: không có cả 2 đầu — giữ nguyên read-only theo contract, không làm trong đợt này.

### 0.4. Phương án đã chốt (tự chọn tốt nhất, không hỏi lại)

- **P1 Providers:** Chọn A — xóa fallback workspace ở FE, giữ nguyên BE user-scoped theo contract §11. Lý do: rẻ nhất, đúng contract, không đẻ thêm surface bảo mật. Bác bỏ B (đẻ backend `/workspaces/providers`) vì tốn migration + RBAC mới mà không có yêu cầu nghiệp vụ shared-provider.
- **P2 RBAC:** Chuẩn hóa FE về `LEAD/MEMBER/CLIENT` + `isPlatformAdmin`, giữ `ADMIN` như alias deprecated của `LEAD` để không vỡ UI cũ. Thêm `platform.view` check cờ thay vì role.
- **P3 Platform route:** `/platform/*` top-level + `PlatformGuard`, tách khỏi `/w/:workspaceId/*`. Lý do: platform không có workspace scope (đúng `queryKeys` comment "no workspace scope"), tránh nhầm `myRole` với `isPlatformAdmin`.
- **P4 Backend platform:** Chỉ hardening (filter `q`, check health thật, count thật), không thêm mutations. `audit-logs` giữ stub nhưng trả message rõ ràng để FE gắn badge `Coming soon`.
- **P5 Credit admin:** Hoãn (giữ read-only MVP). UI purchase giữ ghi chú "thanh toán thủ công/mock".

---

## PHẦN 1 — CẤU TRÚC FILE SẼ CHẠM

```
backend-main/src/main/java/com/app/modules/platform/controller/
  PlatformController.java (sửa: filter q, health thật, count thật)

backend-main/src/main/java/com/app/modules/auth/repository/
  UserRepository.java (thêm query tìm kiếm)
backend-main/src/main/java/com/app/modules/workspace/repository/
  WorkspaceRepository.java (thêm query tìm kiếm)
backend-main/src/test/.../platform/
  PlatformControllerTest.java (mở rộng)

frontend/src/api/
  platform.ts (MỚI)
  providers.ts (sửa: xóa fallback)
frontend/src/hooks/
  usePlatform.ts (MỚI)
  useProviders.ts (sửa: bỏ workspaceId)
frontend/src/types/
  platform.ts (MỚI)
  auth.ts (sửa: thêm isPlatformAdmin, googleLinked)
  provider.ts (sửa: xóa ProviderPreset/PresetCategory nếu không dùng)
frontend/src/lib/
  permissions.ts (sửa: MATRIX + platform.view)
  queryClient.ts (giữ keys, không đổi)
frontend/src/components/platform/
  PlatformGuard.tsx (MỚI)
  SortableTh.tsx (giữ), PlatformPagination.tsx (giữ)
frontend/src/pages/platform/
  PlatformLayout.tsx, OverviewPage.tsx, StatusPage.tsx,
  UsersPage.tsx, WorkspacesPage.tsx, AuditPage.tsx (MỚI)
frontend/src/app/
  router.tsx (thêm /platform/*)
frontend/src/components/layout/
  SidebarNav.tsx (thêm link platform có điều kiện)
frontend/src/store/
  authStore.ts (thêm selector isPlatformAdmin)
```

---

## PHẦN 2 — TASKS CHI TIẾT (AI THỰC THI LẦN LƯỢT)

### Task 1: Chuẩn hóa RBAC + User type (nền móng cho mọi guard admin)

**Files:**
- Modify: `frontend/src/lib/permissions.ts:1-75`
- Modify: `frontend/src/types/auth.ts:1-27`
- Modify: `frontend/src/store/authStore.ts:1-107`
- Test: `frontend/src/lib/permissions.test.ts` (mới hoặc mở rộng)

**Interfaces:**
- Consumes: `Workspace.myRole` từ `GET /workspaces` (backend chỉ trả `LEAD|MEMBER|CLIENT`).
- Produces: `can(role,action)`, `isRole(v)`, `User{isPlatformAdmin}`, `useAuthStore(s=>s.user?.isPlatformAdmin)`, `PermissionAction += 'platform.view'`.

- [ ] **Step 1: Viết failing test RBAC**

```ts
// frontend/src/lib/permissions.test.ts
import { describe, expect, it } from 'vitest'
import { can } from '@/lib/permissions'

describe('admin RBAC', () => {
  it('LEAD được manage_members, MEMBER/CLIENT không', () => {
    expect(can('LEAD', 'workspace.manage_members')).toBe(true)
    expect(can('MEMBER', 'workspace.manage_members')).toBe(false)
    expect(can('CLIENT', 'workspace.manage_members')).toBe(false)
  })
  it('ADMIN alias LEAD để tương thích UI cũ', () => {
    expect(can('ADMIN', 'workspace.manage_members')).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test để xác nhận fail (ADMIN chưa alias hoặc platform.view thiếu)**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: FAIL (nếu MATRIX cũ pass ADMIN thì vẫn FAIL ở `platform.view` chưa tồn tại — đủ để sang Step 3).

- [ ] **Step 3: Sửa `permissions.ts` tối thiểu**

```ts
export type PermissionAction =
  | 'workspace.manage_members'
  | 'workspace.manage_providers'
  | 'project.create'
  | 'project.manage'
  | 'document.upload'
  | 'batch.create'
  | 'batch.retry'
  | 'batch.download'
  | 'job.start'
  | 'segment.edit'
  | 'segment.approve'
  | 'qa.apply'
  | 'qa.resolve'
  | 'qa.override'
  | 'glossary.crud'
  | 'tm.crud'
  | 'dashboard.usage'
  | 'workspace.view'
  | 'platform.view'

const MATRIX: Record<PermissionAction, Role[]> = {
  'workspace.view': ['ADMIN', 'PM', 'TRANSLATOR', 'PROOFREADER', 'CLIENT', 'LEAD', 'MEMBER'],
  'workspace.manage_members': ['ADMIN', 'LEAD'],
  'workspace.manage_providers': ['ADMIN', 'LEAD'],
  'project.create': ['ADMIN', 'PM', 'LEAD'],
  'project.manage': ['ADMIN', 'PM', 'LEAD'],
  'document.upload': ['ADMIN', 'PM', 'TRANSLATOR', 'LEAD', 'MEMBER'],
  'batch.create': ['ADMIN', 'PM', 'TRANSLATOR', 'LEAD', 'MEMBER'],
  'batch.retry': ['ADMIN', 'PM', 'TRANSLATOR', 'LEAD', 'MEMBER'],
  'batch.download': ['ADMIN', 'PM', 'TRANSLATOR', 'LEAD', 'MEMBER'],
  'job.start': ['ADMIN', 'PM', 'TRANSLATOR', 'LEAD', 'MEMBER'],
  'segment.edit': ['ADMIN', 'PM', 'TRANSLATOR', 'PROOFREADER', 'LEAD', 'MEMBER'],
  'segment.approve': ['ADMIN', 'PM', 'PROOFREADER', 'LEAD', 'MEMBER'],
  'qa.apply': ['ADMIN', 'PM', 'PROOFREADER', 'LEAD', 'MEMBER'],
  'qa.resolve': ['ADMIN', 'PM', 'PROOFREADER', 'LEAD', 'MEMBER'],
  'qa.override': ['ADMIN', 'PM', 'LEAD'],
  'glossary.crud': ['ADMIN', 'PM', 'LEAD'],
  'tm.crud': ['ADMIN', 'PM', 'LEAD'],
  'dashboard.usage': ['ADMIN', 'PM', 'LEAD'],
  'platform.view': ['ADMIN', 'LEAD'],
}
// Ghi chú: can('platform.view') chỉ dùng để ẩn/hiện link. Bảo mật thật
// vẫn là backend assertPlatformAdmin + PlatformGuard check isPlatformAdmin bên dưới.
```

Giữ nguyên `Role`, `can()`, `isRole()` signature để không vỡ 20+ file đang import.

- [ ] **Step 4: Sửa `types/auth.ts` thêm cờ platform**

```ts
export type User = {
  id: string
  email: string
  fullName: string
  googleLinked?: boolean
  isPlatformAdmin?: boolean
}
```

- [ ] **Step 5: Chạy test + typecheck**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: PASS
Run: `npx tsc --noEmit`
Expected: PASS (không lỗi type ở `authStore`, `RoleGuard`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/permissions.ts frontend/src/lib/permissions.test.ts frontend/src/types/auth.ts
git commit -m "fix(admin): chuan hoa RBAC LEAD/MEMBER/CLIENT + User.isPlatformAdmin"
```

### Task 2: Dọn providers FE về đúng contract user-scoped (fix lệch nặng nhất)

**Files:**
- Modify: `frontend/src/api/providers.ts:1-176`
- Modify: `frontend/src/hooks/useProviders.ts:1-223`
- Modify: `frontend/src/types/provider.ts` (xóa `ProviderPreset`, `ProviderPresetCategory`, `ProviderDefaultRequest`, `ProviderTestResult` nếu không còn dùng)
- Modify: `frontend/mock/index.cjs` (xóa mock `/workspaces/:id/providers/*`)
- Test: `frontend/src/api/providers.test.ts`

**Interfaces:**
- Consumes: `apiRequest<T>` (unwrap `ApiResponse`), backend `UserAiProviderController` + `TtsVoiceController`.
- Produces (mới, không `workspaceId`):
  - `listProvidersApi(): Promise<ProviderConfig[]>`
  - `createProviderApi(body: CreateProviderRequest): Promise<ProviderConfig>`
  - `updateProviderApi(providerId: string, body: UpdateProviderRequest): Promise<ProviderConfig>`
  - `deleteProviderApi(providerId: string): Promise<void>`
  - `testProviderApi(providerId: string, capability?: ProviderCapability): Promise<TestConnectionResponse>`
  - `listTtsVoicesApi(providerId: string): Promise<TtsVoice[]>`
  - `refreshTtsVoicesApi(providerId: string): Promise<TtsVoice[]>`
  - `listPlatformTtsVoicesApi(params?: {language?: string; providerSource?: string}): Promise<TtsVoice[]>`
  - `previewTtsVoiceApi(body: {voiceId: string; text: string}): Promise<VoicePreviewResponse>`

- [ ] **Step 1: Viết failing test cho API đúng**

```ts
// frontend/src/api/providers.test.ts
import { describe, expect, it, vi } from 'vitest'
import { listProvidersApi, createProviderApi } from '@/api/providers'
import * as client from '@/lib/api/client'

describe('providers user-scoped', () => {
  it('list gọi /users/me/providers, không fallback workspace', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue([])
    await listProvidersApi()
    expect(spy).toHaveBeenCalledWith('/users/me/providers')
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('create gọi POST /users/me/providers', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({ id: 'p1' })
    await createProviderApi({ displayName: 'OpenAI', protocol: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', defaultModel: 'gpt-4o-mini', capabilities: ['TEXT'], enabled: true, defaultForCapabilities: ['TEXT'] })
    expect(spy).toHaveBeenCalledWith('/users/me/providers', expect.objectContaining({ method: 'POST' }))
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Chạy test để fail (code cũ có 2 tham số + fallback)**

Run: `npx vitest run src/api/providers.test.ts`
Expected: FAIL (`listProvidersApi` cũ cần `workspaceId` hoặc gọi 2 lần do `.catch`).

- [ ] **Step 3: Viết lại `api/providers.ts` tối thiểu đúng contract**

```ts
import { apiRequest } from '@/lib/api/client'
import type {
  CreateProviderRequest,
  ProviderCapability,
  ProviderConfig,
  TestConnectionResponse,
  TtsVoice,
  UpdateProviderRequest,
  VoicePreviewResponse,
} from '@/types/provider'

export function listProvidersApi() {
  return apiRequest<ProviderConfig[]>('/users/me/providers')
}

export function createProviderApi(body: CreateProviderRequest) {
  return apiRequest<ProviderConfig>('/users/me/providers', { method: 'POST', body })
}

export function updateProviderApi(providerId: string, body: UpdateProviderRequest) {
  return apiRequest<ProviderConfig>(`/users/me/providers/${providerId}`, { method: 'PUT', body })
}

export function deleteProviderApi(providerId: string) {
  return apiRequest<void>(`/users/me/providers/${providerId}`, { method: 'DELETE' })
}

export function testProviderApi(providerId: string, capability?: ProviderCapability) {
  const query = capability ? `?capability=${encodeURIComponent(capability)}` : ''
  return apiRequest<TestConnectionResponse>(`/users/me/providers/${providerId}/test${query}`, { method: 'POST' })
}

export function listTtsVoicesApi(providerId: string) {
  return apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices`)
}

export function refreshTtsVoicesApi(providerId: string) {
  return apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices/refresh`, { method: 'POST' })
}

export function listPlatformTtsVoicesApi(params: { language?: string; providerSource?: string } = {}) {
  const search = new URLSearchParams()
  if (params.language) search.set('language', params.language)
  if (params.providerSource) search.set('providerSource', params.providerSource)
  const qs = search.toString()
  return apiRequest<TtsVoice[]>(`/tts-voices${qs ? `?${qs}` : ''}`)
}

export function previewTtsVoiceApi(body: { voiceId: string; text: string }) {
  return apiRequest<VoicePreviewResponse>('/tts-voices/preview', { method: 'POST', body })
}
```

Xóa hẳn: `listPresetsApi`, `setDefaultProviderApi`, `unsetDefaultProviderApi`, `validateProviderApi`, `listTtsVoiceLanguagesApi`, `upsertTtsVoiceApi`. Nếu UI nào import chúng thì để Task 2 Step 4 xử lý.

- [ ] **Step 4: Sửa `hooks/useProviders.ts` bỏ workspaceId**

```ts
export function useProviders() {
  return useQuery({
    queryKey: queryKeys.providers('me'),
    queryFn: () => listProvidersApi(),
    staleTime: STALE.static,
  })
}

export function useTtsVoices(providerId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ttsVoices('me', providerId ?? ''),
    queryFn: () => listTtsVoicesApi(providerId!),
    enabled: !!providerId,
  })
}
```

Các mutation `useCreateProvider`, `useUpdateProvider`, `useDeleteProvider`, `useTestProvider`, `useRefreshVoices` đổi sang signature mới (không `workspaceId`), invalidate `queryKeys.providers('me')`. Xóa hooks preset/default/validate/voice-languages/upsert (không có backend).

- [ ] **Step 5: Chạy test + build**

Run: `npx vitest run src/api/providers.test.ts`
Expected: PASS
Run: `npx tsc --noEmit`
Expected: PASS (nếu `ProvidersPage.tsx`/`ProviderTestPanel.tsx` báo thiếu hàm đã xóa thì sửa import tại chỗ: xóa block gọi preset/default/validate, giữ list/create/update/delete/test/voices/refresh/preview).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/providers.ts frontend/src/api/providers.test.ts frontend/src/hooks/useProviders.ts frontend/src/types/provider.ts
git commit -m "fix(admin): providers ve user-scoped, xoa workspace fallback 404"
```

### Task 3: Tạo API + types + hooks Platform (nối 5 endpoint backend có sẵn)

**Files:**
- Create: `frontend/src/types/platform.ts`
- Create: `frontend/src/api/platform.ts`
- Create: `frontend/src/hooks/usePlatform.ts`
- Test: `frontend/src/api/platform.test.ts`

**Interfaces:**
- Consumes: `apiRequest<T>`, `queryKeys.platformOverview/Status/Users/Workspaces/Audit`.
- Produces:
  - `getPlatformOverviewApi(p?: {from?: string; to?: string; topLimit?: number}): Promise<PlatformOverview>`
  - `getPlatformStatusApi(): Promise<PlatformStatus>`
  - `getPlatformUsersApi(p?: {q?: string; page?: number; size?: number; isPlatformAdmin?: boolean}): Promise<PlatformPage<PlatformUser>>`
  - `getPlatformWorkspacesApi(p?: {q?: string; page?: number; size?: number}): Promise<PlatformPage<PlatformWorkspace>>`
  - `getPlatformAuditLogsApi(p?: {action?: string; page?: number; size?: number}): Promise<PlatformPage<AuditLog>>`
  - Hooks: `usePlatformOverview`, `usePlatformStatus`, `usePlatformUsers`, `usePlatformWorkspaces`, `usePlatformAuditLogs`.

- [ ] **Step 1: Tạo `types/platform.ts` khớp backend**

```ts
export type PlatformOverview = {
  from: string
  to: string
  users: { total: number; newInRange: number }
  workspaces: { total: number; newInRange: number }
  jobs: Record<string, { created: number; completed: number; failed: number; processing: number; other: number }>
  tokens: { inputTokens: number; outputTokens: number; totalTokens: number; byOperation: Record<string, number> }
  failRate: { rate: number; failedCount: number; terminalCount: number }
  topWorkspaces: Array<{ workspaceId: string; workspaceName: string; totalTokens: number; jobCount: number }>
}

export type PlatformServiceStatus = {
  id: string
  name: string
  status: 'UP' | 'DOWN'
  latencyMs: number
  message: string
}

export type PlatformStatus = {
  checkedAt: string
  overall: string
  services: PlatformServiceStatus[]
}

export type PlatformUser = {
  id: string
  email: string
  fullName: string
  status: string
  isPlatformAdmin: boolean
  createdAt: string
  workspaceCount: number
}

export type PlatformWorkspace = {
  id: string
  name: string
  slug: string
  ownerUserId: string
  ownerEmail: string
  memberCount: number
  createdAt: string
}

export type AuditLog = {
  id?: string
  action?: string
  createdAt?: string
  [k: string]: unknown
}

export type PlatformPage<T> = {
  items: T[]
  page: number
  size: number
  totalItems: number
  totalPages: number
}
```

- [ ] **Step 2: Tạo `api/platform.ts`**

```ts
import { apiRequest } from '@/lib/api/client'
import type { AuditLog, PlatformOverview, PlatformPage, PlatformStatus, PlatformUser, PlatformWorkspace } from '@/types/platform'

function qs(params: Record<string, string | number | boolean | undefined>) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') s.set(k, String(v))
  }
  const str = s.toString()
  return str ? `?${str}` : ''
}

export function getPlatformOverviewApi(params: { from?: string; to?: string; topLimit?: number } = {}) {
  return apiRequest<PlatformOverview>(`/platform/overview${qs(params)}`)
}

export function getPlatformStatusApi() {
  return apiRequest<PlatformStatus>('/platform/status')
}

export function getPlatformUsersApi(params: { q?: string; page?: number; size?: number; isPlatformAdmin?: boolean } = {}) {
  return apiRequest<PlatformPage<PlatformUser>>(`/platform/users${qs(params)}`)
}

export function getPlatformWorkspacesApi(params: { q?: string; page?: number; size?: number } = {}) {
  return apiRequest<PlatformPage<PlatformWorkspace>>(`/platform/workspaces${qs(params)}`)
}

export function getPlatformAuditLogsApi(params: { action?: string; page?: number; size?: number } = {}) {
  return apiRequest<PlatformPage<AuditLog>>(`/platform/audit-logs${qs(params)}`)
}
```

- [ ] **Step 3: Tạo `hooks/usePlatform.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { getPlatformAuditLogsApi, getPlatformOverviewApi, getPlatformStatusApi, getPlatformUsersApi, getPlatformWorkspacesApi } from '@/api/platform'
import { STALE, queryKeys } from '@/lib/queryClient'

export function usePlatformOverview(params: { from?: string; to?: string; topLimit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.platformOverview(params),
    queryFn: () => getPlatformOverviewApi(params),
    staleTime: STALE.realtime,
  })
}

export function usePlatformStatus() {
  return useQuery({ queryKey: queryKeys.platformStatus, queryFn: getPlatformStatusApi, staleTime: STALE.realtime })
}

export function usePlatformUsers(params: { q?: string; page?: number; size?: number; isPlatformAdmin?: boolean } = {}) {
  return useQuery({ queryKey: queryKeys.platformUsers(params), queryFn: () => getPlatformUsersApi(params), staleTime: STALE.realtime })
}

export function usePlatformWorkspaces(params: { q?: string; page?: number; size?: number } = {}) {
  return useQuery({ queryKey: queryKeys.platformWorkspaces(params), queryFn: () => getPlatformWorkspacesApi(params), staleTime: STALE.realtime })
}

export function usePlatformAuditLogs(params: { action?: string; page?: number; size?: number } = {}) {
  return useQuery({ queryKey: queryKeys.platformAudit(params), queryFn: () => getPlatformAuditLogsApi(params), staleTime: STALE.realtime })
}
```

- [ ] **Step 4: Viết test API**

```ts
// frontend/src/api/platform.test.ts
import { describe, expect, it, vi } from 'vitest'
import { getPlatformUsersApi } from '@/api/platform'
import * as client from '@/lib/api/client'

describe('platform api', () => {
  it('users build đúng query', async () => {
    const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({ items: [] })
    await getPlatformUsersApi({ q: 'a@b.c', page: 0, size: 20 })
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('/platform/users'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('q=a%40b.c'))
    spy.mockRestore()
  })
})
```

- [ ] **Step 5: Chạy test**

Run: `npx vitest run src/api/platform.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/platform.ts frontend/src/api/platform.ts frontend/src/api/platform.test.ts frontend/src/hooks/usePlatform.ts
git commit -m "feat(admin): them platform api layer (overview/status/users/workspaces/audit)"
```

### Task 4: Dựng UI Platform (Guard + Layout + 5 trang)

**Files:**
- Create: `frontend/src/components/platform/PlatformGuard.tsx`
- Create: `frontend/src/pages/platform/PlatformLayout.tsx`
- Create: `frontend/src/pages/platform/OverviewPage.tsx`
- Create: `frontend/src/pages/platform/StatusPage.tsx`
- Create: `frontend/src/pages/platform/UsersPage.tsx`
- Create: `frontend/src/pages/platform/WorkspacesPage.tsx`
- Create: `frontend/src/pages/platform/AuditPage.tsx`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/components/layout/SidebarNav.tsx`
- Test: `frontend/src/components/platform/PlatformGuard.test.tsx`

**Interfaces:**
- Consumes: `useAuthStore(s=>s.user)`, `usePlatform*` hooks, `PlatformPagination`, `SortableTh`.
- Produces: routes `/platform`, `/platform/status`, `/platform/users`, `/platform/workspaces`, `/platform/audit`.

- [ ] **Step 1: Tạo `PlatformGuard.tsx`**

```tsx
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'

export function PlatformGuard({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  if (!token) return <Navigate to="/login" replace />
  if (user?.isPlatformAdmin !== true) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
```

- [ ] **Step 2: Tạo `PlatformLayout.tsx` (nav nội bộ + outlet)**

```tsx
import { NavLink, Outlet } from 'react-router-dom'

const tabs = [
  { to: '/platform', label: 'Tổng quan', end: true },
  { to: '/platform/status', label: 'Trạng thái' },
  { to: '/platform/users', label: 'Người dùng' },
  { to: '/platform/workspaces', label: 'Workspace' },
  { to: '/platform/audit', label: 'Audit' },
]

export function PlatformLayout() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Quản trị nền tảng</h1>
      <nav className="flex gap-2">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'btn-primary text-xs' : 'btn-secondary text-xs')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
```

- [ ] **Step 3: Tạo 5 trang tối thiểu (mẫu UsersPage, 4 trang còn lại cùng pattern)**

```tsx
// UsersPage.tsx
import { useState } from 'react'
import { usePlatformUsers } from '@/hooks/usePlatform'
import { PlatformPagination } from '@/components/platform/PlatformPagination'

export function UsersPage() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading, isError } = usePlatformUsers({ q: q || undefined, page, size: 20 })
  if (isLoading) return <div>Đang tải...</div>
  if (isError || !data) return <div>Không tải được danh sách người dùng.</div>
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder="Tìm email / tên..." className="input" />
      <table className="table">
        <thead><tr><th>Email</th><th>Tên</th><th>Admin</th><th>Workspace</th></tr></thead>
        <tbody>
          {data.items.map((u) => (
            <tr key={u.id}><td>{u.email}</td><td>{u.fullName}</td><td>{u.isPlatformAdmin ? 'Yes' : 'No'}</td><td>{u.workspaceCount}</td></tr>
          ))}
        </tbody>
      </table>
      <PlatformPagination page={data.page} totalPages={data.totalPages} totalElements={data.totalItems} onPageChange={setPage} />
    </div>
  )
}
```

`OverviewPage`: hiển thị `users.total`, `workspaces.total` thật + badge `Coming soon` cho `jobs/tokens/failRate/topWorkspaces` (không fake số). `StatusPage`: bảng `services[id,name,status,latencyMs,message]` + `checkedAt`. `WorkspacesPage`: như UsersPage với `ownerEmail/memberCount`. `AuditPage`: gọi `usePlatformAuditLogs`, hiển thị banner "Nhật ký kiểm toán chưa triển khai — API đang trả rỗng" khi `items` rỗng.

- [ ] **Step 4: Đấu router**

```tsx
// frontend/src/app/router.tsx — thêm trong <Routes>, ngoài AuthGuard workspace
import { PlatformGuard } from '@/components/platform/PlatformGuard'
import { PlatformLayout } from '@/pages/platform/PlatformLayout'
// lazy pages...
<Route path="/platform" element={<PlatformGuard><PlatformLayout /></PlatformGuard>}>
  <Route index element={<OverviewPage />} />
  <Route path="status" element={<StatusPage />} />
  <Route path="users" element={<UsersPage />} />
  <Route path="workspaces" element={<WorkspacesPage />} />
  <Route path="audit" element={<AuditPage />} />
</Route>
```

- [ ] **Step 5: Hiện link có điều kiện ở Sidebar**

```tsx
const isPlatformAdmin = useAuthStore((s) => s.user?.isPlatformAdmin === true)
{isPlatformAdmin && <NavLink to="/platform">Platform Admin</NavLink>}
```

- [ ] **Step 6: Chạy test + build**

Run: `npx vitest run src/components/platform/PlatformGuard.test.tsx`
Expected: PASS (user thường redirect `/dashboard`, admin render children, chưa login redirect `/login`).
Run: `npm run build`
Expected: Thành công, 0 lỗi TS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/platform/PlatformGuard.tsx frontend/src/pages/platform frontend/src/app/router.tsx
git commit -m "feat(admin): dung UI platform super admin (guard + 5 trang)"
```

### Task 5: Hardening backend Platform (filter + health thật + count thật)

**Files:**
- Modify: `backend-main/src/main/java/com/app/modules/platform/controller/PlatformController.java:55-235`
- Modify: `backend-main/src/main/java/com/app/modules/auth/repository/UserRepository.java`
- Modify: `backend-main/src/main/java/com/app/modules/workspace/repository/WorkspaceRepository.java`
- Test: `backend-main/src/test/.../PlatformControllerTest.java`

**Interfaces:**
- Consumes: `UserRepository`, `WorkspaceRepository`, `WorkspaceMemberRepository`, `DataSource`.
- Produces: cùng 5 endpoint, nhưng `q/isPlatformAdmin` có tác dụng, `status` trung thực, `overview.newInRange` đếm thật.

- [ ] **Step 1: Thêm query tìm kiếm ở repository**

```java
// UserRepository.java — thêm
@Query("SELECT u FROM User u WHERE (:q IS NULL OR LOWER(u.email) LIKE LOWER(CONCAT('%', :q, '%')) OR LOWER(u.fullName) LIKE LOWER(CONCAT('%', :q, '%'))) AND (:isAdmin IS NULL OR u.isPlatformAdmin = :isAdmin)")
Page<User> searchAdmin(@Param("q") String q, @Param("isAdmin") Boolean isAdmin, Pageable pageable);

// WorkspaceRepository.java — thêm
@Query("SELECT w FROM Workspace w WHERE (:q IS NULL OR LOWER(w.name) LIKE LOWER(CONCAT('%', :q, '%')) OR LOWER(w.slug) LIKE LOWER(CONCAT('%', :q, '%')))")
Page<Workspace> searchAdmin(@Param("q") String q, Pageable pageable);
```

- [ ] **Step 2: Dùng query mới trong controller (thay `findAll`)**

```java
Page<User> userPage = userRepository.searchAdmin(
  (q == null || q.isBlank()) ? null : q.trim(), isPlatformAdmin,
  PageRequest.of(Math.max(0, page), Math.min(size, 100), Sort.by(Sort.Direction.DESC, "createdAt")));
```

Tương tự cho workspaces. Giữ nguyên shape response để FE không vỡ.

- [ ] **Step 3: Count `newInRange` thật trong `overview`**

```java
Instant fromI = Instant.parse((String) res.get("from"));
Instant toI = Instant.parse((String) res.get("to"));
long newUsers = userRepository.countByCreatedAtBetween(fromI, toI);
long newWs = workspaceRepository.countByCreatedAtBetween(fromI, toI);
// Cần thêm 2 method countByCreatedAtBetween vào repository (derived query, không @Query)
```

Thay `Math.min(total,5/3)` bằng số đếm thật. Phần `jobs/tokens/failRate` giữ 0 nhưng thêm comment `// NOTE Phase P2: aggregate media_jobs/ai_usage_logs`.

- [ ] **Step 4: Health check trung thực (không throw 500 khi service down)**

```java
// Giữ DB check hiện tại. Thay 4 dòng hardcode bằng:
services.add(checkTcp("redis", "Redis Cache & Session", redisHost, redisPort, 2000));
services.add(checkTcp("rabbitmq", "RabbitMQ Broker", rabbitHost, rabbitPort, 2000));
services.add(checkHttp("minio", "MinIO S3 Storage", minioHealthUrl, 2000));
services.add(checkHttp("ai_worker", "Python Media Worker", aiHealthUrl, 2000));
// overall = mọi service UP ? "UP" : "DEGRADED"
// Mỗi check try/catch, DOWN kèm message lỗi thật, latency đo thật
```

Nếu chưa có config host/port trong controller thì inject qua `@Value` với default localhost, không hardcode IP.

- [ ] **Step 5: Chạy backend test**

Run: `mvn test -Dtest=PlatformControllerTest`
Expected: PASS (bổ sung case `q` filter + `isPlatformAdmin=true` filter + `size>100` bị clamp).

- [ ] **Step 6: Commit**

```bash
git add backend-main/src/main/java/com/app/modules/platform/controller/PlatformController.java backend-main/src/main/java/com/app/modules/auth/repository/UserRepository.java backend-main/src/main/java/com/app/modules/workspace/repository/WorkspaceRepository.java
git commit -m "fix(admin): platform filter q/admin that, health trung thuc, count that"
```

### Task 6: Verify Workspace Admin không hồi quy (members/billing/presets/usage/credit)

**Files:** Không sửa code, chỉ verify (nếu fail mới quay lại Task 1-2).
- Test: `frontend/src/api/members.test.ts`, `workspaces.test.ts`, `dashboard.test.ts`, `credit.test.ts` (có sẵn thì chạy, thiếu thì viết smoke như Task 2 Step 1).

- [ ] **Step 1: Chạy toàn bộ test frontend**

Run: `npx vitest run`
Expected: PASS toàn bộ (mốc cũ 689-690 tests). Nếu `ProvidersPage` vỡ do đổi signature thì sửa import tại chỗ, không đổi backend.

- [ ] **Step 2: Build frontend**

Run: `npm run build`
Expected: `tsc -b && vite build` thành công, 0 errors.

- [ ] **Step 3: Chạy backend tests**

Run: `mvn test`
Expected: BUILD SUCCESS (mốc cũ 335 tests).

- [ ] **Step 4: Manual checklist (ghi vào PR, không commit code)**

```
- LEAD mời MEMBER/CLIENT, đổi role, xóa member → 200, CLIENT bị chặn write.
- PUT billing-config LEAD_PAYS_ALL <-> PAY_PER_USER → 200.
- Preset SYSTEM chỉ đọc, WS/PROJECT CRUD → 403 khi cố sửa SYSTEM.
- /dashboard + /usage groupBy=operation|project|user → 200.
- /users/me/providers CRUD + /tts-voices/preview → 200 (không còn fallback 404).
- User thường vào /platform → redirect /dashboard; platform admin → thấy 5 trang.
```

### Task 7: Cập nhật tài liệu + env (để AI/humansau không nhầm lại)

**Files:**
- Modify: `docs/API_CONNECTION_ISSUES_AND_CHECKLIST.md` (§2.1, §6)
- Modify: `frontend/.env.example`
- Modify: `docs/API_Contract.md` (§13.1 ghi chú frontend route)

- [ ] **Step 1: Sửa checklist Phase 1 (đang ghi sai "HOÀN THÀNH gồm Super Admin")**

```md
| **Phase 1** | **Auth, User, Workspace & Super Admin** | 🟢 100% | 🟡 90% (thiếu UI /platform trước Task 4, đã đủ sau Task 4) | 🟢 **HOÀN THÀNH SAU TASK 4** |
```

Thêm mục Troubleshooting: "Vào /platform bị redirect /dashboard → user chưa có `is_platform_admin=true`; cấp bằng SQL vận hành, không có tài khoản mặc định."

- [ ] **Step 2: Ghi rõ giới hạn còn lại**

```md
- `GET /platform/overview` jobs/tokens vẫn mock 0 (chờ aggregate media_jobs/ai_usage_logs).
- `GET /platform/audit-logs` stub rỗng có chủ ý (read-only MVP).
- `POST /credit/packages/{id}/purchase` dùng paymentReference thủ công (chưa cổng thật).
- Providers chỉ user-scoped `/users/me/*` + `/tts-voices/*`; mọi path `/workspaces/*/providers/*` đã xóa ở FE.
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/API_CONNECTION_ISSUES_AND_CHECKLIST.md frontend/.env.example docs/API_Contract.md
git commit -m "docs(admin): cap nhat trang thai ket noi admin + gioi han platform"
```

---

## PHẦN 3 — SELF-REVIEW (ĐÃ TỰ SOÁT TRƯỚC KHI GIAO)

1. **Spec coverage:** §1 auth/me (Task 1), §2 members/billing (Task 6 verify), §9 presets (Task 6), §10 credit user (Task 6) + platform read-only (Task 3-5), §11 BYOK user-scoped (Task 2), §13.1 5 endpoint platform (Task 3-5). Không sót yêu cầu admin nào trong contract.
2. **Placeholder scan:** Không còn `TBD/TODO/fill later` trong steps thực thi (chữ `TODO Phase P2` chỉ nằm trong comment code backend cho việc tương lai, không phải placeholder của plan). Mọi "gắn badge Coming soon" đều có code hiển thị cụ thể ở Task 4 Step 3.
3. **Type consistency:** `PlatformUser/Workspace/Page` dùng chung giữa `types/platform.ts` → `api/platform.ts` → `hooks/usePlatform.ts` → pages. `ProviderConfig` bỏ `workspaceId` đồng bộ api→hooks→UI. `User.isPlatformAdmin` đồng bộ BE `UserResponse.java` → FE `types/auth.ts` → `PlatformGuard`.
