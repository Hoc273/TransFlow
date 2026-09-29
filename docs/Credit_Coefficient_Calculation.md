# Tính toán Hệ số Credit (x, y) — TransFlow Media Studio

> **Phiên bản:** v2.4 (thay thế v2.3; v2.3 → v2.2 → v2.1 → v2 → DRAFT v1)
> **Trạng thái:** **ĐÃ CHỐT** model nền tảng (Q2) — 2026-09-27; bảng hệ số §7.2 và gói Credit §9 — 2026-09-28. Các mục còn mở và đề xuất xử lý ở [§12](#12-việc-cần-chốt--trạng-thái-và-đề-xuất).
> **Ngày:** 2026-09-24 (v2.2) · cập nhật 2026-09-27 (v2.3) · 2026-09-28 (v2.4)
> **Đầu vào:** `Khung_Tinh_Toan_He_So_Credit.docx`, `Credit_Coefficient_Calculation.md` v1/v2/v2.1, `Credit_Pricing_Review.md`, SRS §5.6 & §7.2, System_Architecture §10, Database_Design (`credit_pricing_config`), code `backend-main` / `backend-ai` hiện tại.
> **Ký hiệu:** ✅ đã chốt · ⚠️ giả định cần kiểm chứng · ❓ cần quyết định · 🆕 điểm mới so với v1

---

## 0. Tóm tắt điều hành

| Câu hỏi | Kết luận (v2.4 — đã chốt) |
|---|---|
| Hướng tính x | **Theo tác nhân chi phí (cost driver)**, không chia % hạ tầng đều cho mọi capability. Hạ tầng tách **cố định** (thu qua STT theo thời lượng video nguồn) và **biến đổi** (thu ở đúng stage gây ra chi phí). 🆕 |
| Hướng tính y | **Shadow price theo provider/model thật** qua `provider_scope` (OpenAI `gpt-4o`, `gpt-4o-mini`, `whisper-1`, `tts-1`, `tts-1-hd`, Qwen…), markup y **×2,25** (x **×2,0625**, P5). 🆕 |
| TTS | **Chỉ dùng TTS qua API.** Piper bị loại khỏi tính giá vì chỉ dùng local để test. Mặc định `tts-1`, cao cấp `tts-1-hd`. |
| Capability mới | **`AUDIO_SEPARATION`** (Demucs) tách khỏi RENDER — chỉ job `DUB_MIX` trả. 🆕 |
| Sản lượng tính x | **5.000 phút/tháng** (thận trọng), chỉ áp cho phần hạ tầng cố định, review hàng tháng. |
| Biên gộp tại sản lượng kế hoạch | **~48–52% ở giá lẻ 100đ, ~43–46% ở giá gói lớn nhất 90đ**, đồng đều giữa các loại job (v1: 4–14% và lệch nhau). Hoà vốn ở **~800–2.600 phút/tháng** (v1: ~9.400–10.300). |
| Giá hiển thị cho user | Phụ đề **~10,1 Credit/phút** · Lồng tiếng thay giọng **~18,9** · Lồng tiếng giữ nhạc nền **~20,1** · Giọng HD **~28,9** · Ngôn ngữ thứ 2 cùng video **~15,4**. |
| Gói Credit | ✅ Starter **2.500 Credit / 250.000đ** · Creator **5.250 / 500.000đ** · Business **10.000 / 900.000đ** — **1 Credit = 100đ** (đơn giá thấp nhất 90đ/Credit). |
| Credit khởi tạo | ✅ **100**, cấp 1 lần, không refill (giá vốn ~4.700đ/tài khoản). |
| Model nền tảng (Q2) | ✅ STT `whisper-1` · dịch/tóm tắt `gpt-4o-mini` (FreeLLMAPI ưu tiên, key trả phí dự phòng) · TTS `tts-1` · VISION `gpt-4o-mini`. **Chưa mở giọng HD** trong MVP. |
| Stage thu Credit | ✅ STT, TRANSLATE, SUMMARIZE_SCRIPT, TTS, VISION, AUDIO_SEPARATION, **RENDER** (RENDER thu x theo giây video output khi worker báo xong — 2026-09-27). |
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

Rút từ code/migration lúc soạn v2.2 (2026-09-24) — là căn cứ để chọn hướng. Trạng thái **sau khi chốt** (2026-09-27) ghi ở cột cuối.

| Hạng mục | Hiện trạng (v2.2) | Nguồn | Sau khi chốt (2026-09-27) |
|---|---|---|---|
| Provider nền tảng seed | 1 provider `openai_compatible` → `api.openai.com`, `default_model = gpt-4o`, capabilities `STT, TRANSLATE, TTS, VISION` — **có tính phí, không free** | `V2__init_indexes.sql` | ✅ `default_model = gpt-4o-mini` |
| Giọng TTS nền tảng seed | 8 giọng OpenAI (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`, `nova-vi`, `onyx-vi`) | `V2__init_indexes.sql` | Không đổi |
| Adapter AI Gateway hỗ trợ | OpenAI-compatible, Anthropic, DashScope (Qwen / Qwen-Omni), ElevenLabs, Google TTS, Azure TTS, Piper (local — **chỉ test**, D5) | `backend-ai/app/services/protocol/` | Không đổi |
| Tách âm | **Demucs local** (`htdemucs`, ưu tiên GPU, fallback CPU) — chạy khi `DUB_MIX` | `backend-ai/app/core/config.py` | Chỉ chạy STUDIO khi có GPU; fallback CPU không thu |
| Stage pipeline | `EXTRACT_AUDIO, SOURCE_SEPARATION, STT, SUMMARIZE, TRANSLATE, TTS, AUDIO_MIX, RENDER` | `MediaJobStage.StageName` | Không đổi |
| Stage đang trừ Credit | Chỉ STT, SUMMARIZE_SCRIPT, TRANSLATE, TTS, VISION | `MediaStageExecutionService.chargeAiUsage(...)` | ✅ Thêm AUDIO_SEPARATION và **RENDER** |
| Stage **không** trừ Credit | EXTRACT_AUDIO, SOURCE_SEPARATION, AUDIO_MIX, RENDER | như trên | ✅ Chỉ còn EXTRACT_AUDIO và AUDIO_MIX (chi phí gộp vào x của RENDER) |
| Đơn vị | STT: token nếu provider trả, không thì **giây**; TTS: **ký tự**; LLM: token | `MediaStageExecutionService.usageUnits()` | Không đổi (C6 chưa làm) |
| Tra cứu giá | Luôn `findActivePricing(capability, null)` — **bỏ qua `provider_scope`** | `CreditServiceImpl.chargeUsage()` | ✅ Resolver `protocol/model` → `protocol` → `NULL`, giá chốt theo `media_jobs.created_at` |
| Fallback hard-code | `DEFAULT_INFRA_X = 0.0001`, `DEFAULT_TOKEN_Y = 0.0005` | `CreditServiceImpl` | Vẫn còn (P8 chưa làm); `/coverage` báo `MISSING` |
| BYOK xác định theo | `job.createdByUserId` (không phải người thao tác) | `hasPersonalProvider()` | Không đổi (Q7/C9 còn mở) |
| Gói Credit seed | Starter 100đ/Credit · Creator 90đ · **Business 80đ** | `V2__init_indexes.sql` | ✅ 100đ / 95đ / 90đ |
| Credit khởi tạo | 100 (mặc định) | `AppProperties.Credit` | ✅ Giữ 100 |
| Ngôn ngữ đích | 1 `target_lang`/job; **không tái dùng transcript** giữa các job cùng video | Database_Design, `MediaJobServiceImpl` | Không đổi (P6 là Phase 2) |
| Mã lỗi credit đã dùng | 2300–2303 (tiếp theo trống: 2304) | `ErrorCode.java` | 2305, 2306 đã dùng; 2304 để dành cho P8 |

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
| `DUB_REPLACE` | **Thay toàn bộ** âm thanh gốc bằng giọng AI — nhạc nền, tiếng động mất theo (tóm tắt có giọng đọc) | TTS | TTS |
| `DUB_MIX` — FAST | **Voice-over**: giọng AI đè lên toàn bộ audio gốc (gốc −10 dB, giọng +10 dB mặc định) | TTS, AUDIO_MIX | TTS |
| `DUB_MIX` — STUDIO | Tách giọng người nói khỏi nhạc nền, bỏ giọng gốc, **trộn giọng AI với nhạc nền gốc** (cần GPU) | SOURCE_SEPARATION, TTS, AUDIO_MIX | TTS + AUDIO_SEPARATION |

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
| x | ×1,25 | **×1,875 × 1,10 = ×2,0625** | +10% dự phòng cho stage FAILED/retry do hệ thống (đã tiêu tài nguyên nhưng không thu) 🆕 |
| y | ×1,25 | **×2,25** | Markup 25% chỉ cho biên gộp 4–14% (review §2.2); mức ×2,25 cho biên ~45–50% ở sản lượng kế hoạch, vẫn rẻ hơn đối thủ quốc tế rẻ nhất (HeyGen ~6.200đ/phút) ~3 lần |

### P6 — Tái dùng STT & stems khi dịch cùng video sang ngôn ngữ khác 🆕 (Phase 2)

Hiện mỗi job = 1 video × 1 ngôn ngữ, STT (và Demucs) chạy lại từng lần. Đề xuất: job ngôn ngữ thứ 2+ của cùng `media_asset` tái dùng transcript và stems đã có:
- STT: **chỉ tính x** (vẫn thu phần hạ tầng cố định), **y = 0** vì không gọi provider.
- AUDIO_SEPARATION: không tính (không chạy lại).

Cần bổ sung SRS/thiết kế (khoá tái dùng theo `media_asset_id` + checksum + STT model). Bảng giá đã tính sẵn kịch bản này.

### P7 — Giá gói Credit tối thiểu 90đ/Credit 🆕

Giá vốn bình quân ở sản lượng kế hoạch ≈ **46–47đ/Credit**, cộng phí cổng thanh toán ~3%. Chiết khấu sâu hơn 90đ/Credit làm biên giảm nhanh khi sản lượng thấp. Biên ở §7 được tính với **giá bán thấp nhất 90đ/Credit** (kịch bản xấu nhất).

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
| Markup x | ×2,0625 (87,5% + 10% dự phòng) | ✅ |
| Markup y | ×2,25 | ✅ |
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

x(cap)        = C_infra(cap)         × 2,0625 ÷ P
y(cap, scope) = C_market(cap, scope) × 2,25   ÷ P
```

x chỉ phụ thuộc capability (hạ tầng không đổi theo provider); y phụ thuộc capability + `provider_scope`.

### 7.2 Bảng hệ số (`credit_pricing_config`)

| Capability | `provider_scope` | `billing_unit` | C_infra (đ) | C_market (đ) | **x** | **y** |
|---|---|---|---|---|---|---|
| STT | `openai_compatible` 🆕 | AUDIO_SECOND | 3,9500 | 2,60000 | **0.081469** | **0.058500** |
| STT | `openai_compatible/whisper-1` | AUDIO_SECOND | 3,9500 | 2,60000 | **0.081469** | **0.058500** |
| STT | `openai_compatible/gpt-4o-mini-transcribe` | AUDIO_SECOND | 3,9500 | 1,30000 | **0.081469** | **0.029250** |
| STT | `NULL` (mặc định) | AUDIO_SECOND | 3,9500 | 2,60000 | **0.081469** | **0.058500** |
| TRANSLATE | `openai_compatible/gpt-4o` | TOKEN | 0,0005 | 0,16250 | **0.000010** | **0.003656** |
| TRANSLATE | `openai_compatible/gpt-4o-mini` | TOKEN | 0,0005 | 0,00975 | **0.000010** | **0.000219** |
| TRANSLATE | `openai_compatible` 🆕 (FreeLLMAPI `auto`, model OpenAI-compatible chưa khai báo) | TOKEN | 0,0005 | 0,00975 | **0.000010** | **0.000219** |
| TRANSLATE | `dashscope_native/qwen-plus` | TOKEN | 0,0005 | 0,02080 | **0.000010** | **0.000468** |
| TRANSLATE | `NULL` | TOKEN | 0,0005 | 0,16250 | **0.000010** | **0.003656** |
| SUMMARIZE_SCRIPT | `openai_compatible/gpt-4o` | TOKEN | 0,0005 | 0,10400 | **0.000010** | **0.002340** |
| SUMMARIZE_SCRIPT | `openai_compatible/gpt-4o-mini` | TOKEN | 0,0005 | 0,00624 | **0.000010** | **0.000140** |
| SUMMARIZE_SCRIPT | `openai_compatible` 🆕 | TOKEN | 0,0005 | 0,00624 | **0.000010** | **0.000140** |
| SUMMARIZE_SCRIPT | `dashscope_native/qwen-plus` | TOKEN | 0,0005 | 0,01456 | **0.000010** | **0.000328** |
| SUMMARIZE_SCRIPT | `NULL` | TOKEN | 0,0005 | 0,10400 | **0.000010** | **0.002340** |
| TTS | `openai_compatible` 🆕 | CHARACTER | 0,0020 | 0,39000 | **0.000041** | **0.008775** |
| TTS | `openai_compatible/tts-1` | CHARACTER | 0,0020 | 0,39000 | **0.000041** | **0.008775** |
| TTS | `openai_compatible/tts-1-hd` | CHARACTER | 0,0020 | 0,78000 | **0.000041** | **0.017550** |
| TTS | `NULL` | CHARACTER | 0,0020 | 0,78000 | **0.000041** | **0.017550** |
| VISION | `openai_compatible` 🆕 | TOKEN | 0,0050 | 0,00507 | **0.000103** | **0.000114** |
| VISION | `openai_compatible/gpt-4o-mini` | TOKEN | 0,0050 | 0,00507 | **0.000103** | **0.000114** |
| VISION | `openai_compatible/gpt-4o` | TOKEN | 0,0050 | 0,08450 | **0.000103** | **0.001901** |
| VISION | `NULL` | TOKEN | 0,0050 | 0,08450 | **0.000103** | **0.001901** |
| AUDIO_SEPARATION 🆕 | `NULL` | AUDIO_SECOND | 1,0000 | 0 | **0.020625** | **0.000000** |
| RENDER | `NULL` | VIDEO_SECOND | 1,2500 | 0 | **0.025781** | **0.000000** |

- ✅ Áp dụng qua `/api/platform/pricing` (§10): mỗi row là một version giá do Super Admin tạo, không viết migration. `V2__init_indexes.sql` chỉ là bộ giá khởi tạo ban đầu; `V3__platform_provider_and_credit_packages.sql` đã đóng 8 row theo model trùng giá với row protocol (STT `openai_compatible/whisper-1`, `openai_compatible/gpt-4o-mini-transcribe`; TRANSLATE, SUMMARIZE_SCRIPT, VISION `openai_compatible/gpt-4o-mini`; TRANSLATE, SUMMARIZE_SCRIPT `dashscope_native/qwen-plus`; TTS `openai_compatible/tts-1`) — thiếu các row này resolver rơi xuống row protocol hoặc `NULL`, không bao giờ bán rẻ hơn giá thật. Còn lại **16 row** đang hiệu lực.
- Row theo **protocol** `openai_compatible` 🆕 (v2.3): model ghi nhận khi tính giá là `default_model` của key nền tảng (một key phục vụ nhiều capability), nên scope thực tế có thể là `openai_compatible/auto` (FreeLLMAPI) hoặc `openai_compatible/gpt-4o-mini` cho cả STT/TTS. Row protocol bắt các trường hợp này với giá model đang dùng; row `NULL` vẫn theo model đắt nhất cho protocol lạ (P4). Rủi ro: model OpenAI-compatible đắt nhưng chưa khai báo sẽ bị tính giá rẻ, nên Super Admin phải thêm row `protocol/model` khi bật model mới (`/coverage` hiện `PROTOCOL`).
- DashScope dùng protocol `dashscope_native` (đúng giá trị CHECK của `user_ai_providers.protocol`), không phải `dashscope`.
- STT tái dùng (P6): áp x của STT, bỏ qua y (không có row riêng, xử lý trong code).
- `NUMERIC(10,6)` đủ chính xác cho mọi giá trị trên (x TRANSLATE = 0.000010 lệch < 3% so với 0.00001031 — không đáng kể vì x TRANSLATE chỉ chiếm < 0,1% giá job).

### 7.3 Giá job mẫu & biên gộp

Giả định chung: STT `whisper-1`, dịch `gpt-4o-mini`, TTS `tts-1` (trừ khi ghi khác); mọi job đều gồm RENDER (giây output). Biên gộp = (Credit × P_eff × 0,97 − chi phí AI − hạ tầng biến đổi − hạ tầng cố định chia theo sản lượng thực) ÷ (Credit × P_eff). Tính cho **hai mức giá bán**: 100đ (Starter, giá lẻ) và 90đ (Business, giá thấp nhất). Tính lại bằng script ngày 2026-09-28.

| Kịch bản | Nguồn AI | Credit | Credit/phút | Giá @100đ | Chi phí AI | Biên @100đ — 3.000 / 5.000 / 10.000 phút | Biên @90đ — 3.000 / 5.000 / 10.000 phút | Hoà vốn @90đ (phút/tháng) |
|---|---|---|---|---|---|---|---|---|
| 10 phút phụ đề | Nền tảng | 100,6 | 10,06 | 10.060đ | 1.609đ | 34,5% / 50,0% / 61,6% | 27,5% / 44,7% / 57,7% | ~1.800 |
| 10 phút phụ đề | BYOK | 64,4 | 6,44 | 6.441đ | 0 | 24,3% / 48,5% / 66,7% | 16,2% / 43,1% / 63,3% | ~2.400 |
| 10 phút phụ đề (dịch `gpt-4o`) | Nền tảng | 117,8 | 11,78 | 11.780đ | 2.372đ | 37,1% / 50,4% / 60,3% | 30,5% / 45,2% / 56,2% | ~1.600 |
| 10 phút `DUB_REPLACE` / `DUB_MIX` FAST | Nền tảng | 188,8 | 18,88 | 18.876đ | 5.509đ | 42,9% / 51,2% / 57,4% | 36,9% / 46,1% / 53,0% | ~1.150 |
| 10 phút `DUB_REPLACE` / `DUB_MIX` FAST | BYOK | 64,8 | 6,48 | 6.482đ | 0 | 24,4% / 48,5% / 66,6% | 16,4% / 43,1% / 63,2% | ~2.400 |
| **10 phút `DUB_MIX` STUDIO** (ví dụ dùng khi pitching) | Nền tảng | **201,1** | 20,11 | **20.114đ** | **5.509đ** | 43,2% / **51,0%** / 56,8% | 37,3% / **45,9%** / 52,4% | ~1.100 |
| 10 phút `DUB_MIX` STUDIO | BYOK | 77,2 | 7,72 | 7.719đ | 0 | 28,3% / 48,5% / 63,7% | 20,7% / 43,1% / 60,0% | ~2.200 |
| 10 phút `DUB_MIX` STUDIO, giọng `tts-1-hd` | Nền tảng | 288,9 | 28,89 | 28.888đ | 9.409đ | 46,1% / 51,5% / 55,5% | 40,4% / 46,4% / 50,9% | ~800 |
| 10 phút `DUB_MIX` STUDIO, STT `gpt-4o-mini-transcribe` | Nền tảng | 183,6 | 18,36 | 18.358đ | 4.729đ | 42,4% / 50,9% / 57,2% | 36,3% / 45,7% / 52,8% | ~1.200 |
| Ngôn ngữ thứ 2, cùng video (P6, Phase 2) | Nền tảng | 153,7 | 15,37 | 15.366đ | 3.949đ | 40,9% / 51,0% / 58,7% | 34,7% / 45,9% / 54,4% | ~1.350 |
| 30 phút `DUB_MIX` STUDIO (tối đa) | Nền tảng | 603,4 | 20,11 | 60.339đ | 16.526đ | 43,2% / 51,0% / 56,8% | 37,3% / 45,9% / 52,4% | ~1.100 |
| 10 phút tóm tắt + VLM (output 3 phút) | Nền tảng | 91,6 | 9,16 | 9.156đ | 1.642đ | 33,1% / 50,2% / 62,9% | 26,0% / 44,9% / 59,1% | ~1.950 |
| 10 phút tóm tắt + VLM | BYOK | 54,6 | 5,46 | 5.462đ | 0 | 20,0% / 48,5% / 69,9% | 11,4% / 43,1% / 66,9% | ~2.600 |

**Đọc kết quả:**
- Ở sản lượng kế hoạch 5.000 phút: biên **48–52% ở giá lẻ 100đ**, **43–46% ở giá Business 90đ**, đồng đều giữa các loại job vì mỗi loại chỉ trả đúng chi phí nó gây ra (v1: phụ đề 4%, dub 14%).
- Job dub có y lớn (TTS) nên hoà vốn sớm nhất (~800–1.200 phút); job BYOK và phụ đề hoà vốn muộn nhất (~1.800–2.600 phút).
- BYOK có biên dương ở mọi mức sản lượng từ 3.000 phút.
- Dưới ~800–2.600 phút/tháng vẫn lỗ phần cố định; chấp nhận ở giai đoạn đầu.
- Biên tăng theo sản lượng vì phần cố định được chia mỏng hơn: ở 10.000 phút, job dub đạt ~51–57%. Đây là dư địa để chiết khấu hoặc hạ x qua version giá mới.
- Nếu không thu RENDER (như code trước 2026-09-27), job 10 phút `DUB_MIX` STUDIO chỉ thu 185,6 Credit (−7,7%).

### 7.4 Cơ cấu giá một job 10 phút `DUB_MIX` (nền tảng, 201,1 Credit)

| Stage | Credit | Tỷ trọng | Thành phần chính |
|---|---|---|---|
| TTS (`tts-1`, 10.000 ký tự) | 88,2 | 44% | y (chi phí OpenAI) |
| STT (`whisper-1`, 600 giây) | 84,0 | 42% | x 48,9 (hạ tầng cố định) + y 35,1 |
| RENDER (600 giây) | 15,5 | 8% | x |
| AUDIO_SEPARATION (600 giây) | 12,4 | 6% | x |
| TRANSLATE (`gpt-4o-mini`, 5.000 token) | 1,2 | < 1% | y |

→ Hai đòn bẩy giảm giá: **model TTS** và **model STT** (`gpt-4o-mini-transcribe` giảm ~9% giá job dub). Model dịch gần như không ảnh hưởng.

### 7.5 BYOK thực sự tiết kiệm bao nhiêu? 🆕

| Job 10 phút `DUB_MIX` | Nền tảng | BYOK (phí nền tảng + hoá đơn provider theo giá niêm yết) | Tiết kiệm |
|---|---|---|---|
| Giọng `tts-1` | 20.114đ | 7.719đ + 5.509đ = 13.228đ | ~34% |
| Giọng `tts-1-hd` | 28.888đ | 7.719đ + 9.409đ = 17.128đ | ~41% |

→ Không quảng bá "BYOK rẻ hơn 3 lần". Định vị BYOK: dùng provider/giọng riêng (ElevenLabs, Google, Azure…), tận dụng free tier/hạn mức sẵn có, kiểm soát chi phí AI.

---

## 8. Giá hiển thị cho người dùng 🆕

Hệ số x, y là nội bộ; UI nên hiển thị **Credit/phút video** theo loại job (và **ước tính trước khi chạy** — Q10). Giá dưới đây là khi dùng nguồn AI nền tảng:

| Loại job | Credit / phút | ≈ VNĐ / phút |
|---|---|---|
| Phụ đề (dịch) | ~10,1 | ~1.010đ |
| Lồng tiếng — thay giọng (`DUB_REPLACE`) | ~18,9 | ~1.890đ |
| Lồng tiếng — giữ nhạc nền (`DUB_MIX`) | ~20,1 | ~2.010đ |
| Lồng tiếng giọng HD (`tts-1-hd`, giữ nhạc nền) | ~28,9 | ~2.890đ |
| Thêm ngôn ngữ cho video đã xử lý (P6) | ~15,4 | ~1.540đ |
| Tóm tắt video + phân tích hình ảnh | ~9,2 / phút nguồn | ~920đ |
| Mọi loại job khi dùng BYOK | ~5,5–7,7 | ~550–770đ (chưa gồm hoá đơn provider của user) |

Với gói Starter (2.500 Credit / 250.000đ): ~24 video 10 phút phụ đề, hoặc ~12 video 10 phút lồng tiếng giữ nhạc nền, hoặc ~8 video lồng tiếng HD.

---

## 9. Gói Credit & Credit khởi tạo 🆕

### 9.1 Gói Credit

| Gói | ✅ Đã chốt (`V3__platform_provider_and_credit_packages.sql`, 2026-09-28) | Đơn giá | Lồng tiếng giữ nhạc nền / phụ đề |
|---|---|---|---|
| Starter | **2.500 Credit / 250.000đ** (~$10) | 100đ | ~125 / ~250 phút |
| Creator | **5.250 Credit / 500.000đ** (~$20) | ~95đ (tiết kiệm 5%) | ~260 / ~520 phút |
| Business | **10.000 Credit / 900.000đ** (~$35) | 90đ (tiết kiệm 10%) | ~495 / ~995 phút |

- **1 Credit = 100đ** (giá niêm yết).
- `V3` tắt (`is_active = false`) các gói seed ở `V2` (500/50.000đ · 2.000/190.000đ · 10.000/900.000đ) và thêm gói trên; không sửa/xoá gói cũ vì `credit_package_purchases` còn tham chiếu.
- Gói Credit **chưa có màn hình Super Admin**: đổi gói = migration mới + cập nhật `frontend/src/locales/{vi,en,ko}/landing.json`.
- Giá vốn bình quân ~46–47đ/Credit ở 5.000 phút → gói Business 90đ vẫn giữ biên ~45% sau phí cổng 3%.

### 9.2 Credit khởi tạo

- ✅ Chốt **100 Credit** (≈ 1 video 10 phút phụ đề, hoặc ~5 phút lồng tiếng giữ nhạc nền), chi phí thực tối đa ~4.700đ/tài khoản.
- Chỉ nâng lên 150–300 khi có chống lạm dụng nhiều tài khoản (xác minh email/số điện thoại, giới hạn thiết bị).
- ❓ Nếu muốn người dùng mới trải nghiệm trọn 1 video 10 phút lồng tiếng, cần ~201 Credit → cân nhắc 210 (`APP_CREDIT_INITIAL_GRANT_AMOUNT`); chi phí thực ~9.900đ/tài khoản.

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
  "infraCoefficientX": 0.000041,
  "tokenCoefficientY": 0.008775,
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

### 10.6 Cấu hình giá cho provider/model mới (FreeLLMAPI, Azure TTS…) 🆕

Giá **không** nằm trong màn hình AI Provider; màn hình đó chỉ lưu `protocol`, key và `default_model`. Khi stage chạy, hệ thống ghi `provider_scope = protocol/default_model` (chữ thường) của provider đã dùng rồi tìm giá theo thứ tự P4: `protocol/model` → `protocol` → `NULL` (row mặc định = model đắt nhất).

| Provider | Scope thực tế | Hiện khớp row | Muốn giá riêng |
|---|---|---|---|
| FreeLLMAPI (`openai_compatible`, model `auto`) | `openai_compatible/auto` | row protocol `openai_compatible` (= giá `gpt-4o-mini`) | tạo row `TRANSLATE` và `SUMMARIZE_SCRIPT` scope `openai_compatible/auto` |
| Azure TTS (`azure_speech`, model mặc định `azure-neural-tts`; adapter không dùng model, giọng chọn theo voice) | `azure_speech/azure-neural-tts` | row `NULL` của TTS (= giá `tts-1-hd`, đắt ~1,9 lần Azure) | tạo row `TTS` scope `azure_speech` (áp mọi key Azure) |
| Google Cloud TTS (`google_speech`, `google-cloud-tts`) | `google_speech/google-cloud-tts` | row `NULL` của TTS | tạo row `TTS` scope `google_speech` |

Giá tham chiếu (tra 2026-09-28, ⚠️ nguồn tổng hợp): Azure Neural **$16/1M ký tự** → C_market = 0,416đ/ký tự → y = 0,416 × 2,25 ÷ 100 = **0.009360**, x = **0.000041** (x chung của TTS). Azure Neural HD ($22/1M) → y = **0.012870**. Adapter không phân biệt model nên muốn tính giá HD riêng thì tạo provider Azure thứ hai với `default_model` là nhãn khác (ví dụ `azure-neural-hd`) và row scope `azure_speech/azure-neural-hd`.

Sau khi thêm provider: mở tab **Coverage** — *Matched by* phải là `EXACT` hoặc `PROTOCOL`; `DEFAULT` nghĩa là đang tính theo giá model đắt nhất của capability.

---

## 11. Thay đổi cần làm trong code / DB / docs

> **Đã làm (2026-09-26):** C8 (truyền `protocol/model` vào `chargeUsage`), C13 (cột `created_by_user_id`/`change_reason` + index `ux_credit_pricing_open`, nay nằm trong baseline `V1`/`V2`), C14, C15, C16, C18, một phần C5 (resolver `protocol/model` → `protocol` → `NULL`; **vẫn giữ** fallback hard-code, hiện ở `/coverage` là `MISSING`), D3/D4 (mã 2305, 2306; 2304 để dành), D5, T2. Chưa làm: C1–C4, C6, C9–C12, C17.
>
> **Đã làm (2026-09-27):** một phần C1 + C7 cho `AUDIO_SEPARATION` — CHECK `capability`/`operation` có `AUDIO_SEPARATION`, seed row mặc định x = 0.013750, y = 0 (§7.2); `MediaStageExecutionService` kiểm tra đủ credit trước và trừ sau khi Demucs trả kết quả, đơn vị = giây audio nguồn, luôn x-only (`hasPersonalApiKey=false`); **không** thu khi backend-ai chạy fallback CPU (`engine.engineVersion = cpu-fallback`). Job type `DUB_STUDIO` trong bảng xem trước giá. `RENDER` vẫn chưa thu; cột `billing_unit` chưa thêm.

> **Đã làm (2026-09-27, chốt giá):** C3 (gói Creator 190.000đ, Business 900.000đ), C4 (provider seed `default_model = gpt-4o-mini`), seed 24 row giá §7.2 kèm `change_reason`, **C7 cho RENDER** (kiểm tra đủ Credit trước khi dispatch theo thời lượng output dự kiến; trừ x-only theo `outputRef.mediaProbe.durationMs` khi callback COMPLETED, dưới khoá job nên callback trùng không trừ lại; không đủ Credit lúc callback → stage `FAILED` mã `INSUFFICIENT_CREDIT`, không công bố output), **C6** (STT luôn tính theo giây audio kể cả khi provider trả token; sửa lỗi clip < 1 giây bị tính theo mili-giây), bảng xem trước giá của Super Admin gồm RENDER. Chưa làm: C1 (cột `billing_unit`), C2, C5 (bỏ fallback), C9–C12, C17.

| # | Hạng mục | Thay đổi | Liên quan |
|---|---|---|---|
| C1 | DB — migration mới `V3__credit_pricing_v2.sql` | `ADD COLUMN billing_unit VARCHAR NOT NULL` (CHECK `AUDIO_SECOND, VIDEO_SECOND, TOKEN, CHARACTER`); mở CHECK `capability` thêm `AUDIO_SEPARATION`; đóng row cũ (`effective_to = now()`); insert row §7.2 | P1–P4 |
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

## 12. Việc cần chốt — trạng thái và đề xuất

> Quy ước: `[x]` đã chốt (ghi ngày) · `[ ]` còn mở, kèm **Đề xuất** của người soạn và dòng **Chốt** để nhóm điền.

### 12.1 Đã chốt (2026-09-27)

- [x] **Q2 — Provider/model nền tảng:** STT `whisper-1`; TRANSLATE/SUMMARIZE `gpt-4o-mini` (FreeLLMAPI ưu tiên, key trả phí dự phòng); TTS `tts-1`; VISION `gpt-4o-mini`. Seed provider đổi `gpt-4o` → `gpt-4o-mini`.
- [x] **P1/P2 — Hạ tầng theo tác nhân chi phí:** cố định 45 USD/tháng thu qua x của STT; biến đổi thu ở đúng stage (§6.2).
- [x] **P3 — Capability `AUDIO_SEPARATION`:** x = 0.020625, y = 0; chỉ `DUB_MIX` STUDIO trả; fallback CPU không thu.
- [x] **RENDER có thu Credit:** x = 0.025781/giây video output, y = 0 (C7).
- [x] **P5 — Markup:** x ×2,0625 (87,5% + 10% dự phòng lỗi), y ×2,25 (2026-09-28).
- [x] **Q6 — Sản lượng kế hoạch:** 5.000 phút/tháng, review hằng tháng.
- [x] **P7 — Gói Credit** (2026-09-28): Starter 2.500/250.000đ · Creator 5.250/500.000đ · Business 10.000/900.000đ.
- [x] **Giọng HD:** **chưa mở** trong MVP. Row `openai_compatible/tts-1-hd` đã có sẵn để bật sau, không cần đổi giá.
- [x] **Q4 — Credit khởi tạo:** 100, cấp 1 lần.
- [x] **Nguồn API miễn phí (FreeLLMAPI)** (2026-09-25): dùng cả production, tier FREE, priority 10, capability TRANSLATE; tính theo giá bóng. v2.3: giá bóng áp qua row protocol `openai_compatible` (= giá `gpt-4o-mini`) vì scope thực tế là `openai_compatible/auto`.

### 12.2 Còn mở — ưu tiên cao (ảnh hưởng doanh thu hoặc hành vi với khách)

- [ ] **Q10 — Hành vi khi không đủ Credit** (SRS §5.6 còn ghi "cần xác nhận")
  - **Đề xuất:** MVP giữ cơ chế đang chạy: **kiểm tra trước mỗi stage** (ước tính theo thời lượng/ký tự/token) và chặn trước khi gọi provider. Khi đó job `FAILED` với `INSUFFICIENT_CREDIT`; khách nạp thêm rồi *chạy lại từ stage đó*, không trả lại phần đã xong. Không cho nợ. Bổ sung **hiển thị ước tính Credit trước khi tạo job** (C17 `/api/credit/rates`). Việc giữ trước Credit (pre-authorize, cần bảng hold/release) để Phase 2.
  - Lý do: đã chặn được nợ chi phí AI mà không cần thêm bảng. Lời thoại pitching "hết Credit thì chặn tạo job mới" vẫn đúng.
  - **Chốt:** ______
- [ ] **Chính sách rerun**
  - **Đề xuất:** Credit chỉ trừ **sau khi** stage COMPLETED, nên stage lỗi do hệ thống (timeout, worker crash, lỗi provider) **tự nhiên không bị trừ**. Việc còn lại là ghi rõ vào SRS: rerun do người dùng chủ động (sửa bản dịch, đổi giọng) → trừ lại **đúng stage chạy lại và các stage sau nó**; không trừ lại stage trước (khớp lời thoại "không tính phí lại phần đã làm").
  - **Chốt:** ______
- [ ] **P8 — Chặn job khi thiếu cấu hình giá** (bỏ fallback hard-code x = 0.0001, y = 0.0005)
  - **Đề xuất:** làm ngay. Sau khi seed, cả 7 capability đều có row `NULL`, nên fallback chỉ còn tác dụng *che lỗi cấu hình* và bán gần như miễn phí (fallback rẻ hơn giá thật ~100 lần với TTS). Thiếu row → mã `2304 PRICING_CONFIG_MISSING` trước khi dispatch.
  - **Chốt:** ______
- [ ] **Q7 — "Người trực tiếp thực hiện" khi Lead rerun/confirm job của Member**
  - **Đề xuất:** MVP coi **người tạo job** là người thực hiện cho mọi stage của job (như code hiện tại) và ghi rõ vào SRS. Lý do: một job chỉ dùng một nguồn key (BYOK hay nền tảng), tránh trường hợp giọng TTS hoặc provider đổi giữa chừng khi Lead bấm rerun. Tách theo người bấm (`triggered_by_user_id`, C9) để Phase 2.
  - **Chốt:** ______

### 12.3 Còn mở — ưu tiên trung bình

- [ ] **Tìm TTS API rẻ hơn cho tiếng Việt**
  - TTS chiếm ~44% giá job dub (§7.4), là đòn bẩy giá lớn nhất.
  - **Đề xuất:** thử nghe 20 câu mẫu tiếng Việt trên Google Cloud TTS (Standard/WaveNet `vi-VN`) và Azure Neural (`vi-VN-HoaiMyNeural`) ⚠️ tra lại giá niêm yết trước khi so. Nếu chất lượng tương đương `tts-1` mà rẻ hơn ≥ 40%, bật làm provider nền tảng mặc định với row giá riêng (không cần sửa code).
  - **Chốt:** ______
- [ ] **Quản trị giá — maker–checker?**
  - **Đề xuất:** **1 Super Admin là đủ** ở quy mô hiện tại. Giữ ngưỡng xác nhận ±50%, version không hồi tố và audit như §10. Chỉ cần 2 người duyệt khi có nhiều hơn 2 Super Admin.
  - **Chốt:** ______
- [ ] **C2 — Chống trừ trùng ở tầng DB** (unique index `credit_transactions(ref_type, ref_id)` cho `AI_USAGE`)
  - **Đề xuất:** làm ở đợt sau. Hiện đã chống trùng ở tầng nghiệp vụ: RENDER trừ dưới khoá job và bỏ qua callback khi stage đã kết thúc; stage AI bỏ qua message có `correlationId` cũ. Index DB là lớp bảo vệ thứ hai, cần thêm `ref_id` = stage id + lần chạy.
  - **Chốt:** ______
- [ ] **C1 — Cột `billing_unit`**
  - **Đề xuất:** làm cùng C2. Hiện đơn vị được cố định trong code theo capability (§4.2, đã có test), nên chưa gây sai tiền; cột này giúp Super Admin nhìn rõ đơn vị khi sửa giá.
  - **Chốt:** ______

### 12.4 Phase 2 / ưu tiên thấp

- [ ] **P6 — Tái dùng STT + stems giữa các ngôn ngữ**
  - **Đề xuất:** Phase 2, sau khi có dữ liệu bao nhiêu % video được dịch sang ≥ 2 ngôn ngữ. Giảm ~24% giá ngôn ngữ thứ 2 (§7.3), là điểm bán tốt cho studio.
  - **Chốt:** ______
- [ ] **Q11 — Phí tối thiểu mỗi job**
  - **Đề xuất:** **không áp**. Video tối thiểu vẫn trả x + y của STT (~0,14 Credit/giây), và upload giới hạn ≤ 30 phút nên không có job "rỗng" đáng kể.
  - **Chốt:** ______
- [ ] **Hệ số RENDER theo độ phân giải**
  - **Đề xuất:** chưa cần. Retention file 3 ngày nên chi phí lưu trữ output nhỏ hơn giả định §6.2 (14 ngày). Xem lại khi cho render 4K.
  - **Chốt:** ______

### 12.5 Dữ liệu cần đo / xác minh (trước khi review giá lần 1, dự kiến cuối tháng 10/2026)

- [ ] CPU-time mỗi stage / phút video (Demucs GPU, render) trên VPS thật → thay số §6.2.
- [ ] Chi phí hạ tầng cố định thực tế (VPS 4 vCPU/8 GB + lưu trữ + backup) so với giả định 45 USD. Retention 3 ngày → phần lưu trữ có thể thấp hơn.
- [ ] Ký tự TTS / phút và token dịch / phút cho tiếng Việt → thay số §6.3 (hiện giả định 1.000 ký tự và 500 token).
- [ ] Tra lại giá niêm yết các model ở §6.4.
- [ ] Phí cổng thanh toán thực tế và thuế (hiện giả định 3%) — nhờ kế toán xác nhận.
- [ ] Giá đối thủ nội địa trước khi quảng bá giá phụ đề cho creator nhỏ.

---

## 13. Thay đổi so với các bản trước & điểm mới

### 13.0a v2.3 → v2.4 (bản này, 2026-09-28)

| Hạng mục | v2.3 | v2.4 |
|---|---|---|
| Markup (P5) | x ×1,375, y ×1,50 | **x ×2,0625, y ×2,25**; bảng §7.2 áp qua Super Admin |
| Gói Credit | 500/50k · 2.000/190k · 10.000/900k | **2.500/250k · 5.250/500k · 10.000/900k** (`V3__platform_provider_and_credit_packages.sql`), 1 Credit = 100đ |
| Row giá theo model | 24 row | `V3` đóng 8 row trùng giá với row protocol, còn 16 row |
| Mới | — | §10.6 cấu hình giá cho FreeLLMAPI / Azure / Google TTS |

### 13.0 v2.2 → v2.3 (2026-09-27)

| Hạng mục | v2.2 | v2.3 |
|---|---|---|
| Trạng thái | Đề xuất | **Đã chốt** Q2, P1/P2, P3, P5, Q6, P7, Q4, giọng HD (chưa mở), RENDER có thu |
| Row giá theo protocol | Không có | Thêm `openai_compatible` cho STT/TRANSLATE/SUMMARIZE/TTS/VISION (bắt FreeLLMAPI `auto` và key nền tảng dùng chung model) |
| DashScope scope | `dashscope/qwen-plus` | `dashscope_native/qwen-plus` (đúng giá trị protocol trong hệ thống) |
| Biên §7.3 | Chỉ tính ở 90đ | Tính cả 100đ và 90đ, tính lại bằng script (lệch ≤ 1 điểm %) |
| Code | RENDER chưa thu; STT có thể bị tính theo token | RENDER thu x theo giây output; STT luôn tính theo giây |
| §12 | Danh sách câu hỏi | Tách đã chốt / còn mở, mỗi mục còn mở có **đề xuất** |
| Mới | — | §15 số liệu cho kịch bản Pitching Day |

### 13.1 v2.1 → v2.2

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
| §2.2 Markup ≠ biên | P5: y ×2,25, x có dự phòng; biên tính với P_eff 90đ và phí cổng 3% |
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

---

## 15. Số liệu dùng cho kịch bản Pitching Day 🆕

Đồng bộ với `TransFlow_Kich_ban_Pitching_Day (1).docx` mục 7, 11 và Phụ lục A, C, D (cập nhật 2026-09-27).

### 15.1 Ví dụ 1 video (mục 7)

Video 10 phút, lồng tiếng giữ nhạc nền (`DUB_MIX` STUDIO), dùng AI nền tảng: **201 Credit ≈ 20.100đ** ở giá lẻ; chi phí AI thực tế **≈ 5.500đ**; biên gộp sau AI, hạ tầng và phí thanh toán **≈ 51%** (giá lẻ) / **≈ 46%** (gói Business) ở 5.000 phút/tháng, lên **≈ 57%** ở 10.000 phút. Cùng video trên ElevenLabs API: ~86.000–130.000đ (0,33–0,50 USD/phút ⚠️ giá bên thứ ba).

### 15.2 Số vốn gọi (mục 11, Phụ lục A) — runway 12 tháng

| Hạng mục | Cách ước tính | Chi phí/tháng | Số tháng | Thành tiền |
|---|---|---|---|---|
| Nhân sự | 5 người × 6 triệu | 30 triệu | 12 | 360 triệu |
| AI cho dùng thử & pilot | 2.000 tài khoản × 100 Credit × ~47đ giá vốn; 10 pilot × 600 phút × ~690đ | — | — | 15 triệu |
| Máy chủ, lưu trữ | VPS + lưu trữ + backup, dư địa lên GPU | 2,5 triệu | 12 | 30 triệu |
| Marketing | Nội dung, sự kiện nhỏ, quà Credit cho creator | 10 triệu | 12 | 120 triệu |
| Pháp lý & thanh toán | Đăng ký doanh nghiệp, cổng thanh toán, điều khoản | — | 1 lần | 20 triệu |
| Dự phòng | 20% | — | — | 109 triệu |
| **Tổng** | | | | **≈ 655 triệu → gọi 650–700 triệu đồng (≈ 25.000–27.000 USD)** |

Chi phí AI và hạ tầng biến đổi của khách **trả phí** đã được doanh thu bù (biên dương ở §7.3), nên không đưa vào runway.

### 15.3 Mục tiêu sau 12 tháng (mục 11)

| Chỉ số | Mục tiêu | Giả định |
|---|---|---|
| Studio / media team trả phí (N) | 10 | ARPU ~1,2 triệu/tháng (~600 phút dub) |
| Creator trả phí (M) | 300 | ARPU ~100.000đ/tháng (~50 phút dub) |
| Doanh thu định kỳ | ~40 triệu đồng/tháng | 10 × 1,2 triệu + 300 × 100.000đ |
| Sản lượng | ~30.000 phút video/tháng | Vượt xa 5.000 phút kế hoạch → biên tăng, cần GPU/worker thêm (đã có trong ngân sách máy chủ) |

Doanh thu định kỳ vẫn thấp hơn chi tiêu (~55 triệu/tháng): vòng này chứng minh khách chịu trả tiền và biên tăng theo sản lượng, chưa nhằm hoà vốn.

### 15.4 Lưu ý với mục 6 của kịch bản

ARPU blended theo bảng giá này ≈ **135.000đ/tháng (~5 USD)**, không phải 20 USD như Phụ lục E.2. 1% × 180.000 kênh = 1.800 khách × 135.000đ × 12 ≈ **2,9 tỷ đồng/năm**.

