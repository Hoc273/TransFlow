# Tính toán Hệ số Credit (x, y) — TransFlow Media Studio

> **Phiên bản:** v2.2 (thay thế v2.1, v2 và DRAFT v1 cùng ngày)
> **Trạng thái:** ĐỀ XUẤT — chờ chốt các mục ở [§12](#12-việc-còn-cần-chốt)
> **Ngày:** 2026-09-24
> **Đầu vào:** `Khung_Tinh_Toan_He_So_Credit.docx`, `Credit_Coefficient_Calculation.md` v1/v2/v2.1, `Credit_Pricing_Review.md`, SRS §5.6 & §7.2, System_Architecture §10, Database_Design (`credit_pricing_config`), code `backend-main` / `backend-ai` hiện tại.
> **Ký hiệu:** ✅ đã chốt · ⚠️ giả định cần kiểm chứng · ❓ cần quyết định · 🆕 điểm mới so với v1

---

## 0. Tóm tắt điều hành

| Câu hỏi | Kết luận v2.1 |
|---|---|
| Hướng tính x | **Theo tác nhân chi phí (cost driver)**, không chia % hạ tầng đều cho mọi capability. Hạ tầng tách **cố định** (thu qua STT theo thời lượng video nguồn) và **biến đổi** (thu ở đúng stage gây ra chi phí). 🆕 |
| Hướng tính y | **Shadow price theo provider/model thật** qua `provider_scope` (OpenAI `gpt-4o`, `gpt-4o-mini`, `whisper-1`, `tts-1`, `tts-1-hd`, Qwen…), markup **50%**. 🆕 |
| TTS | **Chỉ dùng TTS qua API.** Piper bị loại khỏi tính giá vì chỉ dùng local để test. Mặc định `tts-1`, cao cấp `tts-1-hd`. |
| Capability mới | **`AUDIO_SEPARATION`** (Demucs) tách khỏi RENDER — chỉ job `DUB_MIX` trả. 🆕 |
| Sản lượng tính x | **5.000 phút/tháng** (thận trọng), chỉ áp cho phần hạ tầng cố định, review hàng tháng. |
| Biên gộp tại sản lượng kế hoạch | **~17–22% mọi loại job** (v1: 4–14% và lệch nhau). Hoà vốn ở **~2.000–4.100 phút/tháng** (v1: ~9.400–10.300). |
| Giá hiển thị cho user | Phụ đề **~6,7 Credit/phút** · Lồng tiếng thay giọng **~12,6** · Lồng tiếng giữ nhạc nền **~13,4** · Giọng HD **~19,3** · Ngôn ngữ thứ 2 cùng video **~10,2**. |
| Gói Credit | Nâng gói Business từ 80đ lên **90đ/Credit** (hiện chỉ còn ~11% biên sau phí cổng). 🆕 |
| Credit khởi tạo | Giữ **100** cho tới khi có chống lạm dụng. |
| Ai sửa được x, y | **Super Admin** qua `/api/platform/pricing*`: tạo version mới (không ghi đè, không hồi tố), preview trước khi lưu, audit đầy đủ; job luôn tính theo giá tại thời điểm tạo job (§10). 🆕 |

---

## 1. Bối cảnh & công thức (không đổi)

Theo SRS §5.6 / Architecture §10.2, Credit cho mỗi thao tác AI:

| Trường hợp | Điều kiện (của người **trực tiếp thực hiện**) | Công thức |
|---|---|---|
| 1 | Có API key cá nhân (BYOK) | `Credit = x × units` |
| 2 | Không có API key cá nhân (nguồn nền tảng) | `Credit = (x + y) × units` |

- **x** — hệ số hạ tầng, áp dụng mọi trường hợp.
- **y** — hệ số chi phí AI của nhà cung cấp, chỉ Trường hợp 2.
- x, y là cấu hình runtime trong `credit_pricing_config`, khoá theo `capability` + `provider_scope`, có hiệu lực theo `effective_from` / `effective_to`.

> v2.1 **không đổi công thức SRS**, chỉ đổi cách **dựng số** x, y và bổ sung capability/đơn vị.

---

## 2. Quyết định đã chốt

| # | Quyết định | Giá trị | Nguồn |
|---|---|---|---|
| D1 | Tỷ giá gốc | ✅ **1 Credit = 100đ** (neo gói Starter) | Vòng 1 |
| D2 | Đơn vị tính | ✅ Mỗi capability có đơn vị riêng (§4.2) | Vòng 1 |
| D3 | y khi provider free | ✅ **Phương án B — shadow price** | Vòng 1 |
| D4 | Ngân sách hạ tầng ví dụ | ✅ **100 USD/tháng**, mục tiêu 10.000 phút/tháng | Vòng 1 |
| D5 | Piper TTS | ✅ **Không đưa vào tính giá** — chỉ dùng local để test, không phải provider nền tảng production | Vòng 3 |

Các đề xuất mới (cần chốt) được đánh số **P1–P8** ở §5.

---

## 3. Hiện trạng project liên quan đến giá 🆕

Rút từ code/migration hiện tại — là căn cứ để chọn hướng.

| Hạng mục | Hiện trạng | Nguồn |
|---|---|---|
| Provider nền tảng seed | 1 provider `openai_compatible` → `api.openai.com`, `default_model = gpt-4o`, capabilities `STT, TRANSLATE, TTS, VISION` — **có tính phí, không free** | `V2__init_indexes.sql` |
| Giọng TTS nền tảng seed | 8 giọng OpenAI (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`, `nova-vi`, `onyx-vi`) | `V2__init_indexes.sql` |
| Adapter AI Gateway hỗ trợ | OpenAI-compatible, Anthropic, DashScope (Qwen / Qwen-Omni), ElevenLabs, Google TTS, Azure TTS, Piper (local — **chỉ test**, D5) | `backend-ai/app/services/protocol/` |
| Tách âm | **Demucs local** (`htdemucs`, ưu tiên GPU, fallback CPU) — chạy khi `DUB_MIX` | `backend-ai/app/core/config.py` |
| Stage pipeline | `EXTRACT_AUDIO, SOURCE_SEPARATION, STT, SUMMARIZE, TRANSLATE, TTS, AUDIO_MIX, RENDER` | `MediaJobStage.StageName` |
| Stage đang trừ Credit | Chỉ STT, SUMMARIZE_SCRIPT, TRANSLATE, TTS, VISION | `MediaStageExecutionService.chargeAiUsage(...)` |
| Stage **không** trừ Credit | EXTRACT_AUDIO, SOURCE_SEPARATION, AUDIO_MIX, RENDER | như trên |
| Đơn vị | STT: token nếu provider trả, không thì **giây**; TTS: **ký tự**; LLM: token | `MediaStageExecutionService.usageUnits()` |
| Tra cứu giá | Luôn `findActivePricing(capability, null)` — **bỏ qua `provider_scope`** | `CreditServiceImpl.chargeUsage()` |
| Fallback hard-code | `DEFAULT_INFRA_X = 0.0001`, `DEFAULT_TOKEN_Y = 0.0005` | `CreditServiceImpl` |
| BYOK xác định theo | `job.createdByUserId` (không phải người thao tác) | `hasPersonalProvider()` |
| Gói Credit seed | Starter 100đ/Credit · Creator 90đ · **Business 80đ** | `V2__init_indexes.sql` |
| Credit khởi tạo | 100 (mặc định) | `AppProperties.Credit` |
| Ngôn ngữ đích | 1 `target_lang`/job; **không tái dùng transcript** giữa các job cùng video | Database_Design, `MediaJobServiceImpl` |
| Mã lỗi credit đã dùng | 2300–2303 (tiếp theo trống: 2304) | `ErrorCode.java` |

**Hệ quả chính:**
1. Provider nền tảng mặc định là **`gpt-4o`** (không phải `gpt-4o-mini` như v1 giả định) → y của TRANSLATE/SUMMARIZE đắt gấp ~17 lần v1.
2. TTS nền tảng luôn đi qua API có phí → **TTS là thành phần y lớn nhất** (~70% chi phí AI của job dub). Chọn model TTS là đòn bẩy giá lớn nhất.
3. Một provider nền tảng có thể phục vụ nhiều model giá rất khác nhau → **bắt buộc** định giá y theo `provider_scope`.
4. Stage nặng tài nguyên nhất (Demucs, render) đang **không thu đồng nào**.

---

## 4. Thuật ngữ & đơn vị tính

### 4.1 Chế độ âm thanh đầu ra và các stage liên quan 🆕

Job có 3 chế độ âm thanh (`MediaJob.OutputAudioMode`) — quyết định stage nào chạy, nên quyết định job trả những khoản nào:

| Chế độ | Âm thanh video xuất ra | Stage chạy thêm (ngoài STT, TRANSLATE, RENDER) | Khoản phí phát sinh thêm |
|---|---|---|---|
| `ORIGINAL_ONLY` | Giữ nguyên âm thanh gốc, chỉ thêm phụ đề | — | — |
| `DUB_REPLACE` | **Thay toàn bộ** âm thanh gốc bằng giọng AI — nhạc nền, tiếng động mất theo | TTS, AUDIO_MIX | TTS |
| `DUB_MIX` | Tách giọng người nói khỏi nhạc nền, bỏ giọng gốc, **trộn giọng AI với nhạc nền gốc** | SOURCE_SEPARATION, TTS, AUDIO_MIX | TTS + AUDIO_SEPARATION |

**`AUDIO_SEPARATION`** là tên *capability tính phí* đề xuất cho stage pipeline `SOURCE_SEPARATION`: dùng **Demucs chạy local** để tách audio thành giọng nói (vocals) và nhạc nền (accompaniment). Không gọi API ngoài → y = 0; nhưng rất nặng CPU/GPU → chỉ thu x. Đây là lý do `DUB_MIX` đắt hơn `DUB_REPLACE` ~0,8 Credit/phút.

> `AUDIO_MIX` (ghép giọng AI vào video/nhạc nền bằng FFmpeg) được tính gộp trong `RENDER`, không có capability riêng.

### 4.2 Đơn vị tính theo capability

| Capability | Đơn vị (`billing_unit`) | Nguồn số liệu | Ghi chú |
|---|---|---|---|
| `STT` | `AUDIO_SECOND` (thời lượng **video nguồn**) | thời lượng audio đã extract | 🆕 Luôn tính theo giây, **không** dùng token kể cả khi provider trả token (sửa I1) |
| `TRANSLATE` | `TOKEN` | `usage.total_tokens` | |
| `TTS` | `CHARACTER` | tổng ký tự text đưa vào TTS | |
| `SUMMARIZE_SCRIPT` | `TOKEN` | `usage.total_tokens` | |
| `VISION` | `TOKEN` | `usage.total_tokens` (gồm image tokens) | |
| `AUDIO_SEPARATION` 🆕 | `AUDIO_SECOND` | thời lượng audio đưa vào Demucs | Chỉ job `DUB_MIX` |
| `RENDER` | `VIDEO_SECOND` (thời lượng **video output**) | thời lượng file render | Gồm AUDIO_MIX + FFmpeg + lưu trữ/băng thông output |

---

## 5. Hướng đề xuất (P1–P8)

### P1 — Tính x theo tác nhân chi phí, không chia % đều 🆕

v1 chia 100$ theo tỷ lệ cố định (RENDER 60%, STT 10%…) rồi chia cho **mọi** phút video, ngầm giả định mọi phút đều đi qua cả 6 capability. Thực tế job phụ đề không dùng TTS/Demucs, job tóm tắt không dùng TTS/TRANSLATE… nên hạ tầng bị thu thiếu (review §2.1: điểm hoà vốn thực ~9.400–10.300 phút thay vì 8.000).

v2.1 gán chi phí vào **đúng stage gây ra nó**:

| Chi phí hạ tầng | Gán vào | Lý do |
|---|---|---|
| Cố định (app server, PostgreSQL, Redis, RabbitMQ, MinIO nền, backup/monitoring) | `STT` — theo giây video nguồn | Mọi loại job (phụ đề, dub, tóm tắt) đều đi qua STT; thời lượng nguồn là thước đo tải chung tốt nhất |
| EXTRACT_AUDIO | `STT` | Luôn đi kèm STT |
| Demucs | `AUDIO_SEPARATION` | Chỉ DUB_MIX gây ra |
| FFmpeg render + AUDIO_MIX + lưu trữ/băng thông output | `RENDER` | Tỷ lệ với độ dài output |
| Lưu audio TTS vào MinIO | `TTS` | Mỗi đoạn TTS tạo file audio |
| Keyframe extraction | `VISION` | Chỉ khi bật VLM |
| Điều phối LLM (queue, log, DB) | `TRANSLATE`, `SUMMARIZE_SCRIPT` — mức rất nhỏ | Đảm bảo x > 0 cho mọi capability (đúng SRS) |

### P2 — Tách hạ tầng cố định / biến đổi 🆕

| Phần | Giá trị | Cách thu |
|---|---|---|
| Cố định | ⚠️ **45 USD/tháng = 1.170.000đ** | Chia cho **sản lượng kế hoạch 5.000 phút** → **234đ/phút video nguồn**, thu qua x của STT |
| Biến đổi | ⚠️ tối đa ~54 USD/tháng ở 10.000 phút | Thu theo đơn giá mỗi phút ở stage tương ứng (§6.2) — **không phụ thuộc sản lượng** |

Lợi ích: khi sản lượng thấp, chỉ phần cố định bị thu thiếu (review coi toàn bộ 100$ là cố định nên phóng đại lỗ ở 3.000 phút). Kiểm tra ngược: 10.000 phút toàn `DUB_MIX` → biến đổi ~54 USD + cố định 45 USD ≈ **99 USD**, khớp ngân sách D4.

### P3 — Tách capability `AUDIO_SEPARATION` 🆕

Demucs là tác vụ nặng CPU/GPU nhất nhưng chỉ `DUB_MIX` dùng. Gộp vào RENDER (v1) khiến job phụ đề (`ORIGINAL_ONLY`) và `DUB_REPLACE` trả hộ chi phí Demucs, và là nguyên nhân chính làm giá phụ đề ở phương án C của review tăng 65%.

### P4 — y theo `provider_scope` với model thật 🆕

`provider_scope` = `protocol/model`. Thứ tự khớp khi tính giá:

```
1. capability + 'protocol/model'   (ví dụ TTS + 'openai_compatible/tts-1-hd')
2. capability + 'protocol'         (ví dụ TRANSLATE + 'dashscope')
3. capability + NULL               (giá mặc định của capability)
4. không có row → chặn job (P8)
```

- Chỉ provider **nền tảng** cần row y riêng (BYOK không trả y).
- Row `NULL` lấy y theo **model đắt nhất** đang hỗ trợ cho capability đó, để model chưa khai báo giá không bị bán lỗ.
- Admin thêm provider/model nền tảng mới ⇒ phải thêm row giá tương ứng.

### P5 — Markup & dự phòng

| Hệ số | v1 | v2.1 | Lý do |
|---|---|---|---|
| x | ×1,25 | **×1,25 × 1,10 = ×1,375** | +10% dự phòng cho stage FAILED/retry do hệ thống (đã tiêu tài nguyên nhưng không thu) 🆕 |
| y | ×1,25 | **×1,50** | Markup 25% chỉ cho biên gộp 4–14% (review §2.2); 50% là mức pass-through phổ biến, vẫn rẻ hơn đối thủ quốc tế nhiều lần |

### P6 — Tái dùng STT & stems khi dịch cùng video sang ngôn ngữ khác 🆕 (Phase 2)

Hiện mỗi job = 1 video × 1 ngôn ngữ, STT (và Demucs) chạy lại từng lần. Đề xuất: job ngôn ngữ thứ 2+ của cùng `media_asset` tái dùng transcript và stems đã có:
- STT: **chỉ tính x** (vẫn thu phần hạ tầng cố định), **y = 0** vì không gọi provider.
- AUDIO_SEPARATION: không tính (không chạy lại).

Cần bổ sung SRS/thiết kế (khoá tái dùng theo `media_asset_id` + checksum + STT model). Bảng giá đã tính sẵn kịch bản này.

### P7 — Giá gói Credit tối thiểu 90đ/Credit 🆕

Giá vốn bình quân ở sản lượng kế hoạch ≈ **69–71đ/Credit**, cộng phí cổng thanh toán ~3%. Gói Business 80đ/Credit chỉ còn ~11% biên sau phí cổng và âm khi sản lượng thấp. Biên ở §7 được tính với **giá bán thấp nhất 90đ/Credit** (kịch bản xấu nhất).

### P8 — Chặn job khi thiếu cấu hình giá 🆕

Bỏ fallback hard-code; thiếu row giá ⇒ ném `PRICING_CONFIG_MISSING` (đề xuất mã **2304**) trước khi dispatch stage.

---

## 6. Tham số đầu vào

### 6.1 Tham số chung

| Tham số | Giá trị | Trạng thái |
|---|---|---|
| P (giá niêm yết) | 100đ/Credit | ✅ |
| P_eff (giá bán thấp nhất, dùng để tính biên) | 90đ/Credit | ❓ theo P7 |
| Tỷ giá | 26.000đ/USD | ⚠️ |
| Hạ tầng cố định | 45 USD/tháng | ⚠️ |
| Sản lượng kế hoạch (mẫu số của phần cố định) | 5.000 phút/tháng | ❓ |
| Markup x | ×1,375 (25% + 10% dự phòng) | ❓ |
| Markup y | ×1,50 | ❓ |
| Phí cổng thanh toán | 3% | ⚠️ |

### 6.2 Chi phí hạ tầng biến đổi (VNĐ / phút video, ở ~50% công suất worker) ⚠️

| Tác nhân | VNĐ/phút | Gán vào | Căn cứ ước lượng |
|---|---|---|---|
| EXTRACT_AUDIO | 3 | STT | FFmpeg tách audio, rất nhẹ |
| Demucs `htdemucs` (CPU) | 60 | AUDIO_SEPARATION | ~1× realtime trên worker 4–8 vCPU |
| FFmpeg render + AUDIO_MIX | 40 | RENDER | hard-sub/mix ~0,3–0,5× realtime |
| Lưu trữ + băng thông output | 35 | RENDER | ~50MB/phút, giữ 14 ngày, MinIO/R2 |
| Lưu audio TTS | 2 | TTS | file audio từng đoạn TTS |
| Keyframe extraction | 5 | VISION | |
| Điều phối LLM | 0,25 / 500 token | TRANSLATE, SUMMARIZE | queue/log/DB |

> Cần đo thực tế: CPU-time từng stage/phút video và dung lượng lưu trữ/phút sau 1 tháng chạy thật.

### 6.3 Units trên 1 phút video (để quy đổi) ⚠️

| Capability | Units / phút | Ghi chú |
|---|---|---|
| STT, AUDIO_SEPARATION | 60 giây | chính xác |
| RENDER | 60 giây output | tóm tắt: output ngắn hơn nguồn (giả định 3 phút cho video 10 phút) |
| TRANSLATE, SUMMARIZE | ~500 token | cần đo cho tiếng Việt |
| TTS | ~1.000 ký tự | 🆕 v1 dùng 900 (tiếng Anh); tiếng Việt bị giới hạn bởi timing câu gốc (`script_timeline`), ước ~1.000–1.300 — cần đo |
| VISION | ~1.000 token | keyframes |

### 6.4 Giá thị trường tham chiếu cho y ⚠️ (giá niêm yết, cần tra lại khi chốt)

| Capability | `provider_scope` đề xuất | Giá niêm yết | VNĐ/unit |
|---|---|---|---|
| STT | `openai_compatible/whisper-1` | $0,006/phút | 2,60 /giây |
| STT | `openai_compatible/gpt-4o-mini-transcribe` | $0,003/phút | 1,30 /giây |
| TRANSLATE | `openai_compatible/gpt-4o` (seed hiện tại) | $2,50 in / $10 out per 1M, in:out 1:1 | 0,1625 /token |
| TRANSLATE | `openai_compatible/gpt-4o-mini` | $0,15 / $0,60, 1:1 | 0,00975 /token |
| TRANSLATE | `dashscope/qwen-plus` | ~$0,40 / $1,20, 1:1 | 0,0208 /token |
| SUMMARIZE_SCRIPT | `…/gpt-4o` | in:out 4:1 | 0,104 /token |
| SUMMARIZE_SCRIPT | `…/gpt-4o-mini` | in:out 4:1 | 0,00624 /token |
| SUMMARIZE_SCRIPT | `dashscope/qwen-plus` | in:out 4:1 | 0,01456 /token |
| TTS | `openai_compatible/tts-1` | $15 / 1M ký tự | 0,39 /ký tự |
| TTS | `openai_compatible/tts-1-hd` | $30 / 1M ký tự | 0,78 /ký tự |
| VISION | `…/gpt-4o-mini` | in:out 9:1 | 0,00507 /token |
| VISION | `…/gpt-4o` | in:out 9:1 | 0,0845 /token |
| AUDIO_SEPARATION, RENDER | — (local) | 0 | 0 |

Chưa có giá tham chiếu: DashScope TTS (Qwen-Omni/Qwen TTS), ElevenLabs, Google TTS, Azure TTS — ❓ bổ sung khi các provider này được bật làm provider **nền tảng** (BYOK thì không cần y). Nếu có TTS API rẻ hơn `tts-1` với chất lượng tiếng Việt chấp nhận được, đó là cách giảm giá dub hiệu quả nhất.

---

## 7. Kết quả

### 7.1 Công thức

```
Fixed_per_min = Hạ_tầng_cố_định ÷ Sản_lượng_kế_hoạch = 1.170.000 ÷ 5.000 = 234đ
C_infra(cap)  = [ Var_per_min(cap) + Fixed_per_min × 1{cap = STT} ] ÷ Units_per_min(cap)

x(cap)        = C_infra(cap)         × 1,375 ÷ P
y(cap, scope) = C_market(cap, scope) × 1,50  ÷ P
```

x chỉ phụ thuộc capability (hạ tầng không đổi theo provider); y phụ thuộc capability + `provider_scope`.

### 7.2 Bảng hệ số đề xuất (seed cho `credit_pricing_config`)

| Capability | `provider_scope` | `billing_unit` | C_infra (đ) | C_market (đ) | **x** | **y** |
|---|---|---|---|---|---|---|
| STT | `openai_compatible/whisper-1` | AUDIO_SECOND | 3,9500 | 2,60000 | **0.054313** | **0.039000** |
| STT | `openai_compatible/gpt-4o-mini-transcribe` | AUDIO_SECOND | 3,9500 | 1,30000 | **0.054313** | **0.019500** |
| STT | `NULL` (mặc định) | AUDIO_SECOND | 3,9500 | 2,60000 | **0.054313** | **0.039000** |
| TRANSLATE | `openai_compatible/gpt-4o` | TOKEN | 0,0005 | 0,16250 | **0.000007** | **0.002438** |
| TRANSLATE | `openai_compatible/gpt-4o-mini` | TOKEN | 0,0005 | 0,00975 | **0.000007** | **0.000146** |
| TRANSLATE | `dashscope/qwen-plus` | TOKEN | 0,0005 | 0,02080 | **0.000007** | **0.000312** |
| TRANSLATE | `NULL` | TOKEN | 0,0005 | 0,16250 | **0.000007** | **0.002438** |
| SUMMARIZE_SCRIPT | `openai_compatible/gpt-4o` | TOKEN | 0,0005 | 0,10400 | **0.000007** | **0.001560** |
| SUMMARIZE_SCRIPT | `openai_compatible/gpt-4o-mini` | TOKEN | 0,0005 | 0,00624 | **0.000007** | **0.000094** |
| SUMMARIZE_SCRIPT | `dashscope/qwen-plus` | TOKEN | 0,0005 | 0,01456 | **0.000007** | **0.000218** |
| SUMMARIZE_SCRIPT | `NULL` | TOKEN | 0,0005 | 0,10400 | **0.000007** | **0.001560** |
| TTS | `openai_compatible/tts-1` | CHARACTER | 0,0020 | 0,39000 | **0.000027** | **0.005850** |
| TTS | `openai_compatible/tts-1-hd` | CHARACTER | 0,0020 | 0,78000 | **0.000027** | **0.011700** |
| TTS | `NULL` | CHARACTER | 0,0020 | 0,78000 | **0.000027** | **0.011700** |
| VISION | `openai_compatible/gpt-4o-mini` | TOKEN | 0,0050 | 0,00507 | **0.000069** | **0.000076** |
| VISION | `openai_compatible/gpt-4o` | TOKEN | 0,0050 | 0,08450 | **0.000069** | **0.001267** |
| VISION | `NULL` | TOKEN | 0,0050 | 0,08450 | **0.000069** | **0.001267** |
| AUDIO_SEPARATION 🆕 | `NULL` | AUDIO_SECOND | 1,0000 | 0 | **0.013750** | **0.000000** |
| RENDER | `NULL` | VIDEO_SECOND | 1,2500 | 0 | **0.017188** | **0.000000** |

- STT tái dùng (P6): áp x của STT, bỏ qua y (không có row riêng, xử lý trong code).
- `NUMERIC(10,6)` đủ chính xác cho mọi giá trị trên (x TRANSLATE = 0.000007 lệch < 2% so với 0.00000688 — không đáng kể vì x TRANSLATE chỉ chiếm < 0,1% giá job).

### 7.3 Giá job mẫu & biên gộp

Giả định chung: STT `whisper-1`, dịch `gpt-4o-mini`, TTS `tts-1` (trừ khi ghi khác). Biên gộp = (doanh thu × 90đ × 0,97 − chi phí AI − hạ tầng biến đổi − hạ tầng cố định theo sản lượng thực) ÷ doanh thu.

| Kịch bản | Nguồn AI | Credit | Credit/phút | ≈ VNĐ (giá niêm yết) | Chi phí AI | Biên @3.000 / 5.000 / 10.000 phút | Hoà vốn (phút/tháng) |
|---|---|---|---|---|---|---|---|
| 1 phút phụ đề | Nền tảng | 6,7 | 6,71 | 671đ | 161đ | −7,5% / 19,2% / 39,2% | ~3.400 |
| 10 phút phụ đề | Nền tảng | 67,1 | 6,71 | 6.707đ | 1.609đ | −7,5% / 19,2% / 39,2% | ~3.400 |
| 10 phút phụ đề | BYOK | 42,9 | 4,29 | 4.294đ | 0 | −24,9% / 16,7% / 47,9% | ~3.900 |
| 10 phút phụ đề (dịch `gpt-4o` như seed) | Nền tảng | 78,5 | 7,85 | 7.853đ | 2.372đ | −2,9% / 19,8% / 36,9% | ~3.200 |
| 10 phút `DUB_REPLACE` | Nền tảng | 125,8 | 12,58 | 12.584đ | 5.509đ | 7,0% / 21,2% / 31,9% | ~2.500 |
| 10 phút `DUB_REPLACE` | BYOK | 43,2 | 4,32 | 4.321đ | 0 | −24,7% / 16,7% / 47,7% | ~3.900 |
| 10 phút `DUB_MIX` | Nền tảng | 134,1 | 13,41 | 13.409đ | 5.509đ | 7,6% / 21,0% / 31,0% | ~2.400 |
| 10 phút `DUB_MIX` | BYOK | 51,5 | 5,15 | 5.146đ | 0 | −18,0% / 16,7% / 42,7% | ~3.800 |
| 10 phút `DUB_MIX`, giọng `tts-1-hd` | Nền tảng | 192,6 | 19,26 | 19.259đ | 9.409đ | 12,5% / 21,8% / 28,7% | ~2.000 |
| 10 phút `DUB_MIX`, STT `gpt-4o-mini-transcribe` | Nền tảng | 122,4 | 12,24 | 12.239đ | 4.729đ | 6,1% / 20,7% / 31,7% | ~2.600 |
| Ngôn ngữ thứ 2, cùng video (P6: tái dùng STT + stems) | Nền tảng | 102,4 | 10,24 | 10.244đ | 3.949đ | 3,3% / 20,7% / 33,8% | ~2.800 |
| Ngôn ngữ thứ 2, cùng video (P6) | BYOK | 43,2 | 4,32 | 4.321đ | 0 | −24,7% / 16,7% / 47,7% | ~3.900 |
| 30 phút `DUB_MIX` (tối đa) | Nền tảng | 402,3 | 13,41 | 40.226đ | 16.526đ | 7,6% / 21,0% / 31,0% | ~2.400 |
| 30 phút `DUB_MIX` (tối đa) | BYOK | 154,4 | 5,15 | 15.437đ | 0 | −18,0% / 16,7% / 42,7% | ~3.800 |
| 10 phút tóm tắt + VLM (output 3 phút) | Nền tảng | 61,0 | 6,10 | 6.104đ | 1.642đ | −9,8% / 19,5% / 41,5% | ~3.500 |
| 10 phút tóm tắt + VLM | BYOK | 36,4 | 3,64 | 3.641đ | 0 | −32,4% / 16,7% / 53,5% | ~4.100 |

**Đọc kết quả:**
- Ở sản lượng kế hoạch 5.000 phút, **mọi loại job có biên 17–22%** — đồng đều, vì mỗi loại chỉ trả đúng chi phí nó gây ra (v1: phụ đề 4%, dub 14%).
- Job dub có y lớn (TTS) nên hoà vốn sớm nhất (~2.000–2.500 phút); job BYOK và phụ đề hoà vốn muộn nhất (~3.400–4.100 phút).
- BYOK luôn có biên dương khi vượt ~3.800–4.100 phút → nền tảng không còn "gần như 0 lãi" trên job BYOK như review §2.3 chỉ ra.
- Dưới ~2.000–4.100 phút/tháng vẫn lỗ phần cố định — chấp nhận ở giai đoạn đầu, hoặc giảm hạ tầng cố định.
- Khi sản lượng thực vượt 5.000 phút, biên tăng dần → dư địa chiết khấu gói lớn, hoặc hạ x qua row giá mới.

### 7.4 Cơ cấu giá một job 10 phút `DUB_MIX` (nền tảng, 134,1 Credit)

| Stage | Credit | Tỷ trọng | Thành phần chính |
|---|---|---|---|
| TTS (`tts-1`, 10.000 ký tự) | 58,8 | 44% | y (chi phí OpenAI) |
| STT (`whisper-1`, 600 giây) | 56,0 | 42% | x 32,6 (hạ tầng cố định) + y 23,4 |
| RENDER (600 giây) | 10,3 | 8% | x |
| AUDIO_SEPARATION (600 giây) | 8,3 | 6% | x |
| TRANSLATE (`gpt-4o-mini`, 5.000 token) | 0,8 | < 1% | y |

→ Hai đòn bẩy giảm giá: **model TTS** và **model STT** (`gpt-4o-mini-transcribe` giảm ~9% giá job dub). Model dịch gần như không ảnh hưởng.

### 7.5 BYOK thực sự tiết kiệm bao nhiêu? 🆕

| Job 10 phút `DUB_MIX` | Nền tảng | BYOK (phí nền tảng + hoá đơn provider theo giá niêm yết) | Tiết kiệm |
|---|---|---|---|
| Giọng `tts-1` | 13.409đ | 5.146đ + 5.509đ = 10.655đ | ~21% |
| Giọng `tts-1-hd` | 19.259đ | 5.146đ + 9.409đ = 14.555đ | ~24% |

→ Không quảng bá "BYOK rẻ hơn 3 lần". Định vị BYOK: dùng provider/giọng riêng (ElevenLabs, Google, Azure…), tận dụng free tier/hạn mức sẵn có, kiểm soát chi phí AI.

---

## 8. Giá hiển thị cho người dùng 🆕

Hệ số x, y là nội bộ; UI nên hiển thị **Credit/phút video** theo loại job (và **ước tính trước khi chạy** — Q10). Giá dưới đây là khi dùng nguồn AI nền tảng:

| Loại job | Credit / phút | ≈ VNĐ / phút |
|---|---|---|
| Phụ đề (dịch) | ~6,7 | ~670đ |
| Lồng tiếng — thay giọng (`DUB_REPLACE`) | ~12,6 | ~1.260đ |
| Lồng tiếng — giữ nhạc nền (`DUB_MIX`) | ~13,4 | ~1.340đ |
| Lồng tiếng giọng HD (`tts-1-hd`, giữ nhạc nền) | ~19,3 | ~1.930đ |
| Thêm ngôn ngữ cho video đã xử lý (P6) | ~10,2 | ~1.020đ |
| Tóm tắt video + phân tích hình ảnh | ~6,1 / phút nguồn | ~610đ |
| Mọi loại job khi dùng BYOK | ~3,6–5,2 | ~360–520đ (chưa gồm hoá đơn provider của user) |

Với gói Starter (500 Credit / 50.000đ): ~7 video 10 phút phụ đề, hoặc ~4 video 10 phút lồng tiếng, hoặc ~2,5 video lồng tiếng HD.

---

## 9. Gói Credit & Credit khởi tạo 🆕

### 9.1 Gói Credit

| Gói | Hiện tại | Đề xuất | Đơn giá |
|---|---|---|---|
| Starter | 500 Credit / 50.000đ | Giữ nguyên | 100đ |
| Creator | 2.000 Credit / 180.000đ | **2.000 Credit / 190.000đ** | 95đ |
| Business | 10.000 Credit / 800.000đ | **10.000 Credit / 900.000đ** | 90đ |

Giá vốn bình quân ~69–71đ/Credit ở 5.000 phút → Business 80đ chỉ còn ~11% biên sau phí cổng 3%, và âm khi sản lượng thấp.

### 9.2 Credit khởi tạo

- Giữ **100 Credit** (≈ 1,5 video 10 phút phụ đề, hoặc ~8 phút lồng tiếng), chi phí thực tối đa ~7.000đ/tài khoản.
- Chỉ nâng lên 150–300 khi có chống lạm dụng nhiều tài khoản (xác minh email/số điện thoại, giới hạn thiết bị).
- ❓ Nếu muốn người dùng mới trải nghiệm trọn 1 video 10 phút lồng tiếng, cần ~135 Credit → cân nhắc 150.

---

## 10. Quản trị giá — Super Admin 🆕

### 10.1 Nguyên tắc: không hard-code, không sửa tuỳ ý

x, y **không cố định trong code** và **không để ai sửa trực tiếp trong DB**. Super Admin (`is_platform_admin = true`) quản lý qua API `/api/platform/*`, với các ràng buộc:

| Nguyên tắc | Nội dung |
|---|---|
| Versioning, không ghi đè | Mỗi lần đổi giá: đóng row cũ (`effective_to = now()`) + insert row mới (`effective_from`). **Không UPDATE/DELETE** row đã có hiệu lực — giữ lịch sử để đối soát `credit_transactions` |
| Không hồi tố | `effective_from` phải **≥ now()**; cho phép hẹn giờ trong tương lai (ví dụ đầu tháng sau) |
| Giá chốt theo job | Stage của một job luôn tính theo giá có hiệu lực **tại `media_jobs.created_at`** (`effective_from ≤ created_at < effective_to`). Đổi giá giữa chừng không ảnh hưởng job đang chạy; khớp với ước tính / giữ trước Credit (Q10). Không cần thêm cột snapshot |
| Chỉ Super Admin | Lead/Member/Client không xem được x, y thô; user chỉ thấy bảng Credit/phút (§8) |
| Seed chỉ là giá khởi tạo | Migration `V11` insert bộ giá ban đầu; mọi thay đổi sau đó đi qua API, không viết migration mới |

### 10.2 API đề xuất

| Method & path | Chức năng |
|---|---|
| `GET /api/platform/pricing` | Danh sách giá đang hiệu lực, lọc theo `capability`, `provider_scope` |
| `GET /api/platform/pricing/history?capability=&providerScope=` | Lịch sử các version (kể cả đã đóng) |
| `POST /api/platform/pricing` | Tạo version mới cho 1 cặp `capability` + `provider_scope` (tự đóng version cũ tại `effective_from` của version mới) |
| `POST /api/platform/pricing/preview` | Nhập bộ x, y dự kiến → trả về giá mẫu Credit/phút (§8) và biên gộp ước tính (§7.3) trước khi lưu |
| `GET /api/platform/pricing/coverage` | Kiểm tra mọi provider/model nền tảng đang bật đều có row giá; liệt kê chỗ thiếu |
| `GET /api/credit/rates` (mọi user) | Bảng Credit/phút theo loại job, tính từ giá đang hiệu lực — dùng cho UI ước tính |

Request tạo version (ví dụ):

```json
{
  "capability": "TTS",
  "providerScope": "openai_compatible/tts-1",
  "billingUnit": "CHARACTER",
  "infraCoefficientX": 0.000027,
  "tokenCoefficientY": 0.005850,
  "effectiveFrom": "2026-10-01T00:00:00+07:00",
  "changeReason": "Review tháng 9: sản lượng thực 6.200 phút"
}
```

### 10.3 Validation khi lưu

| Rule | Hành vi |
|---|---|
| x ≥ 0, y ≥ 0; `billing_unit` khớp capability (§4.2) | Từ chối |
| `effective_from` < now() | Từ chối |
| `changeReason` rỗng | Từ chối |
| x hoặc y lệch > ±50% so với version đang hiệu lực | Yêu cầu gửi lại với `"confirmLargeChange": true` |
| Row `NULL` của capability có y **thấp hơn** row provider cụ thể đắt nhất | Cảnh báo (vi phạm nguyên tắc "NULL = model đắt nhất", P4) |
| Provider/model nền tảng đang bật nhưng không có row giá khớp | Hiện ở `/coverage`; job dùng provider đó bị chặn bởi P8 |

### 10.4 Audit

- `PlatformAdminAuditFilter` hiện đã ghi **mọi** request `/api/platform/**` vào `platform_admin_audit_logs` — nhưng chỉ lưu method, path, status, IP, **không lưu giá trị trước/sau**.
- Bổ sung:
  - Action mới trong `PlatformAdminAuditAction`: `VIEW_PRICING`, `CREATE_PRICING`, `PREVIEW_PRICING`.
  - Cột mới trên `credit_pricing_config`: `created_by_user_id` (FK `users`), `change_reason` (TEXT). Vì row không bao giờ bị sửa, chính bảng giá là lịch sử trước/sau đầy đủ.

### 10.5 Quy trình vận hành đề xuất

1. **Hàng tháng**: lấy sản lượng phút thực + hoá đơn hạ tầng → tính lại `Fixed_per_min` và x (§7.1).
2. **Khi provider đổi giá** hoặc bật provider/model nền tảng mới: tra giá niêm yết → tính y → thêm row theo `provider_scope`.
3. Dùng `/preview` kiểm tra giá Credit/phút và biên → lưu với `effective_from` là đầu kỳ sau.
4. Kiểm tra `/coverage` sau mỗi thay đổi cấu hình provider.

---

## 11. Thay đổi cần làm trong code / DB / docs

| # | Hạng mục | Thay đổi | Liên quan |
|---|---|---|---|
| C1 | DB — migration mới `V11__credit_pricing_v2.sql` | `ADD COLUMN billing_unit VARCHAR NOT NULL` (CHECK `AUDIO_SECOND, VIDEO_SECOND, TOKEN, CHARACTER`); mở CHECK `capability` thêm `AUDIO_SEPARATION`; đóng row cũ (`effective_to = now()`); insert row §7.2 | P1–P4 |
| C2 | DB | Unique partial index `credit_transactions(ref_type, ref_id) WHERE type = 'AI_USAGE'` với `ref_id` = stage id + lần chạy → chống trừ trùng khi callback lặp | Rule 5 (idempotent) |
| C3 | DB | Cập nhật giá `credit_packages` Creator/Business | P7 |
| C4 | DB | Đổi `default_model` provider nền tảng seed theo Q2 (ví dụ `gpt-4o` → `gpt-4o-mini` cho dịch) hoặc tách model theo capability | Q2 |
| C5 | `CreditServiceImpl` | Resolver giá theo thứ tự `protocol/model` → `protocol` → `NULL`; **bỏ** `DEFAULT_INFRA_X/Y`; thiếu row → `PRICING_CONFIG_MISSING (2304)` | P4, P8 |
| C6 | `MediaStageExecutionService.usageUnits()` | STT luôn dùng giây audio; TTS ký tự; LLM token — không trộn đơn vị | I1 |
| C7 | `MediaStageExecutionService` / `MediaCallbackService` | Trừ Credit cho `AUDIO_SEPARATION` (giây audio) và `RENDER` (giây output) khi stage COMPLETED, x-only | P3 |
| C8 | Truyền `provider_scope` (`protocol/model` đã resolve) vào `chargeUsage` | | P4 |
| C9 | BYOK theo **người trực tiếp thực hiện**: lưu `triggered_by_user_id` trên stage (Auto → người tạo job; rerun/confirm → người thao tác) | | Q7 |
| C10 | Pre-authorize: ước tính Credit khi tạo job / trước stage, chặn nếu không đủ | | Q10 |
| C11 | Tái dùng STT + stems theo `media_asset_id` (Phase 2) | | P6 |
| C12 | Piper: không có row giá; nếu Piper được bật ngoài môi trường local thì bị chặn bởi P8 (thiếu pricing config) | | D5 |
| C13 | DB (trong `V11`) | Thêm cột `created_by_user_id UUID REFERENCES users(id)`, `change_reason TEXT` vào `credit_pricing_config` | §10.4 |
| C14 | `CreditServiceImpl` | Resolver lấy giá theo thời điểm `media_jobs.created_at` (`effective_from ≤ t < effective_to`) thay vì "row đang mở" | §10.1 |
| C15 | Module `platform` / `credit` | `PlatformPricingController` + service: `GET pricing`, `GET history`, `POST pricing`, `POST preview`, `GET coverage`; validation §10.3; không có endpoint UPDATE/DELETE | §10.2–10.3 |
| C16 | `PlatformAdminAuditAction` | Thêm `VIEW_PRICING`, `CREATE_PRICING`, `PREVIEW_PRICING` | §10.4 |
| C17 | Module `credit` | `GET /api/credit/rates` — bảng Credit/phút cho UI ước tính | §8, §10.2 |
| C18 | Frontend | Trang Super Admin "Bảng giá": danh sách, lịch sử, form tạo version + preview, cảnh báo coverage | §10 |
| D1 | `SRS.md` §5.6 | "Số token đã dùng" → "Số đơn vị sử dụng theo từng thao tác"; thêm bảng đơn vị; đóng mục §7.2 #2 | D2 |
| D2 | `Database_Design.md` | `billing_unit`, `AUDIO_SEPARATION`, unique index C2 | C1, C2 |
| D3 | `API_Contract.md` §15.2 | Mã 2304 `PRICING_CONFIG_MISSING` | P8 |
| D4 | `API_Contract.md` (mục Platform Admin) | Các endpoint `/api/platform/pricing*` và `/api/credit/rates`; mã lỗi validation giá (đề xuất 2305 `PRICING_INVALID`, 2306 `PRICING_LARGE_CHANGE_UNCONFIRMED`) | §10 |
| D5 | `SRS.md` §5.8 (Platform Super Admin) | Bổ sung quyền quản trị bảng giá Credit | §10 |
| T1 | Test | `CreditServiceImpl.chargeUsage`: resolver scope, BYOK/non-BYOK, LEAD_PAYS_ALL/PAY_PER_USER, thiếu config, callback trùng, giá chốt theo `created_at` khi có version mới | |
| T2 | Test | API pricing: chỉ Super Admin, từ chối hồi tố / giá âm / thiếu lý do, xác nhận thay đổi lớn, tự đóng version cũ, audit action | §10 |

---

## 12. Việc còn cần chốt

> Đánh dấu `[x]` và ghi quyết định vào dòng **Chốt**.

### 12.1 Ưu tiên cao — chặn việc seed giá

- [ ] **Q2 — Provider/model nền tảng thật cho từng capability**
  - Seed đang dùng `gpt-4o` cho mọi thứ. Đề xuất:
    - TRANSLATE / SUMMARIZE → `gpt-4o-mini` (hoặc `qwen-plus`)
    - STT → `whisper-1`, hoặc `gpt-4o-mini-transcribe` (rẻ một nửa, giảm ~9% giá job dub) nếu chất lượng tiếng Việt đạt
    - TTS → `tts-1` mặc định, `tts-1-hd` làm tuỳ chọn cao cấp
    - VISION → `gpt-4o-mini`
  - **Chốt:** ______
- [ ] **P1/P2 — Tách hạ tầng cố định 45$ / biến đổi, gán theo tác nhân chi phí**
  - **Chốt:** ______
- [ ] **P3 — Thêm capability `AUDIO_SEPARATION`**
  - **Chốt:** ______
- [ ] **P5 — Markup x ×1,375, y ×1,50**
  - **Chốt:** ______
- [ ] **Q6 — Sản lượng kế hoạch 5.000 phút, review hàng tháng**
  - **Chốt:** ______

### 12.2 Ưu tiên trung bình

- [ ] **P7 — Giá gói Creator 95đ / Business 90đ**
  - **Chốt:** ______
- [ ] **Có mở tuỳ chọn giọng HD (`tts-1-hd`) cho user không?**
  - Giá ~19,3 Credit/phút so với ~13,4 của `tts-1`. Cần UI chọn hạng giọng và `provider_scope` theo model.
  - **Chốt:** ______
- [ ] **Tìm TTS API rẻ hơn cho tiếng Việt** (DashScope, Google, Azure)
  - TTS chiếm ~44% giá job dub; cần giá niêm yết + đánh giá chất lượng trước khi bật làm provider nền tảng.
  - **Chốt:** ______
- [ ] **Q7 — "Người trực tiếp thực hiện" khi Lead rerun/confirm job của Member**
  - Đề xuất: người bấm hành động; Auto pipeline → người tạo job.
  - **Chốt:** ______
- [ ] **Q10 — Không đủ Credit**
  - Đề xuất: ước tính & giữ trước (pre-authorize), hiển thị ước tính cho user.
  - **Chốt:** ______
- [ ] **Quản trị giá qua Super Admin (§10)** 🆕
  - Đề xuất: API versioned, không hồi tố, giá chốt theo thời điểm tạo job, ngưỡng xác nhận ±50%.
  - Cần chốt: ngưỡng ±50% có phù hợp? Có cần **2 người duyệt** (maker–checker) cho thay đổi giá hay 1 Super Admin là đủ?
  - **Chốt:** ______
- [ ] **Chính sách rerun** 🆕
  - Đề xuất: stage lỗi do hệ thống (provider timeout, worker crash) → rerun **không** trừ lại; rerun do user chủ động (sửa bản dịch, đổi giọng) → trừ bình thường.
  - **Chốt:** ______

### 12.3 Ưu tiên thấp / Phase 2

- [ ] **P6 — Tái dùng STT + stems giữa các ngôn ngữ** (cần bổ sung SRS)
  - **Chốt:** ______
- [ ] **Q4 — Credit khởi tạo** (đề xuất giữ 100; 150 nếu muốn đủ 1 video dub 10 phút)
  - **Chốt:** ______
- [ ] **Q11 — Phí tối thiểu mỗi job** (ví dụ 1 Credit/job cho clip rất ngắn)
  - **Chốt:** ______
- [x] **Nguồn API miễn phí (freellmAPI)**
  - Cần làm rõ: có cung cấp STT/TTS hay chỉ LLM; dùng cho production hay chỉ test; điều khoản thương mại. Nếu dùng: khai báo `provider_scope` riêng, y theo shadow price của model tương đương (D3).
  - **Chốt (2026-09-25):** dùng cả production (ít người dùng), tự host bằng service `freellmapi` trong docker-compose. Là 1 key `tier=FREE`, `priority=10`, capability `TRANSLATE` trong pool key nền tảng (V13); key trả phí làm dự phòng khi FreeLLMAPI lỗi/giới hạn. Credit **giữ nguyên giá theo capability** (giá bóng D3), không tách `provider_scope`. Rủi ro đã chấp nhận: điều khoản free tier, dữ liệu đi qua bên thứ ba, chất lượng dao động giữa các model.
- [ ] **Hệ số RENDER theo độ phân giải** (1080p/4K tốn lưu trữ & compute hơn)
  - **Chốt:** ______

### 12.4 Dữ liệu cần đo / xác minh

- [ ] CPU-time mỗi stage / phút video (Demucs, render) → thay số §6.2.
- [ ] Dung lượng lưu trữ / phút video và retention thực tế.
- [ ] Ký tự TTS / phút và token dịch / phút cho tiếng Việt → thay số §6.3.
- [ ] Tra lại giá niêm yết các model ở §6.4 tại thời điểm chốt.
- [ ] Phí cổng thanh toán, thuế — nhờ kế toán xác nhận.
- [ ] Xác minh giá đối thủ nội địa (review §3.2) trước khi chốt giá phụ đề cho creator nhỏ.

---

## 13. Thay đổi so với các bản trước & điểm mới

### 13.1 v2.1 → v2.2 (bản này)

| Hạng mục | v2.1 | v2.2 |
|---|---|---|
| Thuật ngữ | Chưa giải thích chế độ âm thanh | §4.1: `ORIGINAL_ONLY` / `DUB_REPLACE` / `DUB_MIX`, `AUDIO_SEPARATION` (Demucs) và stage/khoản phí tương ứng |
| Ai sửa được x, y | Chỉ nói "runtime config", thực tế chỉ sửa được bằng migration/DB | **§10 Quản trị giá**: Super Admin qua `/api/platform/pricing*`, versioned, không hồi tố, có preview & coverage |
| Giá áp cho job đang chạy | Không quy định | Chốt theo `media_jobs.created_at` |
| Audit | Không đề cập | Action mới + `created_by_user_id`, `change_reason` trên `credit_pricing_config` |
| Việc cần làm | C1–C12, D1–D3, T1 | Thêm C13–C18, D4–D5, T2 |
| Việc cần chốt | — | Thêm "Quản trị giá (maker–checker?)" và "freellmAPI (để sau)" |

Không đổi con số nào so với v2.1.

### 13.2 v2 → v2.1

| Hạng mục | v2 | v2.1 |
|---|---|---|
| Piper TTS | Giọng "tiêu chuẩn" y = 0, row `TTS / piper` | **Loại bỏ** — chỉ dùng local để test (D5) |
| Hạng giọng | Tiêu chuẩn (Piper) / cao cấp (`tts-1`) | Mặc định `tts-1` / cao cấp `tts-1-hd` |
| Row TTS `NULL` | Theo `tts-1` | Theo `tts-1-hd` (model đắt nhất) |
| Giá lồng tiếng thấp nhất | ~6,8 Credit/phút (Piper) | **~12,6 Credit/phút** (`DUB_REPLACE`, `tts-1`) |
| Gói Starter mua được | ~6 video dub tiêu chuẩn | **~4 video dub** 10 phút |
| Bổ sung | — | Kịch bản `tts-1-hd`, `gpt-4o-mini-transcribe`, `DUB_REPLACE` BYOK; bảng cơ cấu giá §7.4; hoà vốn theo từng dòng |
| Việc cần chốt | Mô hình 2 hạng giọng Piper/API; seed giọng Piper | Bỏ; thay bằng "mở giọng HD?" và "tìm TTS API rẻ hơn cho tiếng Việt" |

Các con số không đổi so với v2: hệ số STT/TRANSLATE/SUMMARIZE/VISION/AUDIO_SEPARATION/RENDER, giá phụ đề, tóm tắt, DUB_MIX `tts-1`, ngôn ngữ thứ 2.

### 13.3 v1 → v2.2

| Hạng mục | v1 | v2.2 | Lý do |
|---|---|---|---|
| Phân bổ hạ tầng | % cố định chia đều cho mọi phút video, cho cả 6 capability | Gán theo **tác nhân chi phí**, tách cố định / biến đổi | v1 thu thiếu hạ tầng, điểm hoà vốn thực ~9.400–10.300 phút (review §2.1) |
| Nơi thu hạ tầng cố định | Rải qua 6 capability | **STT** theo giây video nguồn | Mọi job đều qua STT; job tóm tắt có output ngắn nên không thể thu qua RENDER |
| RENDER | Gánh 60% hạ tầng gồm cả Demucs | Chỉ FFmpeg + mix + lưu trữ output | Job phụ đề không phải trả hộ Demucs |
| Sản lượng mẫu số | 10.000 phút (toàn bộ hạ tầng) | 5.000 phút (**chỉ** phần cố định) | Thận trọng giai đoạn đầu, rủi ro chỉ nằm ở phần cố định |
| Markup | x, y cùng 25% | x 25% + 10% dự phòng lỗi; y **50%** | 25% là markup, biên gộp thực chỉ 4–14% (review §2.2) |
| Giá tham chiếu y | 1 bộ giá OpenAI (`gpt-4o-mini`) cho mọi thứ | Nhiều row theo `provider_scope` = model thật; seed hiện tại là `gpt-4o` | Giá chênh tới 17× giữa các model của cùng provider |
| Units TTS | 900 ký tự/phút | 1.000 ký tự/phút (cần đo) | Tiếng Việt dài hơn tiếng Anh |
| STT unit | Token hoặc giây (tuỳ provider) | Luôn giây | Tránh nhân cùng hệ số với 2 đơn vị khác nhau |
| Giá 10 phút dub (nền tảng) | 9.258đ (không thu Demucs, render gộp) | 13.409đ (`DUB_MIX`) / 12.584đ (`DUB_REPLACE`) | Thu đủ Demucs + markup y 50% + TTS 1.000 ký tự/phút |
| Giá 10 phút phụ đề | 4.546đ | 6.707đ | Phụ đề giờ trả đủ phần cố định của nó |
| Biên @ sản lượng kế hoạch | 4–14%, lệch giữa loại job | 17–22%, đồng đều | |
| Hoà vốn | ~9.400–10.300 phút | ~2.000–4.100 phút | |
| Credit khởi tạo | Đề xuất 200–300 | Giữ 100 (cân nhắc 150) | Chi phí thực + rủi ro lạm dụng (review §2.6) |
| Bảng câu hỏi | Q1–Q11 | Gom theo mức ưu tiên (§12); Q1, Q3, Q5, Q8, Q9 được giải bằng P1–P8 | |

### 13.4 Điểm mới (so với v1)

1. **Căn cứ trên project thật** (§3): provider seed là `gpt-4o` có phí; Demucs local; Piper chỉ để test.
2. **Capability `AUDIO_SEPARATION`** và cột `billing_unit`.
3. **Thứ tự khớp `provider_scope`** (`protocol/model` → `protocol` → `NULL`), row `NULL` theo model đắt nhất.
4. **Cơ cấu giá theo stage** (§7.4): TTS và STT chiếm ~86% giá job dub → đòn bẩy là chọn model TTS/STT.
5. **Bảng giá hiển thị Credit/phút** cho người dùng (§8), có tuỳ chọn giọng HD.
6. **Tái dùng STT + stems** cho ngôn ngữ thứ 2 (STT chỉ tính x).
7. **Chỉnh giá gói Credit** — gói Business hiện gần giá vốn.
8. **Chống trừ trùng** khi callback lặp (unique index trên `credit_transactions`).
9. **Chính sách rerun**: lỗi hệ thống không trừ lại.
10. **Danh sách thay đổi code/DB/docs** cụ thể (§11).
11. **Quản trị giá bởi Super Admin** (§10): API versioned, preview, coverage, audit, giá chốt theo job.

### 13.5 Tiếp thu từ `Credit_Pricing_Review.md`

| Mục review | Xử lý |
|---|---|
| §2.1 Mẫu số phân bổ | Giải quyết tận gốc bằng P1 (không cần vá bằng margin như phương án C) |
| §2.2 Markup ≠ biên | P5: y 50%, x có dự phòng; biên tính với P_eff 90đ và phí cổng 3% |
| §2.3 BYOK tiết kiệm ít | §7.5, bỏ thông điệp "rẻ hơn 3 lần"; BYOK nay có biên dương |
| §2.4 STT tính lại mỗi ngôn ngữ | P6 |
| §2.5 Ký tự/phút tiếng Việt | Nâng lên 1.000, đưa vào danh sách cần đo |
| §2.6 Chi phí Credit tặng | Giữ 100 Credit |
| §5 Phương án C (x theo 5.000 phút toàn bộ) | Thay bằng P2: chỉ phần **cố định** tính theo 5.000 phút → không đẩy giá phụ đề +65% |
| §6.1 Chiết khấu gói | P7 — nâng đơn giá tối thiểu trước khi chiết khấu |
| Không đề cập | Hạ tầng cố định/biến đổi, Demucs, `gpt-4o` trong seed, gói Business gần giá vốn, callback trùng, rerun |

---

## 14. Giả định & hạn chế

- Hạ tầng cố định 45$ và đơn giá biến đổi §6.2 là **ước lượng** để tổng khớp ngân sách 100$ ở 10.000 phút; phải thay bằng số đo sau 1 tháng chạy.
- Giá model là giá niêm yết theo hiểu biết hiện có, **chưa tra lại** trong tháng này.
- Biên gộp chưa tính thuế, nhân sự, marketing, hỗ trợ khách hàng.
- Kịch bản giả định mỗi loại job chiếm toàn bộ sản lượng; hỗn hợp thực tế sẽ nằm giữa các dòng.
- Chất lượng tiếng Việt của `tts-1` / `tts-1-hd` / `gpt-4o-mini-transcribe` chưa được đánh giá có hệ thống.

### Phụ lục — Công thức

```
Fixed_per_min  = Hạ_tầng_cố_định ÷ Sản_lượng_kế_hoạch
C_infra        = (Var_per_min + Fixed_per_min × 1{cap = STT}) ÷ Units_per_min
x              = C_infra  × (1 + margin_x) × (1 + dự_phòng) ÷ P
y              = C_market × (1 + margin_y) ÷ P
Credit_job     = Σ_stage [ x + y × 1{không BYOK} ] × units
Biên gộp       = (Credit_job × P_eff × (1 − phí_cổng) − AI − Var_infra − Fixed ÷ V_thực × phút_nguồn) ÷ (Credit_job × P_eff)
Hoà vốn (phút) = Fixed × phút_nguồn ÷ (Credit_job × P_eff × (1 − phí_cổng) − AI − Var_infra)
```
