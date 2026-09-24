# Thay đổi giao diện Media Studio (FE only)

- **Branch:** `develop-update-ui-workpreset`
- **So với:** `b9d501f` (feat(PresetSettingsPage): add tab navigation…)
- **Ngày:** 2026-09-24
- **Phạm vi:** chỉ **Frontend**. **Không đổi Backend** (`backend-main`, `backend-ai`, `backend-media-worker` không có file nào thay đổi), **không đổi API contract**, **không đổi database / migration**.

Tài liệu này để người merge biết cái gì đã đổi, ở đâu, và nếu merge lỗi thì sửa theo hướng nào.

---

## 1. Tóm tắt nhanh

| Khu vực | Màn hình | Thay đổi chính |
|---|---|---|
| Danh sách job | Media Studio → tab *Media job* | Thanh lọc mới, bỏ dropdown trạng thái, nút xem video **Gốc / Sau**, khung chọn dự án kiểu tiêu đề, nút Làm mới / Tạo job chuyển vào khung dự án |
| Form tạo job | Media Studio → *Media Job mới* | Form chia 4 bước dạng câu hỏi, trạng thái ✓/⚠ từng bước, chọn *Lồng tiếng AI / Giữ giọng gốc*, tuỳ chọn nâng cao thu gọn, thanh "Còn N việc" |
| Preset quy trình | Media Studio → tab *Preset quy trình* | 3 cột dọc (Workspace / Dự án / Hệ thống), tìm kiếm chung, ghim ☆, nút "+ Thêm" từng cột, bộ lọc dự án lên thanh tìm kiếm |
| Form tạo/sửa preset | Popup *Tạo preset quy trình* | Viết lại chữ, thẻ chọn phạm vi / cách chạy, tỷ lệ khung ở tab Chung, xem trước chỉ ở tab Phụ đề / Che phủ, popup cố định kích thước, tab không bị đè khi cuộn |
| Sửa lỗi | Nhiều nơi | Nút hiện chữ thô `cancel` / `save` → **Hủy** / **Lưu** |

---

## 2. Backend

**Không có thay đổi.** Tất cả endpoint FE gọi đều đã có sẵn:

| Chức năng mới ở FE | Endpoint dùng (đã có) | Ghi chú |
|---|---|---|
| Xem **video gốc** trong bảng job | `GET /workspaces/{ws}/media/jobs/{jobId}/render-config` → `sourceVideoUrl` | BE trả URL cho mọi trạng thái job (`MediaRenderConfigServiceImpl.get`), `render_config` mặc định `'{}'` nên không lỗi với job thất bại sớm |
| Xem **video sau khi xử lý** | `GET /workspaces/{ws}/media/jobs/{jobId}/export?format=VIDEO` | Như trước, chỉ cho job `COMPLETED` |
| Tạo preset với phạm vi điền sẵn | `POST .../workflow-presets` | Body không đổi |

> Nếu sau này BE đổi `render-config` (ví dụ chặn theo trạng thái job) thì nút **Gốc** trong bảng job sẽ báo lỗi — xem `JobsTable.tsx` → `loadPreview`.

**Ghim preset** chỉ lưu ở trình duyệt (`localStorage`), **không** có API. Key: `transflow.presetPins.<workspaceId>`.

---

## 3. Frontend — chi tiết theo file

### 3.1 File mới

| File | Mục đích |
|---|---|
| `frontend/src/components/media-studio/JobsTable.tsx` (+ `.test.tsx`) | Bảng job tách khỏi `MediaListPage`: thanh lọc, chip trạng thái, phân trang, modal xem video Gốc/Sau, chạy lại |
| `frontend/src/lib/media/jobFilters.ts` (+ `.test.ts`) | Lọc / sắp xếp / đếm job (thuần hàm) |
| `frontend/src/lib/media/presetPins.ts` (+ `.test.ts`) | Hook `usePinnedPresets` (localStorage), `foldSearchText` (bỏ dấu tiếng Việt), `visiblePresets` (lọc + đưa preset đã ghim lên đầu) |
| `docs/UI_UX_Plan_Media_Studio.md` | Kế hoạch UI/UX |

### 3.2 Danh sách job — `MediaListPage.tsx`, `JobsTable.tsx`

