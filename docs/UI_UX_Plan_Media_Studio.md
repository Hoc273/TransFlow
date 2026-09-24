# Kế hoạch cải thiện UI/UX — Media Studio (tab "Dự án video" & "Preset quy trình")

> Ngày: 2026-09-24 · Nhánh: `develop-update-ui-workpreset`
> Phạm vi: **chỉ Frontend** (`frontend/src`). Không đổi API, không đổi payload gửi lên BE, không cần migration.

---

## 0. Nguyên tắc: không ảnh hưởng BE

| Quy tắc | Cách đảm bảo |
|---|---|
| Không thêm hoặc đổi endpoint | Chỉ dùng các API đã có: `useMediaJobs`, `useProjectMediaAssets`, `createTransformationJobApi`, `rerunTransformationStageApi`, `exportTransformationJobApi`, `list/create/update/deleteWorkflowPresetApi`. |
| Không đổi payload | Không sửa `lib/media/batchJobPayload.ts` (`createJobApiBody`, `buildLocalizationCreateJobInput`) và `buildConfig()` / `hydrateForm()` trong `PresetSettingsPage.tsx`. Chỉ di chuyển UI quanh các hàm này. |
| Lọc, tìm kiếm, sắp xếp làm ở client | Dữ liệu job/preset đã tải đủ về FE (đang phân trang client, `PAGE_SIZE = 8`) nên có thể lọc trên mảng sẵn có. |
| Giữ URL cũ hoạt động | `/w/:ws/media?project=…#overview`, `#upload`, `/media/presets`, `?projectId=` vẫn phải chạy như cũ (dashboard và sidebar đang link tới). |
| Giữ `data-testid` | Các test hiện có (`MediaListPage.test.tsx`, `UploadConsentPanel.*.test.tsx`, `WorkflowPresetPicker.test.tsx`, `PresetSettingsPage.test.tsx`) phải pass mà không cần sửa assertion nghiệp vụ. |

---

## 1. Hiện trạng và vấn đề UX

### 1.1. Tab "Dự án video" (`pages/media/MediaListPage.tsx`)

Cấu trúc hiện tại: Header → `MediaStudioNav` (2 tab) → khung chọn dự án → `StudioAccordion` gồm panel `[0] overview` (bảng job) và `[1] upload` (form tạo job, `UploadConsentPanel.tsx`, khoảng 1.870 dòng).

| # | Vấn đề | Vị trí |
|---|---|---|
| A1 | **Điều hướng 3 tầng** (tab → chọn dự án → accordion). Danh sách job và form tạo job là 2 việc khác nhau nhưng lại đặt chung trong accordion. Người dùng phải đóng/mở panel, và index accordion bắt đầu từ "0". | `MediaListPage` `panels[]` |
| A2 | Nút "Tạo job mới" ở header và panel "1" làm cùng một việc, gây trùng lặp. | header + panel `upload` |
| A3 | Nút làm mới dùng nhãn `common:retry` ("Thử lại") nên dễ hiểu sai. | header |
| A4 | Khi chưa chọn dự án, trang gần như trống. Khung chọn dự án nằm dưới tab nên khó thấy đây là bước bắt buộc. | `media-project-picker` |
| A5 | Bảng job **không có tìm kiếm hay lọc** (theo trạng thái, ngôn ngữ đích, chế độ) và không sắp xếp được. Phân trang chỉ 8 dòng. | `JobsTable` |
| A6 | Các hành động chỉ có icon (Xem, Tải, Chạy lại, Chi tiết). **Chạy lại không có xác nhận**, tự đoán stage cần chạy, lỗi chỉ ghi `console.error` nên người dùng không nhận được phản hồi. | `handleRerun`, `handleDownload` |
| A7 | Mỗi lần đóng/mở accordion lại `navigate` với `replace: false`, tạo thêm entry trong lịch sử, nên nút Back của trình duyệt bị "kẹt". | `handlePanelToggle` |
| A8 | Đổi dự án bằng `navigate({search: ?project=…})` sẽ xóa các query param khác. | `<select onChange>` |
| A9 | Chuỗi hard-code kiểu `language === 'vi' ? … : …` (44 chỗ trong `UploadConsentPanel` + `MediaListPage`) không đi qua i18n. | nhiều chỗ |

**Form tạo job (`UploadConsentPanel`)**

