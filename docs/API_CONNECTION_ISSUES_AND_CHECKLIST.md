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
3. [Danh mục Chi tiết API Đã có & Còn thiếu (Phase 2 ➔ Phase 6)](#3-danh-mục-chi-tiết-api-đã-có--còn-thiếu-phase-2--phase-6)
   - [Phase 2: Project, Asset Ingestion & Worker Capabilities](#phase-2-project-asset-ingestion--worker-capabilities)
   - [Phase 3: Media Job Orchestration & Pipeline Execution](#phase-3-media-job-orchestration--pipeline-execution)
   - [Phase 4: Subtitles, Review Workbench & QA Gate](#phase-4-subtitles-review-workbench--qa-gate)
   - [Phase 5: Render Studio, Reframe & Cover Layers](#phase-5-render-studio-reframe--cover-layers)
   - [Phase 6: Packaging, Output Delivery & Export](#phase-6-packaging-output-delivery--export)
4. [Cẩm nang Xử lý Nhanh các Lỗi phổ biến (Troubleshooting Guide)](#4-cẩm-nang-xử-lý-nhanh-các-lỗi-phổ-biến-troubleshooting-guide)

---

## 1. TỔNG QUAN TIẾN ĐỘ KẾT NỐI THEO 6 PHASE

| Phase | Tên phân hệ | Backend Code | Frontend Code | Trạng thái Kết nối | Ghi chú |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **Phase 1** | **Xác thực, Người dùng, Workspace & Super Admin** | 🟢 100% | 🟢 100% | 🟢 **HOÀN THÀNH** | Đã bao gồm Super Admin Platform (`/api/platform/*`) |
| **Phase 2** | **Dự án & Năng lực Hạ tầng** (Asset Ingestion & Capabilities) | 🟢 85% | 🟢 100% | 🟡 **ĐANG KẾT NỐI** | Đã có Project, MinIO Asset Upload, Consent; chỉ còn thiếu `/api/transformation/capabilities` |
| **Phase 3** | **Khởi tạo & Điều phối Job** (Job Orchestration & Pipeline) | 🟢 80% | 🟢 100% | ⚪ Chờ Phase 2 | Đã có CRUD Job, Stages rerun, Checkpoint, Voice, Batch, Proposal; cần gắn AI Worker Python |
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
  1. Tạo Flyway migration `backend-main/src/main/resources/db/migration/V7__add_is_platform_admin.sql` thêm cột `is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE`.
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

## 3. DANH MỤC CHI TIẾT API ĐÃ CÓ & CÒN THIẾU (PHASE 2 ➔ PHASE 6)

Dưới đây là danh sách phân loại chi tiết theo trạng thái thực tế trong mã nguồn:

### Phase 2: Project, Asset Ingestion & Worker Capabilities
* 🟢 **ĐÃ CÓ TRONG BACKEND:**
  - `GET/POST /api/workspaces/{wsId}/projects`: Quản lý danh sách và tạo Project (`ProjectController`).
  - `GET/POST/DELETE /api/workspaces/{wsId}/projects/{pId}/members`: Gán và quản lý thành viên trong Project.
  - `GET /api/workspaces/{wsId}/media/terms-version`: Lấy phiên bản điều khoản bản quyền (`MediaAssetController`).
  - `POST /api/workspaces/{wsId}/projects/{pId}/media/assets`: Tải lên video gốc (Multipart upload trực tiếp lên MinIO).
  - `GET /api/workspaces/{wsId}/projects/{pId}/media/assets`: Liệt kê tài nguyên video gốc.
  - `GET /api/workspaces/{wsId}/media/assets/{assetId}`: Lấy chi tiết tài nguyên video.
  - `POST /api/workspaces/{wsId}/media/assets/{assetId}/consent`: Ghi nhận cam kết bản quyền của người dùng.
* 🔴 **CÒN THIẾU CẦN BỔ SUNG:**
  - `GET /api/transformation/capabilities`:
    - **Mức độ:** Cực kỳ quan trọng (Khởi tạo Media Studio không bị fallback).
    - **Nhiệm vụ:** Trả về trạng thái sẵn sàng của AI Worker (`FAST` và `STUDIO` mode, workerCount, readiness).
    - **Giải pháp:** Cần tạo `TransformationController.java` trả về `AvailabilityProjection`.

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

## 4. CẨM NANG XỬ LÝ NHANH CÁC LỖI PHỔ BIẾN (TROUBLESHOOTING GUIDE)

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