- **Khung chọn dự án** (dưới thanh tab): tên dự án chính là `<select>` (class `media-project-switcher`), kèm nhãn `Nguồn: EN` / `Domain`. Chưa chọn → "Chọn dự án ▾" + gợi ý.
- **Nút ⟳ Làm mới / + Media Job mới** chuyển từ header vào khung dự án; chỉ hiện khi **đã chọn dự án và đang ở màn danh sách**. testid: `media-refresh`, `media-new-job`.
- Hàm dùng chung `pickProject(id)` cho việc chọn dự án (cập nhật URL `?project=` + hash `#overview`).
- **Thanh lọc** (class `jobs-filter*`): tìm kiếm, ngôn ngữ, chế độ, sắp xếp. **Đã bỏ dropdown "Tất cả trạng thái"** — lọc trạng thái bằng chip (Tất cả / Đang chạy / Cần duyệt / Lỗi / Xong). URL `?status=` vẫn hoạt động.
- Chip có `aria-label` dạng `"Lỗi (1)"` (test tìm bằng `getByRole('button', { name: 'Lỗi (1)' })`).
- **Cột Hành động**: nhóm nút **Gốc | Sau** (class `job-preview-pair`).
  - `preview-source-{jobId}`: luôn bấm được.
  - `preview-job-{jobId}`: chỉ bấm được khi `COMPLETED` (trước đây nút này **ẩn** với job chưa xong, giờ **hiện nhưng disabled**).
  - Modal xem video có 2 tab `preview-tab-source` / `preview-tab-output`, URL được cache khi chuyển tab.

### 3.3 Form tạo job — `UploadConsentPanel.tsx`, `VoiceSelector.tsx`, `RecipeSelector.tsx`

- Thân form dựng lại thành 4 bước, header mỗi bước là component nội bộ `ConfigStepHeader` (testid `create-step-status-{1..4}`):
  1. *Bạn muốn làm gì với video?* — công thức + thời lượng (thời lượng chuyển vào bước này).
  2. *Ngôn ngữ*.
  3. *Âm thanh & giọng đọc* — `id="create-step-audio"`.
  4. *Cách chạy* — thẻ Tự động / Thủ công (`media-workflow-card`), preset picker khi Tự động.
  - *Tuỳ chọn nâng cao* (thu gọn): chế độ xử lý audio.
- Biến mới `voiceBlocked`, `readinessTodos` → dòng "Còn N việc trước khi tạo job" ở footer (testid `create-readiness`), bấm để cuộn tới chỗ cần sửa. **Điều kiện disable nút Tạo job KHÔNG đổi.**
- `VoiceSelector` (khi `allowOriginal`):
  - Lựa chọn **Lồng tiếng AI / Giữ giọng gốc** chuyển thành **radio** ở đầu (`voice-use-tts`, `voice-keep-original`). **Trước đây `voice-keep-original` là checkbox.**
  - Chọn giữ giọng gốc → **ẩn** (không chỉ disable) ô nhà cung cấp / giọng / nghe thử.
  - Chuyển lại AI với `autoSelect` → tự chọn nhà cung cấp đầu tiên.
  - Không có giọng phù hợp → khung cảnh báo `voice-no-compatible` có nút *Đổi nhà cung cấp* / *Dùng giọng gốc* (`voice-callout-original`).
- `RecipeSelector`: bỏ badge cứng "Toàn bộ" / "AI Tóm tắt".
- Test `workflow-mode-seg`: textContent giờ lấy từ `.media-workflow-card__title` (thẻ có thêm mô tả).

### 3.4 Preset quy trình — `PresetSettingsPage.tsx`

- Trang: 3 cột dọc (component nội bộ `PresetColumn`, testid `preset-column-{workspace|project|system}`), cao bằng nhau (CSS `subgrid`).
- Thanh công cụ (dùng lại class `jobs-filter*`): tìm kiếm chung, lọc dự án (`aria-label = workflowPresetAdmin.projectFilter`), chip **Đã ghim** (`preset-pinned-only`), nút **+ Tạo preset** (`preset-create-btn`, đã chuyển từ header xuống đây).
- Nút **+ Thêm** đầu cột Workspace / Dự án (`preset-add-workspace`, `preset-add-project`) mở form với phạm vi (và dự án đang lọc) điền sẵn. Cột Hệ thống không có.
- Card preset: nút ghim ☆ (`preset-pin-{id}`); preset mặc định hiển thị nhãn chữ "mặc định" (**không còn icon ★ vàng** để tránh nhầm với ghim); bỏ dòng tên phạm vi trong card.
- **Form tạo/sửa preset (`PresetFormModal`)**:
  - Props mới: `initialScope`, `initialProjectId` (chỉ khi tạo mới).
  - Hook tạo preset giờ nhận `projectId` từ form để invalidate đúng danh sách theo dự án (sửa lỗi danh sách không tự làm mới khi tạo preset phạm vi Dự án).
  - Tab Chung: Tên (*), Mô tả, **Áp dụng cho** (radio `preset-scope`), **Cách chạy job** (radio `preset-workflow-mode`), **Khung hình video xuất ra** (`preset-aspect-option-{ORIGINAL|16x9|9x16|4x3|1x1}`), 2 checkbox với chữ mới.
  - **Trước đây** Phạm vi và Quy trình là `<select>` → **giờ là radio**.
  - Khung xem trước **chỉ hiện ở tab Phụ đề / Che phủ**; tỷ lệ chỉ đọc (`preset-preview-aspect-label`). Nút tải media canh chỉnh → "Dùng video mẫu" nằm ở đầu khung xem trước (testid giữ nguyên `preset-calibration-input` / `-remove`).
  - Chấm đỏ báo lỗi trên tab chỉ hiện **sau khi bấm Lưu**.
  - Popup cố định kích thước (class `preset-form-modal`), thanh tab đứng yên, nội dung tab cuộn trong `preset-form-scroll`, cột xem trước cuộn riêng (`preset-form-preview`). **Không sửa `components/shared/Modal.tsx`.**