| # | Vấn đề |
|---|---|
| B1 | Bố cục 2 cột: cột trái là Bước 1 (Upload) và Bước 2 (Consent), cột phải có 3 section cấu hình **bị disable cho tới khi consent xong**. Người dùng thấy một form lớn bị xám mà không biết lý do. |
| B2 | **Preset bị chôn ở Section 3** ("Quy trình thực thi & Thời lượng"). Preset lại quyết định mode, subtitle, giọng đọc…, nên chọn preset sau khi đã cấu hình tay là ngược luồng. |
| B3 | Link "Quản lý preset" mở tab mới. Preset dùng `staleTime: STALE.static`, nên sau khi tạo preset ở tab kia và quay lại, picker không có preset mới. |
| B4 | Tóm tắt trước khi tạo (`media-create-summary-strip`) nằm cuối form, không cố định, nên form dài phải cuộn mới thấy nút tạo. |
| B5 | Sau khi tạo có đếm ngược chuyển trang (`redirectCountdown`) mà không có lựa chọn ở lại để tạo tiếp. |

### 1.2. Tab "Preset quy trình" (`pages/settings/PresetSettingsPage.tsx`)

| # | Vấn đề |
|---|---|
| C1 | Tiêu đề trang vẫn là "Media Studio", không nói rõ đây là trang preset. Banner mô tả dài. |
| C2 | 3 khối xếp dọc (Workspace, Dự án, Hệ thống). Khối "Dự án" chỉ hiện khi chọn filter dự án, nếu không thì chỉ có một dòng gợi ý. |
| C3 | Không có tìm kiếm và không lọc được "Đang bật / Tắt / Mặc định". |
| C4 | **Không nhân bản được** preset, nhất là preset SYSTEM (chỉ đọc). Muốn tùy biến thì phải tạo lại từ đầu. |
| C5 | Không có thao tác nhanh "Đặt làm mặc định" hay "Bật/Tắt"; phải mở modal sửa. |
| C6 | Modal form rất lớn (4 tab cộng khung preview). Đóng modal khi đang sửa thì **mất dữ liệu mà không cảnh báo**. |
| C7 | Không có đường tắt "Dùng preset này để tạo job" từ card preset. |
| C8 | Thẻ preset có nhiều badge nhưng khó so sánh nhanh (mode, subtitle, giọng đọc, tỉ lệ khung hình). |

---

## 2. Thiết kế đề xuất

### 2.1. Tab "Dự án video": tách "Danh sách" và "Tạo mới" thành 2 view

Bỏ `StudioAccordion` ở trang hub. Dùng 2 view dựa trên hash có sẵn (không đổi URL):

```
┌ Media Studio ──────────────────────────────── [⟳ Làm mới] [+ Tạo video mới] ┐
│ [ Dự án video ] [ Preset quy trình ]                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ 📁 Dự án: [ Dự án A · Tiếng Anh ▼ ]   Nguồn: EN · Lĩnh vực: …   ● 2 đang chạy │
├──────────────────────────────────────────────────────────────────────────────┤
│ #overview  → Danh sách job                                                    │
│   [🔍 Tìm theo tên video]  [Trạng thái ▼] [Ngôn ngữ ▼] [Chế độ ▼]  Sắp xếp ▼  │
│   Chip nhanh: Tất cả (12) · Đang chạy (2) · Cần duyệt (1) · Lỗi (1) · Xong (8)│
│   ┌ bảng job (giữ nguyên cột) …                                ┐              │
│ #upload    → Form "Tạo video mới" (wizard, xem 2.2)                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **A1/A2**: `#overview` hiện bảng, `#upload` hiện form kèm nút "← Quay lại danh sách". Nút "+ Tạo video mới" ở header là lối vào duy nhất. Giữ nguyên cơ chế giữ state form khi chuyển view (hiện `StudioAccordion` mount một lần rồi `hidden`), nên dùng `hidden` thay vì unmount.
- **A3**: đổi nhãn thành "Làm mới" (`common:refresh`) và giữ trạng thái poll ("● 2 đang chạy · cập nhật 10s trước") ngay cạnh.
- **A4**: chuyển khung chọn dự án lên trên tab và làm nổi bật. Khi chưa chọn thì hiện **empty state có danh sách dự án gần đây** (hook `useRecentProjects` đã có) để bấm chọn nhanh. Tự chọn khi workspace chỉ có 1 dự án.
- **A5**: lọc, tìm kiếm và sắp xếp **client-side** trên mảng `jobs` + `assetMap`. Lưu filter vào query param (`?status=FAILED`) để chia sẻ link. Chip đếm theo `job.status` / `isActiveMediaJobStatus`. Tăng `PAGE_SIZE` lên 10 hoặc 20 và cho chọn kích thước trang.
- **A6**:
  - Thêm nhãn chữ cho hành động chính (ví dụ "▶ Xem", "Chạy lại"). Các hành động phụ gom vào menu "⋯".
  - Chạy lại mở `Modal` xác nhận, **ghi rõ stage sẽ chạy lại** (chính stage mà `handleRerun` đang tự chọn) và gợi ý "mở chi tiết để chọn stage khác" (có sẵn `StageRerunDropdown` ở trang chi tiết).
  - Lỗi tải hoặc chạy lại hiển thị bằng toast hoặc banner thay vì `console.error`.
  - Dòng lỗi có viền hoặc nền nhẹ màu đỏ. Dòng đang chạy giữ progress bar.
