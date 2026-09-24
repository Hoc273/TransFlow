# Tính toán Hệ số Credit (x, y) — TransFlow Media Studio

> **Trạng thái:** DRAFT — chờ chốt các mục ở [§8](#8-danh-sách-việc-cần-chốt).
> **Ngày:** 2026-09-24
> **Nguồn:** `docs/Khung_Tinh_Toan_He_So_Credit.docx`, SRS §5.6 & §7.2, System_Architecture §10, Database_Design (`credit_pricing_config`), code `backend-main` hiện tại.
> **Lưu ý:** Mọi con số giá thị trường trong tài liệu này là **giá tham chiếu cần tra lại** tại thời điểm chốt; mọi con số hạ tầng là **giả định** do Product cung cấp.

---

## 1. Bối cảnh

Theo SRS §5.6 / Architecture §10.2, Credit tiêu tốn cho mỗi thao tác AI:

| Trường hợp | Điều kiện (của người **trực tiếp thực hiện**) | Công thức |
|---|---|---|
| 1 | Có API key cá nhân (BYOK) | `Credit = x × units` |
| 2 | Không có API key cá nhân (dùng nguồn nền tảng) | `Credit = (x + y) × units` |

- **x** — hệ số phí hạ tầng vận hành, áp dụng **mọi** trường hợp.
- **y** — hệ số quy đổi chi phí AI (token/giây/ký tự) sang Credit, **chỉ** áp dụng Trường hợp 2.
- x, y là cấu hình runtime trong bảng `credit_pricing_config` (theo `capability` + `provider_scope`), không hard-code.

---

## 2. Các quyết định đã chốt

| # | Quyết định | Giá trị chốt |
|---|---|---|
| D1 | Tỷ giá gốc P (VNĐ → Credit) | **1 Credit = 100 VNĐ** (neo theo gói Starter: 500 Credit = 50.000đ) |
| D2 | Đơn vị tính (`units`) | **Mỗi capability có đơn vị riêng** (không phải token LLM ở mọi nơi) — xem §3 |
| D3 | Phương án cho y khi provider đang free | **Phương án B — Shadow price** (giá thị trường tham chiếu × biên lợi nhuận) |
| D4 | Giả định hạ tầng & sản lượng (ví dụ) | **100 USD/tháng** hạ tầng, **10.000 phút video/tháng** |

> Hệ quả của D1: x, y là **Credit / đơn vị**, không phải hệ số vô hướng như Mục 4 của file docx (cách "x_ref + y_ref = 1" bị loại bỏ vì cho ra 1 Credit ≈ 0,01–0,4đ, không khớp với gói Credit đang bán).

---

## 3. Đơn vị tính theo capability (D2)

| Capability | Đơn vị (`billing_unit`) | Nguồn số liệu trong pipeline |
|---|---|---|
| `STT` | giây audio (`AUDIO_SECOND`) | `usage.audio_seconds`, fallback thời lượng audio |
| `TRANSLATE` | token (`TOKEN`) | `usage.total_tokens` hoặc `input_tokens + output_tokens` |
| `TTS` | ký tự (`CHARACTER`) | `usage.characters` / tổng ký tự text đưa vào TTS |
| `SUMMARIZE_SCRIPT` | token (`TOKEN`) | `usage.total_tokens` |
| `VISION` | token (`TOKEN`) | `usage.total_tokens` (bao gồm image tokens) |
| `RENDER` | giây video (`VIDEO_SECOND`) | thời lượng video output (bao gồm SOURCE_SEPARATION + AUDIO_MIX — chờ chốt Q3) |

---

## 4. Công thức & giả định

### 4.1 Công thức

```
C_infra(cap)  = Infra_VND_tháng × Tỷ_lệ_phân_bổ(cap) ÷ Phút_video_tháng ÷ Units_mỗi_phút(cap)     [VNĐ/unit]
C_market(cap) = Giá_thị_trường_USD/unit × Tỷ_giá_USD                                               [VNĐ/unit]

x(cap) = C_infra(cap)  × (1 + margin_x) ÷ P                                                        [Credit/unit]
y(cap) = C_market(cap) × (1 + margin_y) ÷ P                                                        [Credit/unit]
```

### 4.2 Tham số đầu vào

| Tham số | Giá trị | Trạng thái |
|---|---|---|
| P | 100 VNĐ/Credit | ✅ Đã chốt |
| Tỷ giá | 26.000 VNĐ/USD | ⚠️ Giả định |
| Infra_VND_tháng | 100 USD = 2.600.000 VNĐ | ⚠️ Ví dụ (D4) |
| Phút_video_tháng | 10.000 phút | ⚠️ Ví dụ (D4) — xem rủi ro §6 |
| margin_x | 25% | ❓ Chờ chốt (Q5) |
| margin_y | 25% | ❓ Chờ chốt (Q5) |

### 4.3 Tỷ lệ phân bổ hạ tầng & units mỗi phút video

| Capability | Tỷ lệ phân bổ | Units / 1 phút video | Ghi chú |
|---|---|---|---|
| RENDER (+ Demucs + mix + storage + băng thông) | 60% | 60 giây | Nặng compute & storage nhất |
| STT | 10% | 60 giây | |
| TTS | 10% | ~900 ký tự | ~150 từ/phút |
| TRANSLATE | 8% | ~500 token | in + out + prompt/glossary |
| SUMMARIZE_SCRIPT | 6% | ~500 token | |
| VISION | 6% | ~1.000 token | keyframes |

> ❓ Tỷ lệ phân bổ và units/phút là **ước lượng** — chờ chốt (Q1).

### 4.4 Giá thị trường tham chiếu (shadow price cho y)

| Capability | Model tham chiếu | Giá niêm yết | Quy đổi |
|---|---|---|---|
| STT | OpenAI `whisper-1` | $0.006 / phút | 2,60 VNĐ/giây |
| TRANSLATE | `gpt-4o-mini` ($0.15 in / $0.60 out per 1M), tỷ lệ in:out = 1:1 | $0.375 / 1M token | 0,00975 VNĐ/token |
| TTS | OpenAI `tts-1` | $15 / 1M ký tự | 0,39 VNĐ/ký tự |
| SUMMARIZE_SCRIPT | `gpt-4o-mini`, in:out = 4:1 | $0.24 / 1M token | 0,00624 VNĐ/token |
| VISION | `gpt-4o-mini`, in:out = 9:1 | $0.195 / 1M token | 0,00507 VNĐ/token |
| RENDER | — (không dùng AI) | 0 | 0 |

> ⚠️ Cần đổi sang **đúng provider/model đang dùng thật** (DashScope Qwen / CosyVoice, Piper, Google…) và tra lại giá hiện hành — chờ chốt (Q2).

---

## 5. Kết quả tính x, y (Infra 100$/tháng, 10.000 phút/tháng)

### 5.1 Bảng hệ số

| Capability | Đơn vị | C_infra (VNĐ) | C_market (VNĐ) | **x** (Credit/unit) | **y** (Credit/unit) | x + y |
|---|---|---|---|---|---|---|
| STT | giây audio | 0,43333 | 2,60000 | **0.005417** | **0.032500** | 0.037917 |
| TRANSLATE | token | 0,04160 | 0,00975 | **0.000520** | **0.000122** | 0.000642 |
| TTS | ký tự | 0,02889 | 0,39000 | **0.000361** | **0.004875** | 0.005236 |
| SUMMARIZE_SCRIPT | token | 0,03120 | 0,00624 | **0.000390** | **0.000078** | 0.000468 |
| VISION | token | 0,01560 | 0,00507 | **0.000195** | **0.000063** | 0.000258 |
| RENDER | giây video | 2,60000 | 0 | **0.032500** | **0.000000** | 0.032500 |

### 5.2 Chi phí mẫu theo job

| Kịch bản | Units giả định | BYOK | Không BYOK | ≈ VNĐ (không BYOK) |
|---|---|---|---|---|
| 1 phút, dub | STT 60s, TRANSLATE 500, TTS 900, RENDER 60s | 2,9 | 9,3 | ~930đ |
| 10 phút, chỉ phụ đề | STT 600s, TRANSLATE 5.000, RENDER 600s | 25,4 | 45,5 | ~4.550đ |
| 10 phút, dub | + TTS 9.000 ký tự | 28,6 | 92,6 | ~9.260đ |
| 30 phút, dub (tối đa) | ×3 kịch bản trên | 85,8 | 277,8 | ~27.800đ |
| 10 phút, tóm tắt + VLM | STT 600s, SUMMARIZE 5.000, VISION 10.000, RENDER 600s | 26,6 | 47,2 | ~4.720đ |

**Nhận xét:**
- Gói Starter (500 Credit / 50.000đ) ≈ **5 video 10 phút có dub**.
- BYOK rẻ hơn ~3 lần (chênh lệch chủ yếu ở STT và TTS) → đủ động lực khuyến khích BYOK.
- Credit cấp ban đầu hiện tại **100** chỉ đủ ~1 video 10 phút dub → đề xuất nâng (Q4).

### 5.3 So sánh với seed hiện tại (`V2__init_indexes.sql`)

| | Seed hiện tại | Đề xuất |
|---|---|---|
| Video 10 phút dub, không BYOK | **8,6 Credit (~860đ)** | 92,6 Credit (~9.260đ) |
| Chi phí AI thực theo giá thị trường | ~5.100đ | ~5.100đ |
| Kết quả | **Lỗ ~6 lần** trên chi phí AI, chưa tính hạ tầng | Thu đủ AI + 25% margin + hạ tầng |

---

## 6. Đánh giá giả định 100$ / 10.000 phút

### 6.1 Hạ tầng 100$/tháng — ✅ Khả thi, có điều kiện

- **Compute:** 10.000 phút ≈ 167 giờ video. Demucs (CPU) ≈ realtime, FFmpeg render nhanh hơn realtime → tổng ~200–250 giờ máy / 720 giờ tháng. Một VPS 8 vCPU / 16GB (~50–90$) đáp ứng được với 1–2 worker song song.
- **Storage — điểm dễ vượt ngân sách:** mỗi video 10 phút sinh ~300–500MB (gốc + stems WAV + output). 1.000 job/tháng → 300–500GB/tháng.
  - Bắt buộc có **retention policy**: xoá stems/file trung gian sau 7–14 ngày.
  - Tránh AWS S3 egress; ưu tiên MinIO tự host / Hetzner / Cloudflare R2.

### 6.2 Sản lượng 10.000 phút — ⚠️ Rủi ro chính

x dùng 10.000 phút làm **mẫu số**. Hệ số hiện tại thu **~325đ hạ tầng / phút video**.

| Sản lượng thực tế / tháng | Chi phí hạ tầng thật / phút | Thu được / phút | Tỷ lệ bù |
|---|---|---|---|
| 1.000 phút | 2.600đ | 325đ | ~12,5% (lỗ ~8 lần) |
| 3.000 phút | 867đ | 325đ | ~37,5% |
| **8.000 phút** | 325đ | 325đ | **Hoà vốn** |
| 10.000 phút | 260đ | 325đ | 125% (đúng margin 25%) |

**Đề xuất:**
- Giữ 10.000 phút làm **mục tiêu** (giá thân thiện với user), nhưng **review x hàng tháng** theo sản lượng thực: insert row mới vào `credit_pricing_config` với `effective_from` mới, đóng row cũ bằng `effective_to` — không cần đổi code.
- Hoặc giai đoạn đầu tính x theo **3.000–5.000 phút** để an toàn → video 10 phút dub ≈ 100–160 Credit.

---

## 7. Các vấn đề phát hiện trong code hiện tại

| # | Vấn đề | Vị trí | Mức độ |
|---|---|---|---|
| I1 | Cùng một x, y nhưng `units` lẫn lộn: STT có lúc là token (nếu provider trả), có lúc là giây; TTS là ký tự; fallback STT chia `durationMs/1000` | `MediaStageExecutionService.usageUnits()` | 🔴 Cao |
| I2 | Seed x, y quá thấp → lỗ ~6 lần chi phí AI | `db/migration/V2__init_indexes.sql` | 🔴 Cao |
| I3 | **Không trừ credit** cho `RENDER`, `SOURCE_SEPARATION` (Demucs), `AUDIO_MIX` — các bước tốn tài nguyên nhất | `MediaStageExecutionService` (không có `chargeAiUsage(..., "RENDER", ...)`) | 🔴 Cao |
| I4 | `provider_scope` không được dùng: luôn gọi `findActivePricing(capability, null)` → không thể định giá y khác nhau theo provider | `CreditServiceImpl.chargeUsage()` | 🟠 Trung bình |
| I5 | Có giá trị x, y hard-code fallback (`DEFAULT_INFRA_X = 0.0001`, `DEFAULT_TOKEN_Y = 0.0005`) — trái nguyên tắc "không hard-code", và âm thầm tính sai khi thiếu config | `CreditServiceImpl` L31–32 | 🟠 Trung bình |
| I6 | Xác định BYOK theo `job.createdByUserId`, trong khi SRS quy định theo **người trực tiếp thực hiện** (khác nhau khi Lead rerun/confirm job của Member) | `MediaStageExecutionService.hasPersonalProvider()`, `chargeAiUsage()` | 🟠 Trung bình |
| I7 | Credit cấp ban đầu mặc định 100 — chỉ đủ ~1 video 10 phút dub | `AppProperties.Credit.initialGrantAmount` | 🟡 Thấp |
| I8 | Bảng `credit_pricing_config` chưa có cột đơn vị tính → không tự mô tả được x, y tính theo gì | `V1__init_tables.sql`, `Database_Design.md` | 🟡 Thấp |
| I9 | Trừ credit **sau** khi stage hoàn thành, không kiểm tra/giữ trước → số dư có thể âm hoặc user chạy job khi không đủ credit | `chargeAiUsage()` + SRS §7.2 #4 chưa chốt | 🟠 Trung bình |

---

## 8. Danh sách việc cần chốt

> Đánh dấu `[x]` và điền quyết định vào cột **Chốt** khi đã giải quyết.

### 8.1 Số liệu đầu vào

- [ ] **Q1 — Tỷ lệ phân bổ hạ tầng & units/phút video**
  - Hiện dùng: RENDER 60% / STT 10% / TTS 10% / TRANSLATE 8% / SUMMARIZE 6% / VISION 6%; units/phút như §4.3.
  - Đề xuất: giữ tạm, sau 1 tháng chạy thật đo lại bằng CPU-time từng stage.
  - **Chốt:** ______

- [ ] **Q2 — Provider/model tham chiếu cho y (shadow price)**
  - Hiện dùng giá OpenAI (`gpt-4o-mini`, `whisper-1`, `tts-1`). Seed `platform_ai_providers` đang trỏ `api.openai.com` — **không phải free**.
  - Cần: liệt kê chính xác provider nền tảng đang dùng cho từng capability (DashScope free quota? Piper local? Google free tier?) và tra giá niêm yết hiện hành.
  - **Chốt:** ______

- [ ] **Q3 — Tính phí RENDER / SOURCE_SEPARATION / AUDIO_MIX**
  - Đề xuất: **có**, chỉ tính x (y = 0), đơn vị giây video. Hai lựa chọn:
    - (a) Gộp SOURCE_SEPARATION + AUDIO_MIX vào `RENDER` (không đổi CHECK constraint).
    - (b) Thêm capability `AUDIO_PROCESS` riêng (phải sửa CHECK constraint + tài liệu).
  - **Chốt:** ______

- [ ] **Q4 — Số Credit cấp ban đầu**
  - Hiện: 100 (~1 video 10 phút dub). Đề xuất: **200–300**.
  - **Chốt:** ______

- [ ] **Q5 — Biên lợi nhuận**
  - Hiện dùng margin_x = margin_y = 25%. Có muốn margin_y khác (ví dụ thấp hơn để cạnh tranh, hoặc cao hơn để đẩy BYOK)?
  - **Chốt:** ______

- [ ] **Q6 — Sản lượng dùng để tính x giai đoạn đầu**
  - 10.000 phút (giá rẻ, rủi ro lỗ hạ tầng nếu sản lượng thấp) hay 3.000–5.000 phút (an toàn)?
  - Chu kỳ review x: hàng tháng?
  - **Chốt:** ______

### 8.2 Nghiệp vụ

- [ ] **Q7 — "Người trực tiếp thực hiện" là ai khi Lead rerun / confirm checkpoint job của Member?**
  - Theo SRS: người bấm hành động → BYOK xét theo người đó.
  - Đề xuất: stage do Auto pipeline chạy → người tạo job; stage chạy do rerun/confirm → người thao tác. Cần lưu `triggered_by_user_id` trên stage.
  - **Chốt:** ______

- [ ] **Q8 — Dùng `provider_scope` để y khác theo provider?**
  - Ví dụ ElevenLabs đắt gấp ~10 lần `tts-1`.
  - Đề xuất: **có** — resolver ưu tiên row khớp `provider_scope`, fallback row `NULL`.
  - **Chốt:** ______

- [ ] **Q9 — Khi không có `credit_pricing_config` cho capability**
  - Đề xuất: **chặn job** (lỗi cấu hình, mã lỗi dải 2300) thay vì dùng giá trị hard-code.
  - **Chốt:** ______

- [ ] **Q10 — Khi không đủ Credit (SRS §7.2 #4)**
  - Lựa chọn:
    - (a) Chặn ngay khi tạo job nếu số dư < ước tính.
    - (b) **Ước tính & giữ trước (pre-authorize)** khi tạo job, trừ thật sau khi stage hoàn thành, hoàn phần dư. ← Đề xuất
    - (c) Cho phép âm, chặn job tiếp theo.
  - **Chốt:** ______

- [ ] **Q11 — Làm tròn & mức tối thiểu**
  - Hiện: làm tròn 4 chữ số thập phân, tối thiểu 1 unit/lần tính. Có cần mức phí tối thiểu mỗi stage (ví dụ 0,1 Credit) không?
  - **Chốt:** ______

---

## 9. Kế hoạch triển khai sau khi chốt

1. **Tài liệu**
   - SRS §5.6: đổi "Số token đã dùng" → "Số đơn vị sử dụng (theo từng thao tác)", ghi bảng đơn vị §3; đóng mục §7.2 #2.
   - Database_Design: thêm cột `billing_unit` vào `credit_pricing_config`.
   - API_Contract: bổ sung mã lỗi thiếu pricing config (nếu chốt Q9).
2. **Migration mới** (không sửa V1/V2 đã chạy)
   - `ALTER TABLE credit_pricing_config ADD COLUMN billing_unit VARCHAR ...`
   - Đóng các row seed cũ (`effective_to = now()`), insert row mới với x, y ở §5.1.
3. **Code `backend-main`**
   - Chuẩn hoá `usageUnits()` theo `billing_unit` (fix I1).
   - Thêm charge cho RENDER (+ separation/mix theo Q3) (fix I3).
   - Resolver theo `provider_scope` (fix I4); bỏ hard-code fallback (fix I5).
   - BYOK theo người thực hiện (fix I6), pre-authorize credit (fix I9) — theo Q7, Q10.
4. **Test**: unit test cho `CreditServiceImpl.chargeUsage` với từng capability/đơn vị, BYOK vs non-BYOK, LEAD_PAYS_ALL vs PAY_PER_USER.
