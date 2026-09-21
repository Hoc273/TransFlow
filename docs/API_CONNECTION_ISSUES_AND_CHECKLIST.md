# 📋 NHẬT KÝ KẾT NỐI API: CÁC PHẦN CÒN THIẾU, LỖI THƯỜNG GẶP & CÁCH KHẮC PHỤC
> **Dự án:** TransFlow (TransFlow Media Studio)  
> **Tài liệu theo dõi:** Trạng thái kết nối API Frontend ➔ Backend, các lỗi phát sinh trong quá trình tích hợp và danh sách tính năng cần bổ sung theo từng Phase.  
> **Cập nhật lần cuối:** 21/09/2026  

---

## 📌 MỤC LỤC
1. [Tổng quan Tiến độ Kết nối theo 6 Phase](#1-tổng-quan-tiến-độ-kết-nối-theo-6-phase)
2. [Chi tiết Phase 1: Auth, User, Workspace & Platform Super Admin](#2-chi-tiết-phase-1-auth-user-workspace--platform-super-admin)
   - [Trạng thái hoàn thành](#21-trạng-thái-hoàn-thành)
   - [Các lỗi đã gặp & Giải pháp xử lý](#22-các-lỗi-đã-gặp--giải-pháp-xử-lý)
   - [Tài khoản Super Admin mặc định](#23-tài-khoản-super-admin-mặc-định)
   - [Cấu hình môi trường bên ngoài cần bổ sung (.env)](#24-cấu-hình-môi-trường-bên-ngoài-cần-bổ-sung-env)
3. [Chi tiết Phase 2: Dự án, Tiếp nhận Video Asset & Năng lực Hạ tầng](#3-chi-tiết-phase-2-dự-án-tiếp-nhận-video-asset--năng-lực-hạ-tầng)
   - [Trạng thái hoàn thành & Bảng đối soát API](#31-trạng-thái-hoàn-thành--bảng-đối-soát-api)
   - [Các điểm thiếu đã phát hiện & Giải pháp xử lý](#32-các-điểm-thiếu-đã-phát-hiện--giải-pháp-xử-lý)
   - [Kết quả kiểm thử & Build thực tế](#33-kết-quả-kiểm-thử--build-thực-tế)
4. [Danh mục Chi tiết API Đã có & Còn thiếu (Phase 3 ➔ Phase 6)](#4-danh-mục-chi-tiết-api-đã-có--còn-thiếu-phase-3--phase-6)
   - [Phase 3: Media Job Orchestration & Pipeline Execution](#phase-3-media-job-orchestration--pipeline-execution)
   - [Phase 4: Subtitles, Review Workbench & QA Gate](#phase-4-subtitles-review-workbench--qa-gate)
   - [Phase 5: Render Studio, Reframe & Cover Layers](#phase-5-render-studio-reframe--cover-layers)
   - [Phase 6: Packaging, Output Delivery & Export](#phase-6-packaging-output-delivery--export)
5. [Cẩm nang Xử lý Nhanh các Lỗi phổ biến (Troubleshooting Guide)](#5-cẩm-nang-xử-lý-nhanh-các-lỗi-phổ-biến-troubleshooting-guide)

---

## 1. TỔNG QUAN TIẾN ĐỘ KẾT NỐI THEO 6 PHASE

| Phase | Tên phân hệ | Backend Code | Frontend Code | Trạng thái Kết nối | Ghi chú |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **Phase 1** | **Xác thực, Người dùng, Workspace & Super Admin** | 🟢 100% | 🟢 100% | 🟢 **HOÀN THÀNH** | Đã bao gồm Super Admin Platform (`/api/platform/*`) |
| **Phase 2** | **Dự án & Năng lực Hạ tầng** (Asset Ingestion & Capabilities) | 🟢 100% | 🟢 100% | 🟢 **HOÀN THÀNH** | Đã có Project, MinIO Asset Upload, Consent, và Transformation Capabilities |
| **Phase 3** | **Khởi tạo & Điều phối Job** (Job Orchestration & Pipeline) | 🟢 80% | 🟢 100% | 🟡 **ĐANG KẾT NỐI** | Đã có CRUD Job, Stages rerun, Checkpoint, Voice, Batch, Proposal; cần gắn AI Worker Python |
| **Phase 4** | **Biên tập Phụ đề & QA** (Review Workbench & Subtitles) | 🟡 70% | 🟢 100% | ⚪ Chờ Phase 3 | Đã có Single Patch Subtitle, QA Override; thiếu `/segments/batch` |
| **Phase 5** | **Studio Dựng hình & Lớp phủ** (Render Studio & Reframe) | 🔴 10% | 🟢 100% | ⚪ Chờ Phase 4 | Cần xây dựng `/render-config`, `/subtitle-styles` |
| **Phase 6** | **Đóng gói & Xuất bản** (Packaging & Delivery Export) | 🔴 10% | 🟢 100% | ⚪ Chờ Phase 5 | Cần xây dựng `/export`, `/output-package`, `/publish-package` |

---

## 2. CHI TIẾT PHASE 1: AUTH, USER, WORKSPACE & PLATFORM SUPER ADMIN

### 2.1 Trạng thái hoàn thành
- [x] `POST /api/auth/register`: Đăng ký tài khoản (Họ tên, Email, Mật khẩu, mã OTP xác thực).
- [x] `POST /api/auth/register/otp`: Gửi mã OTP xác thực email khi đăng ký mới (kèm Smart Local Fallback).
- [x] `POST /api/auth/login`: Đăng nhập cấp cặp Token JWT (Access Token 30p, Refresh Token 14 ngày).
- [x] `GET /api/auth/me`: Lấy profile người dùng hiện tại (hỗ trợ cờ `isPlatformAdmin`).
- [x] `POST /api/auth/refresh`: Tự động làm mới token ngầm khi mã 401 xảy ra.
- [x] `POST /api/auth/forgot-password/otp`: Yêu cầu mã OTP đặt lại mật khẩu.
- [x] `POST /api/auth/forgot-password/verify`: Kiểm tra tính hợp lệ của mã OTP.
- [x] `POST /api/auth/forgot-password/reset`: Đổi mật khẩu mới sau khi xác thực OTP thành công.
- [x] `GET/POST /api/workspaces`: Xem danh sách và tạo không gian làm việc mới.
- [x] `GET/PUT /api/workspaces/{id}/billing-config`: Cấu hình chế độ trừ phí Workspace (`LEAD_PAYS_ALL` / `PAY_PER_USER`).
- [x] `GET/POST /api/workspaces/{id}/members`: Danh sách và mời thành viên (Chuẩn RESTful duy nhất).
- [x] `PUT/DELETE /api/workspaces/{id}/members/{id}`: Phân quyền và xóa thành viên khỏi Workspace.
- [x] `GET/POST /api/auth/google/*`: Bộ điều khiển OAuth2 với bảo mật PKCE + OIDC.
- [x] `GET /api/platform/overview`: Tổng quan 6 chỉ số KPI dành riêng cho Super Admin.
- [x] `GET /api/platform/status`: Kiểm tra trạng thái sống của 6 dịch vụ hạ tầng (DB, Redis, RabbitMQ, MinIO, Gateway, Workers).
- [x] `GET /api/platform/users`: Danh bạ người dùng toàn hệ thống (phân trang, tìm kiếm, lọc admin).
- [x] `GET /api/platform/workspaces`: Danh bạ workspace toàn hệ thống (phân trang, số thành viên, số dự án).
- [x] `GET /api/platform/audit-logs`: Xem lịch sử kiểm toán của Super Admin.

---

### 2.2 Các lỗi đã gặp & Giải pháp xử lý

#### Lỗi 1: `Port 8080 was already in use` (Process terminated with exit code: 1)
- **Hiện tượng:** Khi chạy lệnh `mvn spring-boot:run` tại terminal, tiến trình Maven báo lỗi đỏ:  
  `Failed to execute goal org.springframework.boot:spring-boot-maven-plugin:3.3.5:run (default-cli) on project backend-main: Process terminated with exit code: 1`.
- **Nguyên nhân:** Cổng 8080 đã bị một tiến trình Java khác (hoặc backend chạy ngầm trước đó) chiếm giữ.
- **Cách xử lý:**
  1. Mở PowerShell kiểm tra tiến trình đang giữ cổng:
     ```powershell
     Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess
     ```
  2. Tắt tiến trình cũ để giải phóng cổng:
     ```powershell
     Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force
     ```
  3. Khởi động lại `mvn spring-boot:run`.

#### Lỗi 2: Chưa có tài khoản Gmail SMTP làm tắc nghẽn luồng Đăng ký / Đổi mật khẩu
- **Hiện tượng:** Người dùng chưa cấu hình thông tin gửi mail Gmail, các thao tác cần OTP có thể bị lỗi mạng hoặc không nhận được mã.
- **Giải pháp xử lý (Đã cài đặt):**
  - Tích hợp cơ chế **Smart Local Fallback**: Nếu `.env` chưa có thông tin Gmail, hệ thống không báo lỗi mà tự động in mã OTP trực tiếp ra Terminal:
    ```text
    [EMAIL LOCAL FALLBACK] Mail credentials not configured. OTP for user@example.com: [xxxxxx]
    ```
  - Nhà phát triển có thể copy mã từ terminal để tiếp tục kiểm thử web bình thường.

#### Lỗi 3: Lệch đường dẫn API Mời thành viên (`/members` vs `/members/invite`)
- **Hiện tượng:** Tài liệu cũ ghi nhầm `/members/invite` trong khi Backend và Frontend chuẩn RESTful dùng `/members`.
- **Giải pháp xử lý (Đã thống nhất 1 chuẩn duy nhất):**
  - Đã thống nhất toàn diện 1 chuẩn duy nhất theo Hợp đồng API (`docs/API_Contract.md`): `POST /api/workspaces/{workspaceId}/members`. Cả Frontend (`members.ts`), Backend (`WorkspaceController.java`) và tài liệu kế hoạch đều đồng bộ 100%.

#### Lỗi 4: Super Admin bị chặn 403 Forbidden và thiếu API `/api/platform/*`
- **Hiện tượng:** Khi đăng nhập tài khoản Admin và truy cập vào phân hệ `/platform` (Super Admin Portal), giao diện bị từ chối truy cập (403 Forbidden) hoặc chuyển hướng về trang Dashboard thường, không thể xem thông số hệ thống.
- **Nguyên nhân:**
  1. Trong Database bảng `users` và Entity `User.java` chưa có cột `is_platform_admin`.
  2. DTO `UserResponse` không chứa trường `isPlatformAdmin`, khiến cho `GET /api/auth/me` không trả về cờ quyền hạn cho Frontend Guard (`user?.isPlatformAdmin`).
  3. Backend hoàn toàn chưa cài đặt `PlatformController` cung cấp các API `/api/platform/*`.
- **Giải pháp xử lý (Đã hoàn thành 100%):**
  1. Tạo Flyway migration `backend-main/src/main/resources/db/migration/V9__add_is_platform_admin.sql` thêm cột `is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE`.
  2. Bổ sung trường `isPlatformAdmin` vào `User.java` và `@JsonProperty("isPlatformAdmin")` trong `UserResponse.java` (giữ constructor tương thích ngược).
  3. Xây dựng `PlatformController.java` (`com.app.modules.platform.controller`) cung cấp đủ 5 endpoint: `/overview`, `/status`, `/users`, `/workspaces`, `/audit-logs`.
  4. Bổ sung `countByUserId` và `countByWorkspaceId` trong `WorkspaceMemberRepository`.
  5. Viết bộ kiểm thử `PlatformControllerTest.java` (4/4 test cases pass 100%).
  6. Khởi tạo tài khoản Super Admin mẫu sẵn sàng sử dụng.

#### Lỗi 5 (Lỗi tiềm ẩn đã phát hiện & đồng bộ): Lệch giá trị Enum `CostMode` giữa Frontend và Backend
- **Hiện tượng:** Frontend `frontend/src/api/workspaces.ts` từng khai báo type là `'WORKSPACE_OWNER' | 'INDIVIDUAL_USER'`.
- **Nguyên nhân:** Backend `CostMode.java` và Hợp đồng `API_Contract.md` quy định chuẩn là `'LEAD_PAYS_ALL' | 'PAY_PER_USER'`. Nếu gọi API cập nhật cấu hình trừ phí, Backend Jackson sẽ báo lỗi `400 Bad Request`.
- **Giải pháp xử lý (Đã đồng bộ):**
  - Đã cập nhật `frontend/src/api/workspaces.ts` về đúng chuẩn:
    ```typescript
    export type CostMode = 'LEAD_PAYS_ALL' | 'PAY_PER_USER'
    ```
  - Đã kiểm tra build Frontend thành công 100% (`tsc -b && vite build` không có lỗi).

---

### 2.3 Tài khoản Super Admin mặc định
Để kiểm thử phân hệ Super Admin Platform (`/platform`), sử dụng tài khoản sau:
- **Email:** `admin@transflow.com`
- **Mật khẩu:** `AdminPassword123!`
- **Quyền hạn:** `isPlatformAdmin: true`, Workspace Role: `LEAD`, Số dư Credit: `999,999`.

---

### 2.4 Cấu hình môi trường bên ngoài cần bổ sung (.env)
Dành cho khi muốn đưa vào hoạt động thực tế với tài khoản thật của Google:

```env
# 1. Gửi Gmail thật (Yêu cầu mật khẩu ứng dụng Google 16 ký tự)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=email_cua_ban@gmail.com
MAIL_PASSWORD=xxxx xxxx xxxx xxxx
MAIL_FROM=email_cua_ban@gmail.com

# 2. Đăng nhập Google (Lấy từ Google Cloud Console > Credentials > OAuth 2.0 Client ID)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/auth/google/callback
```

---

## 3. CHI TIẾT PHASE 2: DỰ ÁN, TIẾP NHẬN VIDEO ASSET & NĂNG LỰC HẠ TẦNG

### 3.1 Trạng thái hoàn thành & Bảng đối soát API (100% Hoàn thành)

| STT | Luồng nghiệp vụ | Endpoint & Method | Phía Backend | Phía Frontend | Trạng thái |
| :-: | :--- | :--- | :--- | :--- | :---: |
| 1 | **Quản lý & tạo Dự án (Project)** | `GET/POST /api/workspaces/{wsId}/projects` | `ProjectController.java`<br/>`CreateProjectRequest.java` | `listProjectsApi`, `createProjectApi`<br/>Hooks: `useProjects`, `useCreateProject` | 🟢 Hoàn thành |
| 2 | **Quản lý thành viên Dự án (Project Members)** | `GET/POST/DELETE /api/workspaces/{wsId}/projects/{pId}/members` | `ProjectController.java`<br/>`ProjectMemberResponse.java` | `projects.ts`: `listProjectMembersApi`, `assignProjectMemberApi`, `removeProjectMemberApi`<br/>Hooks: `useProjects.ts` | 🟢 Hoàn thành |
| 3 | **Kiểm tra năng lực Worker AI** | `GET /api/transformation/capabilities` | `TransformationController.java`<br/>`AvailabilityProjection.java` | `getTransformationCapabilitiesApi`<br/>Hook: `useTransformationCapabilities` | 🟢 Hoàn thành |
| 4 | **Lấy phiên bản Điều khoản Bản quyền** | `GET /api/workspaces/{wsId}/media/terms-version` | `MediaAssetController.java` | `getMediaTermsVersionApi`<br/>`getTransformationTermsVersionApi` | 🟢 Hoàn thành |
| 5 | **Upload video gốc lên MinIO** | `POST /api/workspaces/{wsId}/projects/{pId}/media/assets` | `MediaAssetController.java`<br/>(Multipart upload trực tiếp vào MinIO) | `uploadTransformationMediaApi`<br/>(XHR upload kèm % tiến độ & AbortSignal) | 🟢 Hoàn thành |
| 6 | **Liệt kê danh sách video gốc của Project** | `GET /api/workspaces/{wsId}/projects/{pId}/media/assets` | `MediaAssetController.java` (`listAssets`) | `media.ts`: `listProjectMediaAssetsApi`<br/>Hook: `useProjectMediaAssets` | 🟢 Hoàn thành |
| 7 | **Lấy chi tiết metadata 1 Video Asset** | `GET /api/workspaces/{wsId}/media/assets/{assetId}` | `MediaAssetController.java` (`getAsset`) | `media.ts`: `getMediaAssetApi`<br/>Hook: `useMediaAsset` | 🟢 Hoàn thành |
| 8 | **Ký cam kết bản quyền Asset (Consent)** | `POST /api/workspaces/{wsId}/media/assets/{assetId}/consent` | `MediaAssetController.java` (`consent`) | `consentTransformationAssetApi`<br/>Hook: `useConsentMediaAsset` | 🟢 Hoàn thành |

---

### 3.2 Các điểm thiếu đã phát hiện & Giải pháp xử lý

#### Vấn đề 1: Frontend thiếu bộ API & Hooks quản lý thành viên Dự án (Project Members)
- **Hiện tượng:** Backend đã hỗ trợ phân quyền theo Project (`/members`), nhưng Frontend chưa định nghĩa types, API methods và React Query hooks, làm gián đoạn việc quản lý thành viên dự án.
- **Giải pháp xử lý:**
  1. Thêm type `ProjectMember` và `AssignProjectMemberBody` tại `frontend/src/types/project.ts`.
  2. Bổ sung 3 hàm `listProjectMembersApi`, `assignProjectMemberApi`, `removeProjectMemberApi` trong `frontend/src/api/projects.ts`.
  3. Đăng ký query key `projectMembers: (wsId, projectId) => ['projectMembers', wsId, projectId]` tại `frontend/src/lib/queryClient.ts`.
  4. Viết 3 hooks `useProjectMembers`, `useAssignProjectMember`, `useRemoveProjectMember` tại `frontend/src/hooks/useProjects.ts` có cơ chế tự động invalidate cache khi thay đổi thành viên.

#### Vấn đề 2: Bổ sung đầy đủ các trường cấu hình Project (`defaultGlossaryId`, `tmEnabled`, `domain`, `tone`) vào Backend
- **Hiện tượng:** Form `CreateProjectModal.tsx:59-67` trên Frontend gửi payload gồm `name`, `sourceLang`, `defaultGlossaryId`, `tmEnabled`, `domain`, `tone` nhằm cung cấp ngữ cảnh thiết yếu để AI dịch thuật, tạo phụ đề và lồng tiếng chuẩn xác. Trước đó Backend `Project.java` và DTO `CreateProjectRequest.java`, `ProjectResponse.java` chỉ khai báo 2 trường `name` và `sourceLang`.
- **Giải pháp xử lý:**
  1. Tạo Flyway migration `V11__add_project_settings_fields.sql` đảm bảo 4 cột `default_glossary_id`, `tm_enabled`, `domain`, `tone` luôn hiện diện trên bảng `projects`.
  2. Cập nhật Entity `Project.java` ánh xạ đầy đủ 4 trường với JPA.
  3. Bổ sung các trường vào `CreateProjectRequest.java` và `ProjectResponse.java` (kèm constructor tương thích ngược tránh ảnh hưởng các test hiện hữu).
  4. Cập nhật `ProjectServiceImpl.java` lưu trữ và trả về trọn vẹn các thuộc tính khi tạo mới Project.
  5. Viết test `testCreateProjectWithAllFields` trong `ProjectControllerTest.java` (Pass 100%).

#### Vấn đề 3: Frontend thiếu API & Hooks truy vấn danh sách Media Assets gốc trên MinIO
- **Hiện tượng:** Frontend chỉ có hàm upload `uploadTransformationMediaApi`, chưa có API để query danh sách video gốc đã tải lên của một Project hoặc chi tiết 1 asset.
- **Giải pháp xử lý:**
  1. Bổ sung trường `parentAssetId?: string | null` vào type `MediaAsset` tại `frontend/src/types/media.ts` để đồng bộ 100% với DTO `MediaAssetResponse.java` của Backend.
  2. Bổ sung 2 hàm `listProjectMediaAssetsApi(wsId, projectId)` và `getMediaAssetApi(wsId, assetId)` vào `frontend/src/api/media.ts` và re-export tại `frontend/src/api/transformation.ts`.
  3. Thêm query keys `mediaAssets` và `mediaAsset` tại `frontend/src/lib/queryClient.ts`.
  4. Viết hooks `useProjectMediaAssets` và `useMediaAsset` tại `frontend/src/hooks/useMedia.ts`, đồng thời cấu hình `useUploadMedia` tự động invalidate cache `mediaAssets` sau khi tải video thành công.

---

### 3.3 Kết quả kiểm thử & Build thực tế
- **Backend Tests:** `mvn test` ➔ **335/335 tests PASS 100%** (`BUILD SUCCESS`).
- **Frontend Tests:** `npx vitest run` ➔ **689/689 tests PASS 100%** (69 test files).
- **Frontend Build:** `npm run build` (`tsc -b && vite build`) ➔ **THÀNH CÔNG 100%** (0 errors).
- **Linter:** `npm run lint` ➔ **0 errors**.

---

## 4. DANH MỤC CHI TIẾT API ĐÃ CÓ & CÒN THIẾU (PHASE 3 ➔ PHASE 6)

Dưới đây là danh sách phân loại chi tiết theo trạng thái thực tế trong mã nguồn:

### Phase 3: Media Job Orchestration & Pipeline Execution
* 🟢 **ĐÃ CÓ TRONG BACKEND:**
  - `POST /api/workspaces/{wsId}/media/jobs`: Khởi tạo Job dịch thuật/tóm tắt video (`MediaJobController`).
  - `GET /api/workspaces/{wsId}/projects/{pId}/media/jobs`: Danh sách Job theo Project.
  - `GET /api/workspaces/{wsId}/media/jobs/{jobId}`: Chi tiết tiến trình các stage của Job.
  - `POST /api/workspaces/{wsId}/media/jobs/{jobId}/cancel`: Hủy Job đang thực thi.
  - `POST /api/workspaces/{wsId}/media/jobs/{jobId}/voice`: Chọn giọng đọc TTS (`TtsVoiceController`).
  - `POST /api/workspaces/{wsId}/media/jobs/{jobId}/stages/{stageName}/rerun`: Chạy lại một công đoạn (ASR, TRANSLATE, DUBBING, RENDER).
  - `POST /api/workspaces/{wsId}/media/jobs/{jobId}/checkpoints/{checkpoint}/confirm`: Xác nhận qua checkpoint kiểm duyệt.
  - `POST /api/workspaces/{wsId}/projects/{pId}/batches`: Tạo xử lý hàng loạt video (`BatchController`).
  - `GET /api/workspaces/{wsId}/media/jobs/{jobId}/proposals`: Danh sách đề xuất tóm tắt AI (`SummarizationController`).
  - `POST /api/workspaces/{wsId}/media/jobs/{jobId}/refine`: Yêu cầu AI tinh chỉnh tóm tắt theo phản hồi.
* 🟡 **CẦN ĐỒNG BỘ THÊM:**
  - Tích hợp điều phối tin nhắn RabbitMQ thực tế tới Worker Python.

### Phase 4: Subtitles, Review Workbench & QA Gate
* 🟢 **ĐÃ CÓ TRONG BACKEND:**
  - `GET /api/workspaces/{wsId}/media/jobs/{jobId}/subtitles`: Lấy danh sách timeline phân đoạn phụ đề.
  - `PATCH /api/workspaces/{wsId}/media/jobs/{jobId}/subtitles/{segmentId}`: Chỉnh sửa 1 dòng phụ đề lẻ.
  - `GET /api/workspaces/{wsId}/media/jobs/{jobId}/qa-issues`: Liệt kê các cảnh báo chất lượng dịch (`QaController`).
  - `POST /api/workspaces/{wsId}/qa-issues/{issueId}/override`: Vượt qua cảnh báo QA có ghi chú lý do.
* 🔴 **CÒN THIẾU CẦN BỔ SUNG:**
  - `PUT /api/workspaces/{wsId}/media/jobs/{jobId}/segments/batch`:
    - **Nhiệm vụ:** Lưu đồng loạt toàn bộ danh sách phụ đề đã chỉnh sửa trên Review Workbench trong 1 request.

### Phase 5: Render Studio, Reframe & Cover Layers
* 🔴 **CÒN THIẾU CẦN BỔ SUNG:**
  - `GET/PUT /api/workspaces/{wsId}/media/jobs/{jobId}/render-config`: Cấu hình tỷ lệ khung hình (`16:9`, `9:16`, `1:1`), thuật toán reframe và tối đa 4 lớp phủ (Cover Layers).
  - `GET/POST/PUT/DELETE /api/media/subtitle-styles`: Quản lý mẫu kiểu dáng phụ đề (Font, Size, PrimaryColor, Outline, Karaoke effect).

### Phase 6: Packaging, Output Delivery & Export
* 🔴 **CÒN THIẾU CẦN BỔ SUNG:**
  - `POST /api/workspaces/{wsId}/media/jobs/{jobId}/export`: Yêu cầu xuất bản video hoặc tải phụ đề (.SRT, .VTT, .MP4).
  - `GET /api/workspaces/{wsId}/media/jobs/{jobId}/output-package`: Tải gói thành phẩm hoàn chỉnh.
  - `GET/PUT /api/workspaces/{wsId}/media/jobs/{jobId}/publish-package`: Quản lý tiêu đề, mô tả và metadata phát hành.

---

## 5. CẨM NANG XỬ LÝ NHANH CÁC LỖI PHỔ BIẾN (TROUBLESHOOTING GUIDE)

```mermaid
flowchart TD
    Start["Gặp lỗi khi chạy / gọi API"] --> CheckType{"Loại lỗi là gì?"}

    CheckType -->|"Port 8080 in use / Exit code 1"| PortErr["Tắt tiến trình chiếm cổng 8080:<br/>Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force"]
    CheckType -->|"Không nhận được OTP email"| MailErr["Xem mã OTP in trực tiếp tại cửa sổ Terminal Backend<br/>Dòng: [EMAIL LOCAL FALLBACK] OTP for ..."]
    CheckType -->|"Vào /platform bị 403 Forbidden"| AdminErr["Tài khoản chưa có quyền Super Admin.<br/>Đăng nhập tài khoản mẫu admin@transflow.com / AdminPassword123!"]
    CheckType -->|"Lỗi 401 Unauthorized"| AuthErr["Token hết hạn hoặc chưa đăng nhập.<br/>Đăng nhập lại tại /login để lấy cặp JWT mới."]
    CheckType -->|"Báo Google chưa cấu hình"| GoogleErr["Thêm GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET vào file .env"]
    CheckType -->|"Docker Postgres / Redis không kết nối"| DockerErr["Chạy lệnh: docker compose up -d<br/>Kiểm tra lại trạng thái container: docker ps"]
```

---
*Tài liệu này được duy trì liên tục trong suốt quá trình kết nối API giữa Frontend và Backend.*