- **A7**: chuyển view dùng `replace: true`.
- **A8**: đổi dự án bằng `setSearchParams(prev => …)` để giữ các param khác.
- **A9**: chuyển toàn bộ chuỗi hard-code sang `locales/{vi,en}/media.json`.

### 2.2. Form "Tạo video mới": wizard theo luồng tự nhiên

Giữ nguyên toàn bộ state và logic submit trong `UploadConsentPanel`, chỉ **sắp xếp lại phần trình bày**:

```
Stepper:  ① Tải video  →  ② Xác nhận quyền  →  ③ Cấu hình  →  ④ Xem lại & Tạo
```

1. **Tải video**: dropzone và danh sách file (giữ logic `StagedVideo`, upload song song).
2. **Xác nhận quyền**: consent box. Sau khi xác nhận thì tự chuyển sang bước 3. Nếu bước 3 chưa mở được thì hiện lý do bằng chữ ("Cần xác nhận quyền sử dụng video trước"), thay vì làm xám cả form.
3. **Cấu hình**, đưa **preset lên đầu** (B2):
   - "Bắt đầu từ preset" (`WorkflowPresetPicker`, có thể nâng cấp thành danh sách card chọn nhanh, mặc định là preset `isDefault`).
   - Công thức xử lý (`RecipeSelector`) và VLM.
   - Ngôn ngữ nguồn → đích, giọng đọc.
   - "Tùy chọn nâng cao" gập lại: chế độ thực thi Manual/Auto, thời lượng, audio mode. Khi preset đã quy định giá trị thì hiện nhãn "theo preset" và cảnh báo override (đã có `modeOverrideNote`).
4. **Xem lại & Tạo**: dùng lại `media-create-summary-strip` làm **thanh tóm tắt dính đáy** (sticky), có nút Tạo ở mọi bước (B4).

Thêm:
- **B3**: khi cửa sổ lấy lại focus, gọi `queryClient.invalidateQueries` cho key workflow presets (sự kiện `focus` hoặc `visibilitychange` trong picker), và thêm nút "⟳" nhỏ cạnh picker. Chỉ là refetch GET đã có, không đụng BE.
- **B5**: sau khi tạo xong, thay đếm ngược bằng một hộp kết quả: "Đã tạo N job" với các nút [Xem job] [Tạo tiếp] [Về danh sách].
- Nhận tham số `?preset=<id>` trên URL `#upload` để điền sẵn preset (dùng cho C7). `WorkflowPresetPicker` đã tự kiểm tra id không hợp lệ (fail-closed).

### 2.3. Tab "Preset quy trình"