### 3.5 `SubtitlePreviewFrame.tsx`

- Prop mới (tuỳ chọn, mặc định giữ hành vi cũ):
  - `showAspectSelector?: boolean` (mặc định `true`) — `false` thì ẩn bộ chọn tỷ lệ, hiện nhãn chỉ đọc.
  - `headerExtra?: ReactNode` — chèn nút vào header khung xem trước.

### 3.6 Sửa lỗi key i18n

`t('common:cancel')` / `t('common:save')` không tồn tại (key thật nằm trong `common.actions`) → hiện chữ thô. Đã đổi sang `common:actions.cancel` / `common:actions.save` ở:
`PresetSettingsPage.tsx`, `RenderPreparationPanel.tsx`, `MediaJobPage.tsx`.

### 3.7 Khác

- `WorkflowPresetPicker.tsx`: tự refetch preset khi cửa sổ được focus lại + nút làm mới (`preset-refresh-btn`).

---

## 4. i18n (`locales/vi|en/media.json`, `common.json`)

Chỉ **thêm key** hoặc **đổi nội dung chữ**, không xoá key đang dùng. Nhóm key mới / đổi:

| Nhóm | Key |
|---|---|
| `media.createForm.*` (mới) | `step1Title…step4Desc`, `stepDone`, `stepTodo`, `keepDuration`, `autoDesc`, `manualDesc`, `advancedTitle`, `advancedHint`, `audioModeLabel`, `remaining_one/_other`, `ready`, `todoConsent`, `todoVoice`, `voiceNotSet`, `voiceFromPreset` |
| `media.voice.*` | mới: `sourceLabel`, `modeTts`, `modeTtsHint`, `noCompatTitle`, `changeProvider`, `useOriginal` · đổi chữ: `originalHint`, `emptyCompat` |
| `media.actions.*` | `previewSource`, `previewSourceShort`, `previewOutput`, `previewOutputShort`, `previewOutputUnavailable` |
| `media.workflowPresetAdmin.*` | mới: `scope*Hint`, `searchPlaceholder`, `pinnedOnly`, `pin`, `unpin`, `noMatch`, `addToColumn`, `namePlaceholder`, `descriptionPlaceholder`, `scopeLegend`, `systemScopeNote`, `workflowLegend`, `aspectLegend`, `aspectKeep`, `aspectNote`, `activeHint`, `isDefaultHintWorkspace`, `isDefaultHintProject`, `thisProject` · đổi chữ: `formHint`, `active`, `isDefault`, `projectFilter`, `projectFilterHint`, `uploadCalibration`, `calibrationNote` |
| `media.*` (gốc) | `projectSourceShort` |
| `media.filter.*` | các key thanh lọc bảng job (search, chip, sort…) |

> Key `media.selectProjectHint` không còn được dùng (chưa xoá).

---

## 5. CSS — `frontend/src/pages/media/media-studio.css`

Chỉ **thêm block mới ở cuối file** + **thay block `.media-project-picker*`** (khung chọn dự án). Prefix class mới:
`jobs-filter*`, `job-preview-*`, `media-step-*`, `media-keep-duration-note`, `audio-source-*`, `voice-callout*`, `media-workflow-card*`, `media-advanced-*`, `media-readiness*`, `media-project-switcher*`, `media-project-tag*`, `preset-intro*`, `preset-columns`, `preset-column*`, `preset-pin`, `preset-default-badge`, `preset-toolbar-create`, `preset-choice*`, `preset-aspect-option*`, `preset-toggle*`, `preset-field*`, `preset-form-*`.