```
┌ Preset quy trình ───────────────────────────────────────── [+ Tạo preset] ┐
│ [ Dự án video ] [ Preset quy trình ]                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ ℹ Preset là bộ cấu hình dùng lại khi tạo video (1 dòng, có "Tìm hiểu thêm") │
│ [🔍 Tìm preset] [Phạm vi: Tất cả|Workspace|Dự án|Hệ thống] [Dự án ▼] [☐ Ẩn preset tắt] │
├─────────────────────────────────────────────────────────────────────────────┤
│ ★ Mặc định đang áp dụng: "Preset A" (Workspace)                             │
│ ┌ card ─────────────┐ ┌ card ─────────────┐ ┌ card ─────────────┐          │
│ │ Tên   [Workspace] │ │ …                 │ │ …                 │          │
│ │ Auto · Hard sub   │ │                   │ │                   │          │
│ │ 16:9 · Giọng: X   │ │                   │ │                   │          │
│ │ [Dùng] [Sửa] [⋯]  │ │                   │ │                   │          │
│ └───────────────────┘ └───────────────────┘ └───────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **C1**: đặt tiêu đề trang là "Preset quy trình" và rút gọn banner, có thể thu gọn.
- **C2/C3**: gộp 3 khối thành **một lưới có bộ lọc phạm vi** (segmented control), ô tìm kiếm theo tên/mô tả và công tắc ẩn preset đang tắt. Tất cả lọc client-side trên `presets`. Khi chưa chọn dự án mà chọn phạm vi "Dự án" thì hiện gợi ý chọn dự án ngay tại chỗ. Nhớ dự án đang chọn ở tab "Dự án video" (đọc `?project=`) để hai tab đồng bộ.
- **C4 Nhân bản**: menu "⋯" → "Nhân bản" mở `PresetFormModal` ở chế độ tạo mới với `hydrateForm(preset)`, tên "… (bản sao)", `scope = WORKSPACE`, `isDefault = false`. Khi lưu thì gọi **`createWorkflowPresetApi` có sẵn**. Áp dụng được cho cả preset SYSTEM.
- **C5**: menu "⋯" → "Đặt làm mặc định" / "Bật/Tắt", gọi **`updateWorkflowPresetApi` có sẵn** với body dựng từ `buildConfig(hydrateForm(preset))` kèm cờ mới. Cần kiểm tra body gửi đi giống hệt khi lưu từ modal. Lỗi xung đột mặc định dùng lại message `workflowPresetAdmin.defaultConflict`.
- **C6**: theo dõi trạng thái "dirty" (so sánh `form` với giá trị ban đầu). Khi đóng lúc dirty thì hỏi "Bỏ thay đổi?". Cho modal cỡ `xl` hoặc toàn màn hình. Khung preview dính (sticky) bên phải, và trên mobile thì chuyển xuống dưới.
- **C7**: nút "Dùng preset" chuyển tới `/w/:ws/media?project=<id>&preset=<presetId>#upload`. Với preset PROJECT thì lấy `projectId` của preset.
- **C8**: card hiển thị thống nhất 4 dòng thông tin (Mode · Subtitle · Tỉ lệ · Giọng), badge phạm vi và badge ★ Mặc định. Preset đang tắt thì làm mờ.

---

## 3. Lộ trình triển khai

Mỗi phase là 1 PR nhỏ, test xanh, có thể release độc lập.

### Phase 1: Quick wins, rủi ro thấp (khoảng 1–2 ngày)
- [ ] A3 Đổi nhãn nút làm mới. A7 `replace: true`. A8 giữ query param khi đổi dự án.
- [ ] A6 Modal xác nhận chạy lại kèm tên stage, toast/banner báo lỗi thay `console.error`.
- [ ] A9 Chuyển chuỗi hard-code trong `MediaListPage` sang i18n.
- [ ] C1 Tiêu đề trang preset. B3 refetch preset khi focus và nút ⟳.

### Phase 2: Danh sách job (khoảng 2 ngày)
- [ ] A1/A2 Thay accordion bằng 2 view `#overview` / `#upload` (giữ state form bằng `hidden`).
- [ ] A4 Khung chọn dự án nổi bật, empty state dùng dự án gần đây, tự chọn khi chỉ có 1 dự án.
- [ ] A5 Thanh tìm kiếm, lọc, chip đếm và sắp xếp (client-side, lưu vào query param).
- [ ] Tách `JobsTable` ra `components/media-studio/JobsTable.tsx`, và tách phần lọc ra `lib/media/jobFilters.ts` kèm unit test.

### Phase 3: Wizard tạo video (khoảng 3–4 ngày, rủi ro trung bình)
- [ ] Tách `UploadConsentPanel` thành các phần trình bày: `UploadStep`, `ConsentStep`, `ConfigStep`, `CreateSummaryBar`. **State và hàm submit vẫn ở component cha.**
- [ ] B1 Stepper và lý do disable bằng chữ. B2 đưa preset lên đầu, gập "Nâng cao". B4 thanh tóm tắt sticky.
- [ ] B5 Hộp kết quả sau khi tạo. Hỗ trợ `?preset=` để điền sẵn.
- [ ] A9 Chuyển 40+ chuỗi hard-code còn lại sang i18n.

### Phase 4: Trang preset (khoảng 2–3 ngày)
- [ ] C2/C3 Lưới hợp nhất, lọc phạm vi, tìm kiếm, ẩn preset tắt, đồng bộ dự án với `?project=`.
- [ ] C4 Nhân bản. C5 Đặt mặc định / Bật-Tắt nhanh (dùng lại `buildConfig`).
- [ ] C6 Cảnh báo khi còn thay đổi chưa lưu, modal lớn hơn, preview sticky.
- [ ] C7 "Dùng preset". C8 Chuẩn hóa `PresetCard`.

### Phase 5 (tùy chọn): Mobile
- `mobile/pages/media/MobileMediaListPage.tsx` và `MobilePresetSettingsPage` áp dụng cùng bộ lọc (dùng chung `lib/media/jobFilters.ts`) và hành động "Nhân bản" / "Dùng preset".

---

## 4. File dự kiến thay đổi

| File | Loại thay đổi |
|---|---|
| `frontend/src/pages/media/MediaListPage.tsx` | Bố cục view, bộ lọc, khung chọn dự án |
| `frontend/src/components/media-studio/JobsTable.tsx` *(mới, tách ra)* | Bảng job, hành động, xác nhận chạy lại |
| `frontend/src/lib/media/jobFilters.ts` *(mới)* + test | Hàm lọc, tìm kiếm, sắp xếp thuần |
| `frontend/src/components/media-studio/UploadConsentPanel.tsx` (+ các step con) | Sắp xếp lại trình bày, không đổi payload |
| `frontend/src/components/media-studio/WorkflowPresetPicker.tsx` | Refetch khi focus, nhận preset điền sẵn |
| `frontend/src/components/media-studio/StudioAccordion.tsx` | Giữ nguyên (trang chi tiết job `MediaJobPage` vẫn dùng) |
| `frontend/src/pages/settings/PresetSettingsPage.tsx` | Lưới và bộ lọc, nhân bản, thao tác nhanh, cảnh báo dirty |
| `frontend/src/pages/media/media-studio.css` | Style mới (sticky bar, chip lọc, stepper) |
| `frontend/src/locales/{vi,en}/media.json`, `common.json` | Key i18n mới |

**Không đụng tới:** `src/api/*`, `lib/media/batchJobPayload.ts`, `lib/transformationCapabilities.ts`, `types/*` (chỉ thêm type UI nếu cần), `backend-*`.

---

## 5. Kiểm thử và tiêu chí chấp nhận

- `npm run test` (Vitest) xanh cho toàn bộ test hiện có. Test nào bị ảnh hưởng do đổi cấu trúc DOM (ví dụ `studio-accordion` trên trang hub) thì cập nhật selector, **không sửa assertion về payload API**.
- Test mới:
  - `jobFilters.test.ts`: lọc theo trạng thái, ngôn ngữ, từ khóa; sắp xếp.
  - Tạo job từ wizard: body gửi `createTransformationJobApi` **khớp snapshot** với luồng cũ (cùng input thì cùng body).
  - Nhân bản preset gọi `createWorkflowPresetApi` với config bằng `buildConfig(hydrateForm(src))`, scope WORKSPACE.
  - Đặt mặc định gọi `updateWorkflowPresetApi`, body chỉ khác trường `isDefault`.
- Kiểm tra thủ công trên `http://localhost:5173/w/<ws>/media?project=<id>#overview`:
  - Link cũ `#overview`, `#upload`, `?projectId=` vẫn đúng. Nút Back của trình duyệt hoạt động bình thường.
  - Chuyển qua lại giữa danh sách và form không mất file đã upload hay cấu hình đang nhập.
  - Hiển thị đúng ở light/dark mode, desktop và mobile, cả tiếng Việt lẫn tiếng Anh.
- Trong Network tab: **không xuất hiện request mới** ngoài các endpoint đã liệt kê ở mục 0.

---

## 6. Rủi ro và cách giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Refactor `UploadConsentPanel` (1.870 dòng) làm lệch payload | Chỉ tách JSX thành component con nhận props. Thêm test snapshot body trước khi refactor (Phase 3 bước 0). |
| Thao tác nhanh ở C5 gửi thiếu field khi PUT | Luôn dựng body từ `buildConfig(hydrateForm(preset))`, giống modal. Có test so sánh body. |
| Bộ lọc client-side chậm khi nhiều job | Dùng `useMemo`. Số job theo dự án hiện đã tải hết về FE nên không phát sinh thêm tải. |
| Người dùng quen accordion cũ | Giữ nguyên hash URL. Nút "+ Tạo video mới" giữ vị trí cũ. |