Lưu ý kỹ thuật: `styles/forms.css` **không nằm trong CSS layer** nên đè các utility Tailwind v4 (`w-auto`, `pl-8`, `py-1.5`…) trên `.field-input`. Vì vậy các control mới dùng class riêng thay vì `field-input` + Tailwind.

---

## 6. Test

- Chạy: `cd frontend && npx vitest run src/pages/settings src/pages/media src/components/media-studio src/lib/media` → **529 test pass** tại thời điểm viết.
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json` sạch, **trừ** lỗi có sẵn trong fixture `jobFilters.test.ts` / `JobsTable.test.tsx` (`'LOCALIZATION'` không thuộc `ProcessingMode`, thiếu `stages`) — không phải do thay đổi UI.
- Test đã **sửa theo UI mới** (nếu nhánh khác cũng sửa các test này sẽ dễ conflict):
  - `VoiceSelector.preview.interaction.test.tsx` — keep-original là radio, control bị ẩn.
  - `UploadConsentPanel.workflowC2.interaction.test.tsx` — đọc `.media-workflow-card__title`.
  - `MediaListPage.test.tsx` — nút Gốc/Sau, mock `getTransformationRenderConfigApi`.
  - `PresetSettingsPage.test.tsx` — radio phạm vi/quy trình, tỷ lệ ở tab Chung, xem trước ở tab Phụ đề, `common:actions.cancel`, test tìm kiếm/ghim/"+ Thêm", test popup cố định.

---

## 7. Khi merge bị conflict / lỗi — hướng xử lý

| Triệu chứng | Nguyên nhân khả dĩ | Cách sửa |
|---|---|---|
| Conflict lớn ở `UploadConsentPanel.tsx` | Thân form (≈ dòng 1050–1650) đã dựng lại thành 4 bước | Giữ cấu trúc mới; chép **logic** của nhánh kia (state, điều kiện) vào đúng bước tương ứng. Không đổi điều kiện `disabled` của nút `create-submit` |
| Conflict ở `media-studio.css` | Cả hai nhánh thêm CSS cuối file | Giữ **cả hai** block. Riêng `.media-project-picker*`: giữ bản mới |
| Conflict ở `media.json` | Cả hai nhánh thêm key | Gộp cả hai; kiểm tra JSON hợp lệ (`node -e "require('./src/locales/vi/media.json')"`). File dùng **CRLF**, indent 2 |
| Test tìm `voice-keep-original` như checkbox / `getByLabelText('media:workflowPresetAdmin.scope')` / `media:workflow.modeLabel` fail | UI đổi sang radio | Dùng `getByRole('radio', { name: /…/ })` hoặc `fireEvent.click` (vẫn chạy với radio) |
| Test tìm `preset-preview-aspect-*` / `preset-preview-frame` ở tab Chung fail | Xem trước chỉ ở tab Phụ đề/Che phủ; tỷ lệ chuyển sang `preset-aspect-option-*` | Click `preset-form-tab-subtitle` trước, hoặc dùng testid mới |
| Test đợi `preview-job-{id}` **không tồn tại** với job FAILED fail | Nút giờ hiện nhưng `disabled` | Kiểm tra `.disabled === true` |
| Test tìm dropdown trạng thái trong bảng job fail | Đã bỏ, dùng chip | Click chip `getByRole('button', { name: 'Lỗi (1)' })` |
| Nút hiện `cancel`/`save` ở màn khác | Key sai `common:cancel` | Đổi thành `common:actions.cancel` / `common:actions.save` |
| Code nhánh khác dùng `SubtitlePreviewFrame` | Prop mới đều tuỳ chọn | Không cần sửa |
| Nút **Gốc** báo lỗi | `render-config` không trả `sourceVideoUrl` | Kiểm tra BE `MediaRenderConfigServiceImpl.sourceVideoUrl` / quyền storage |

---

## 8. Giới hạn đã biết

- Ghim preset chỉ lưu trên trình duyệt hiện tại (không đồng bộ tài khoản/thiết bị).
- `field-sizing: content` (co giãn dropdown dự án) chỉ có trên Chrome/Edge 123+; trình duyệt khác rộng theo tên dài nhất (tối đa 420px).
- `subgrid` (canh tiêu đề 3 cột preset): Chrome/Edge 117+, Firefox 71+, Safari 16+.
- Link video Gốc/Sau là presigned URL, hết hạn theo `presignedTtlSeconds` — mở lại modal để lấy link mới.
- Trang preset bản mobile (`mobile/pages/settings/MobilePresetSettingsPage.tsx`) **chưa** cập nhật theo giao diện mới.
- Tên nhà cung cấp TTS (ví dụ `tts-1`) lấy từ cấu hình workspace, FE không đổi.
