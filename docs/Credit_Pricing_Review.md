# Đánh giá Hệ số Credit (x, y) & Mức giá — TransFlow Media Studio

> **Ngày:** 2026-09-24
> **Đối tượng đánh giá:** `Credit_Coefficient_Calculation.md` (DRAFT)
> **Phạm vi:** (1) kiểm tra tính toán, (2) mức giá có quá cao không, (3) biên lợi nhuận & khả năng chi trả theo phân khúc, (4) hướng đi đề xuất.
> **Quy ước:** tỷ giá 26.000đ/USD, 1 Credit = 100đ (theo D1 của tài liệu gốc). Các mục đánh dấu ⚠️ là **giả định** cần kiểm chứng.

---

## 0. Tóm tắt điều hành

| Câu hỏi | Kết luận |
|---|---|
| Tính toán đúng chưa? | **Số học đúng hoàn toàn** (6 cặp x/y, 5 job mẫu, chi phí AI ~5.100đ đều khớp khi tính lại độc lập). Có **6 vấn đề về phương pháp/giả định** (§2). |
| Giá có quá cao không? | **Không.** Job 10 phút dub ≈ 926đ/phút ≈ 0,036 USD, thấp hơn đối thủ quốc tế **~9–67 lần**. Áp lực giá chỉ đến từ công cụ miễn phí/nội địa ở nhóm creator nhỏ. |
| Vấn đề thật sự là gì? | **Giá quá rẻ so với biên lợi nhuận cần có.** "Margin 25%" là markup trên giá vốn; biên gộp thực chỉ ~14% (dub) và ~4% (chỉ phụ đề) ở đúng sản lượng mục tiêu, và **âm** nếu sản lượng thấp hơn ~9.000 phút/tháng. |
| Khách có sẵn sàng trả? | Studio/MCN: **rất sẵn sàng**. YouTuber đa ngôn ngữ: **cao nếu dịch sang thị trường RPM cao**. Creator Shorts/TikTok: **nhạy giá**, cạnh tranh với "miễn phí". |
| Nên làm gì? | Tăng `margin_y` lên ~50%, tính x theo sản lượng thận trọng (5.000 phút), sửa mẫu số phân bổ, chừa dư địa chiết khấu, tái dùng STT giữa các ngôn ngữ, hạn chế Credit tặng khi chưa chống lạm dụng (§6). |

---

## 1. Kiểm chứng số học

### 1.1 Hệ số x, y

Tính lại theo công thức §4.1 của tài liệu gốc (`x = C_infra × 1,25 ÷ 100`, `y = C_market × 1,25 ÷ 100`):

| Capability | C_infra (VNĐ/unit) | C_market (VNĐ/unit) | x | y | Khớp file? |
|---|---|---|---|---|---|
| STT (giây) | 0,43333 | 2,60000 | 0,005417 | 0,032500 | ✅ |
| TRANSLATE (token) | 0,04160 | 0,00975 | 0,000520 | 0,000122 | ✅ |
| TTS (ký tự) | 0,02889 | 0,39000 | 0,000361 | 0,004875 | ✅ |
| SUMMARIZE_SCRIPT (token) | 0,03120 | 0,00624 | 0,000390 | 0,000078 | ✅ |
| VISION (token) | 0,01560 | 0,00507 | 0,000195 | 0,000063 | ✅ |
| RENDER (giây video) | 2,60000 | 0 | 0,032500 | 0 | ✅ |

### 1.2 Job mẫu (Credit)

| Kịch bản | BYOK | Không BYOK | ≈ VNĐ (không BYOK) |
|---|---|---|---|
| 1 phút, dub | 2,86 | 9,26 | 926đ |
| 10 phút, chỉ phụ đề | 25,35 | 45,46 | 4.546đ |
| 10 phút, dub | 28,60 | 92,58 | 9.258đ |
| 30 phút, dub | 85,80 | 277,75 | 27.775đ |
| 10 phút, tóm tắt + VLM | 26,65 | 47,17 | 4.717đ |

Chi phí AI thực (giá niêm yết OpenAI) cho video 10 phút dub: STT 1.560đ + TRANSLATE 49đ + TTS 3.510đ = **~5.119đ** ✅ khớp "~5.100đ".

**Chi phí vốn mỗi Credit** ≈ **80đ** (AI + hạ tầng phân bổ) — tức 1 Credit bán 100đ chỉ còn ~20đ biên gộp trước phí và thuế.

---

## 2. Các vấn đề phát hiện

### 2.1 Mẫu số phân bổ giả định mọi phút video đều dùng cả 6 capability

Công thức chia `Infra × Tỷ_lệ ÷ Phút_video_tháng ÷ Units/phút` cho **mọi** capability, tức mặc định mỗi phút video đều đi qua STT + TRANSLATE + TTS + SUMMARIZE + VISION + RENDER. Thực tế:
- Job **dub** không dùng SUMMARIZE và VISION.
- Job **chỉ phụ đề** không dùng TTS, SUMMARIZE, VISION.
- Job **tóm tắt** không dùng TTS, TRANSLATE (trừ khi thêm ngôn ngữ).

Hệ quả — doanh thu hạ tầng thu về mỗi phút video:

| Loại job | Tỷ lệ chi phí hạ tầng được thu | Sau markup 25% | Doanh thu x / phút video |
|---|---|---|---|
| Giả định của file (cả 6 capability) | 100% | 125% | 325đ |
| Chỉ phụ đề (STT + TRANSLATE + RENDER) | 78% | **98%** | 253đ |
| Dub (thêm TTS) | 88% | 110% | 286đ |
| Hỗn hợp thực tế ⚠️ (100% STT/TRANSLATE/RENDER, 60% dub, 15% tóm tắt, 5% vision) | 85% | **106%** | 277đ |

→ **Điểm hoà vốn hạ tầng thực ≈ 9.400–10.300 phút/tháng**, không phải 8.000 như §6.2 của file. Ở đúng 10.000 phút, margin_x thực tế chỉ ~0–6%, không phải 25%.

Ghi chú thêm: SUMMARIZE và VISION được phân bổ 6% hạ tầng mỗi loại nhưng dùng ít; nếu chia theo lượng dùng thực, x của hai capability này sẽ tăng nhiều lần. Cần xem lại Q1.

### 2.2 "Margin 25%" là markup, không phải biên lợi nhuận

Unit economics cho job 10 phút (không BYOK), sản lượng thực 10.000 phút/tháng:

| | Job 10 phút dub | Job 10 phút chỉ phụ đề |
|---|---|---|
| Doanh thu | 9.258đ | 4.546đ |
| Chi phí AI (giá niêm yết) | 5.119đ | 1.609đ |
| Hạ tầng phân bổ theo capability được dùng | 2.288đ | 2.028đ |
| Hạ tầng đầy đủ (260đ/phút video) | 2.600đ | 2.600đ |
| Biên gộp (AI + hạ tầng phân bổ) | 20,0% | 20,0% |
| Biên gộp (AI + hạ tầng đầy đủ) | 16,6% | 7,4% |
| **Biên gộp sau phí cổng thanh toán 3% ⚠️** | **13,6%** | **4,4%** |

Chưa tính: thuế, hỗ trợ khách hàng, chi phí retry/lỗi, chi phí nhân sự, marketing.

Biên lợi nhuận **theo sản lượng thực** (hạ tầng cố định 2,6 triệu/tháng chia đều theo phút video, đã trừ phí cổng 3%):

| Sản lượng thực | Job dub | Job chỉ phụ đề |
|---|---|---|
| 3.000 phút | −51,9% | −129,0% |
| 5.000 phút | −14,5% | −52,8% |
| 10.000 phút | +13,6% | +4,4% |

### 2.3 "BYOK rẻ hơn ~3 lần" dễ gây hiểu nhầm

Con số 28,6 so với 92,6 Credit chỉ so phần **trả cho nền tảng**. Người dùng BYOK vẫn phải trả hoá đơn nhà cung cấp AI của chính họ.

| Job 10 phút dub | Chi phí |
|---|---|
| Không BYOK (trả nền tảng) | 9.258đ |
| BYOK: phí nền tảng 2.860đ + hoá đơn nhà cung cấp (giá niêm yết) 5.119đ | **7.979đ** → tiết kiệm chỉ **~13,8%** |
| Nền tảng thu được từ 1 job BYOK sau khi trừ hạ tầng phân bổ | ~572đ (≈ 0,02 USD) — gần như bằng 0 sau phí cổng |

Hai hệ quả:
- Động lực dùng BYOK về giá **yếu** (trừ khi nhà cung cấp riêng của họ rẻ hơn hoặc họ có hạn mức miễn phí).
- Nền tảng gần như không lãi trên job BYOK; nếu phân khúc agency dùng BYOK nhiều, doanh thu sẽ rất thấp so với chi phí lưu trữ/render.

### 2.4 STT bị tính lại cho mỗi ngôn ngữ

Theo SRS v1.4, batch chỉ có 1 ngôn ngữ đích/lô, mỗi job = 1 video × 1 ngôn ngữ. Lời thoại gốc giống nhau nhưng STT chạy và bị tính phí lại từng lần: STT chiếm **~25%** giá job dub (22,75/92,58 Credit). Khách dịch 1 video sang 3 ngôn ngữ trả STT 3 lần.

### 2.5 Ước lượng 900 ký tự/phút là số của tiếng Anh

TTS là thành phần y lớn nhất (~47% giá job dub). Tiếng Việt nói nhanh hơn theo số âm tiết; ước tính của tôi ⚠️ khoảng **1.200–1.600 ký tự/phút**. Hệ quả: job dub có đích tiếng Việt có thể cao hơn ~30% so với bảng mẫu (Starter 500 Credit khi đó còn ~4 video 10 phút dub thay vì ~5). Cần đo bằng dữ liệu thật. Vì tính theo unit thực dùng nên biên không đổi, nhưng giá mà khách thấy sẽ khác bảng mẫu.

### 2.6 Credit khởi tạo có chi phí thật

Với giá vốn ~80đ/Credit:

| Credit tặng | Chi phí thực / tài khoản mới |
|---|---|
| 100 (hiện tại) | ~8.000đ |
| 200 | ~16.000đ |
| 300 | ~24.000đ |

Đối chiếu: 1 gói Starter (500 Credit, 50.000đ) chỉ để lại ~8.300–10.000đ biên gộp (trước phí cổng và thuế). Tặng 300 Credit ≈ tiêu hết biên của ~2–3 gói Starter. Nếu tỷ lệ chuyển đổi trả phí thấp, chi phí tặng sẽ rất khó thu hồi, và rủi ro tạo nhiều tài khoản để lấy Credit miễn phí là có thật.

### 2.7 Vấn đề nhỏ

- `NUMERIC(10,6)`: y của VISION (0,000063) và SUMMARIZE (0,000078) chỉ còn 2 chữ số có nghĩa, sai số ~0,6%. Chấp nhận được; có thể cân nhắc lưu hệ số theo 1.000 unit để dễ đọc.
- RENDER tính theo giây video nhưng chi phí lưu trữ/băng thông phụ thuộc độ phân giải/dung lượng. Có thể cần hệ số theo độ phân giải sau này.

---

## 3. Mức giá có quá cao không? — So sánh thị trường

### 3.1 Giá quốc tế (mỗi phút video dub) ⚠️ lấy từ trang giá/bài đánh giá bên thứ ba, cần đối chiếu lại trang chính thức

| Nguồn | Giá | Quy đổi | TransFlow rẻ hơn |
|---|---|---|---|
| **TransFlow dub (không BYOK)** | ~0,036 USD | **~926đ** | – |
| **TransFlow chỉ phụ đề** | ~0,017 USD | ~455đ | – |
| ElevenLabs API dubbing | 0,33–0,50 USD | 8.600–13.000đ | ~9–14× |
| Perso Dubbing | ~0,55–1,00 USD | 14.300–26.000đ | ~15–28× |
| Rask AI | ~1,20–2,40 USD | 31.000–62.000đ | ~34–67× |
| Toàn thị trường (theo một bài tổng hợp 07/2026) | 0,24–2,40 USD | – | – |

Lưu ý: các đối thủ có thêm nhân bản giọng, lip-sync, nhiều người nói; pipeline TransFlow có thể chưa có các tính năng này, nên đây là **mốc trần tham khảo**, không phải so sánh ngang hàng.

### 3.2 Thị trường Việt Nam

| Tham chiếu | Mức giá |
|---|---|
| CapCut Pro chính hãng (App Store/Google Play) | ~220.000đ/tháng |
| CapCut Pro qua đại lý | ~129.000đ/tháng |
| CapCut Pro giá rẻ (tài khoản chia sẻ/khuyến mãi) | ~39.000–49.000đ/tháng |
| Thuê người dịch phụ đề (một lời chứng thực trên trang công cụ) | ~20.000đ/phút |
| Công cụ AI dịch/lồng tiếng nội địa (AiTransClips) ⚠️ | đoạn trích tìm kiếm cho thấy ~10.000đ/30 phút video ở gói Pro (~333đ/phút); **chưa xác minh** bảng giá vì trang render bằng JavaScript, chưa rõ phạm vi bao gồm gì |

Nếu mốc ~333đ/phút của đối thủ nội địa là đúng, giá dub 926đ/phút của bạn đắt hơn ~2,8 lần và phụ đề 455đ/phút đắt hơn ~1,4 lần. **Cần xác minh trực tiếp** (đăng ký thử) trước khi chốt giá cho nhóm creator nhỏ.

### 3.3 Kết luận về mức giá

- So với quốc tế: **không cao, thậm chí thấp**.
- So với giá vốn: **quá mỏng** (mục 2.2).
- Rủi ro cạnh tranh giá nằm ở **phân khúc creator nhỏ** (đối thủ là miễn phí/CapCut gói rẻ/công cụ nội địa), không phải phân khúc studio/agency.

---

## 4. Biên lợi nhuận & khả năng chi trả theo phân khúc

> Chi phí dùng hệ số hiện tại, **không BYOK**. Phần "họ kiếm được" là **giả định minh hoạ** ⚠️, cần kiểm chứng bằng phỏng vấn khách hàng.

Phân khúc theo Business Model Canvas / Value Proposition Canvas của project: (1) Free B2C creator (TikToker, YouTuber cá nhân), (2) MCN / Digital Content Studio / Media team.

### 4.1 Tổng hợp

| Phân khúc | Cách dùng | Chi phí/tháng | Họ kiếm được gì | Sẵn sàng trả? |
|---|---|---|---|---|
| **A. Creator Shorts/TikTok VN** | 30 clip × 1 phút, phụ đề | ~13.600đ (kèm lồng tiếng ~27.800đ) | RPM Shorts khoảng 0,02–0,12 USD/1.000 view → mỗi clip cần ~150–870 view mới hoà vốn phần phụ đề | Số tiền nhỏ nhưng **nhạy giá**: đối thủ là miễn phí, CapCut gói rẻ, công cụ nội địa. Pain đã ghi trong VPC: "khó biện minh việc trả tiền so với công cụ miễn phí" và "không muốn cấu hình phức tạp (API key, BYOK)" |
| **B. YouTuber đa ngôn ngữ** | 4 video × 10 phút × 3 ngôn ngữ dub | ~111.000đ (~4,3 USD) | Mỗi bản dub (9.258đ ≈ 0,36 USD) hoà vốn với ~180 view (RPM 2 USD), ~60 view (RPM 6 USD), ~1.200 view (RPM 0,3 USD) | **Cao nếu dịch sang thị trường RPM cao** (Mỹ RPM ~2,2–6,6 USD; Ấn Độ ~0,13–0,68 USD; Việt Nam thuộc nhóm thị trường quảng cáo thấp). Họ quan tâm chất lượng giọng hơn giá |
| **C. Studio nhỏ (5–10 người)** | 600 phút dub/tháng (200 phút × 3 ngôn ngữ) | ~556.000đ (BYOK: ~479.000đ gồm cả hoá đơn nhà cung cấp) | Riêng phụ đề do người dịch ~12 triệu đồng cho 600 phút → chi phí AI ≈ **4–5%** | **Rất cao.** Họ cần dự đoán chi phí, QA, làm việc nhóm hơn là giá thấp |
| **D. Agency/MCN** | 3.000 phút dub/tháng | ~2,78 triệu đồng (~107 USD) | Cùng khối lượng: ElevenLabs API ~990–1.500 USD; Rask gói Pro ~3.600 USD. Nếu họ bán lại chỉ 10.000đ/phút, chi phí AI ≈ **9%** doanh thu | **Giá không phải rào cản.** Sẽ đòi **chiết khấu số lượng**; với markup 25% bạn gần như không có dư địa |

### 4.2 Điểm break-even của creator (chi phí 1 bản dub 10 phút ≈ 0,356 USD)

| RPM của thị trường đích (USD/1.000 view) | View cần để hoà vốn |
|---|---|
| 0,3 | ~1.190 |
| 0,5 | ~710 |
| 1 | ~360 |
| 2 | ~180 |
| 4 | ~90 |
| 6 | ~60 |

Nếu mục tiêu là clip Shorts (RPM 0,02–0,12 USD/1.000 view), phụ đề 1 phút (455đ ≈ 0,0175 USD) hoà vốn ở ~150–870 view.

### 4.3 Nhận xét chung

1. Với studio/agency, **chi phí AI là phần rất nhỏ** so với giá trị họ tạo ra hoặc chi phí thay thế bằng người → có dư địa tăng giá đáng kể.
2. Với creator nhỏ, số tiền tuyệt đối thấp nhưng **rào cản là nhận thức giá trị** so với công cụ miễn phí và thói quen trả theo tháng (CapCut Pro 39–129k/tháng) thay vì trả theo lần dùng.
3. **Khả năng dự đoán chi phí** là yếu tố quan trọng cho nhóm MCN (Pain P3 "Unclear AI costs") → nên hiển thị ước tính Credit **trước khi chạy job**.
4. Cùng một bảng giá tuyến tính cho mọi phân khúc là điểm yếu: nhóm nhạy giá cần giá thấp/miễn phí giới hạn, nhóm agency cần chiết khấu số lượng — cả hai đều đòi hỏi biên hiện tại rộng hơn.

---

## 5. Các phương án điều chỉnh giá

Giá job 10 phút (không BYOK) và biên gộp sau phí cổng 3% theo sản lượng thực (hạ tầng 2,6 triệu/tháng chia đều theo phút video):

| Phương án | Tham số | Giá 10 phút **dub** | Biên @10.000 phút | @5.000 | @3.000 |
|---|---|---|---|---|---|
| **A. File hiện tại** | margin_y 25%, x tính theo 10.000 phút | 9.258đ | +13,6% | −14,5% | −51,9% |
| **B.** | margin_y **50%**, x theo 10.000 phút | 10.538đ (+14%) | +23,8% | −0,9% | −33,8% |
| **C.** | margin_y **50%**, x theo **5.000 phút** | 13.398đ (+45%) | +39,4% | **+20,0%** | −5,9% |

| Phương án | Giá 10 phút **chỉ phụ đề** | Biên @10.000 | @5.000 | @3.000 |
|---|---|---|---|---|
| A | 4.546đ | +4,4% | −52,8% | −129,0% |
| B | 4.948đ | +11,9% | −40,6% | −110,7% |
| C | 7.483đ | +40,8% | +6,0% | −40,3% |

**Khuyến nghị:** dùng **phương án C cho giai đoạn đầu**, rà soát hàng tháng và hạ x khi sản lượng thật tăng (chỉ cần thêm dòng mới vào `credit_pricing_config` với `effective_from` mới, không đổi code). Giá C vẫn rẻ hơn ElevenLabs API ~6–9 lần. Kết hợp sửa mẫu số (mục 2.1) thì biên thực sẽ sát tính toán hơn.

Lưu ý: phương án C tăng mạnh giá phụ đề (+65%); nếu cạnh tranh với công cụ nội địa ~333đ/phút thì cần cân nhắc giữ giá phụ đề thấp hơn hoặc dùng làm sản phẩm dẫn dắt (loss-leader có kiểm soát) và bù bằng dub.

---

## 6. Hướng đi đề xuất (danh sách việc)

### 6.1 Về hệ số & giá

1. **Sửa mẫu số phân bổ**: tính x theo số phút thực sự đi qua từng capability, hoặc đơn giản hơn: thu x theo **phút video** và phân theo loại job (phụ đề / dub / tóm tắt).
2. **Tăng `margin_y` lên ~50%** (markup trên pass-through AI là mức thường thấy; còn dư địa lớn so với đối thủ quốc tế). Giữ `margin_x` 25% nếu x đã tính theo sản lượng thận trọng.
3. **Tính x theo 5.000 phút** ở giai đoạn đầu, review hàng tháng theo sản lượng thực.
4. **Chừa dư địa chiết khấu**: chỉ bán gói lớn có bonus Credit 10–15% **sau khi** nâng biên; giữ nguyên giá gói Starter. Với biên 20% như hiện tại, chiết khấu 20% đưa biên về 0.
5. **Tái dùng STT** khi dịch cùng video sang nhiều ngôn ngữ (chỉ tính STT lần đầu hoặc giảm giá từ ngôn ngữ thứ hai).
6. **Hiển thị ước tính Credit trước khi chạy** (pre-authorize, Q10 phương án b) và mô hình "giá theo phút video" dễ hiểu cho creator (ví dụ: phụ đề ≈ X Credit/phút, lồng tiếng ≈ Y Credit/phút).
7. **BYOK**: đặt phí tối thiểu cho nền tảng, không quảng bá "rẻ hơn 3 lần"; định vị BYOK cho người muốn dùng nhà cung cấp/giọng đọc riêng.

### 6.2 Về Credit khởi tạo & chống lạm dụng

- Giữ **100–150 Credit** cho đến khi có cơ chế chống nhiều tài khoản (xác minh số điện thoại/thiết bị, giới hạn tần suất).
- Tính rõ chi phí thực (mục 2.6) khi quyết định con số cuối cùng cho Q4.

### 6.3 Về dữ liệu cần đo/xác minh

- Đo **ký tự/phút thực tế** cho tiếng Việt (TTS) và **token/phút** của dịch (tiếng Việt token hoá kém hơn tiếng Anh; ảnh hưởng nhỏ đến giá do LLM rẻ, nhưng cần cho ước tính hiển thị).
- **Chốt Q2 trước khi chốt giá**: liệt kê chính xác provider nền tảng dùng cho từng capability. Đơn giá OpenAI chỉ là shadow price:
  - whisper-1 hiện 0,006 USD/phút, nhưng có model rẻ hơn (~0,003–0,0045 USD/phút) → y của STT có thể giảm một nửa nếu chuyển model.
  - Nếu provider thật rẻ hơn (DashScope, Piper…), biên ở phần y tốt hơn dự kiến.
  - Giá `gpt-4o-mini` và `tts-1` chưa được xác minh lại trong tháng này (ảnh hưởng nhỏ vì LLM rất rẻ; TTS `tts-1` là thành phần đáng chú ý).
- **Xác minh đối thủ nội địa** (AiTransClips và các công cụ tương tự): bảng giá thật, phạm vi gồm những gì.
- **Phỏng vấn khách hàng** cho 2 phân khúc để kiểm chứng giả định về khả năng chi trả và thu nhập (mục 4).
- **Thuế** (GTGT/TNDN), phí cổng thanh toán thực tế: nhờ kế toán xác nhận trước khi chốt biên.

### 6.4 Đề xuất lập trường cho danh sách Q1–Q11 (§8 tài liệu gốc)

| Q | Đề xuất |
|---|---|
| Q1 — Phân bổ hạ tầng & units/phút | Giữ tạm, **nhưng sửa mẫu số** (2.1); xem lại 6% cho SUMMARIZE/VISION; đo CPU-time sau 1 tháng chạy thật |
| Q2 — Provider tham chiếu | **Chốt trước khi chốt giá**; ghi rõ model thật, tra lại giá hiện hành |
| Q3 — Tính phí RENDER/SEPARATION/MIX | Đồng ý **có tính, y = 0**; cân nhắc hệ số theo độ phân giải về sau |
| Q4 — Credit khởi tạo | **100–150** khi chưa chống lạm dụng; 200–300 chỉ khi đã có cơ chế chống và chấp nhận chi phí ~16.000–24.000đ/tài khoản |
| Q5 — Margin | `margin_y` ≈ **50%**, `margin_x` 25% |
| Q6 — Sản lượng tính x | **5.000 phút** giai đoạn đầu, review hàng tháng |
| Q7 — "Người trực tiếp thực hiện" | Đồng ý đề xuất gốc: lưu `triggered_by_user_id` trên stage |
| Q8 — `provider_scope` | **Có** — cần thiết vì giá y thay đổi mạnh theo provider (ví dụ ElevenLabs TTS đắt hơn `tts-1` nhiều lần) |
| Q9 — Thiếu pricing config | **Chặn job** thay vì fallback hard-code |
| Q10 — Không đủ Credit | Phương án **(b) ước tính & giữ trước**, kèm hiển thị ước tính cho người dùng |
| Q11 — Làm tròn & mức tối thiểu | Cân nhắc **phí tối thiểu mỗi job** để bù chi phí cố định theo job (hàng đợi, lưu trữ) — đây là gợi ý mới, cần thử nghiệm |

---

## 7. Giả định & hạn chế của đánh giá này

- Tỷ giá 26.000đ/USD, hạ tầng 100 USD/tháng, sản lượng mục tiêu 10.000 phút, phân bổ hạ tầng và units/phút: **lấy từ tài liệu gốc**, chưa kiểm chứng.
- Phí cổng thanh toán **3%**: giả định của tôi.
- Hỗn hợp job thực tế (60% dub, 15% tóm tắt, 5% vision): giả định minh hoạ.
- Giá đối thủ lấy từ trang giá/bài đánh giá bên thứ ba (ElevenLabs, Perso, HeyGen, Rask), có thể thay đổi; các nền tảng khác nhau tính phí theo cách khác nhau (credit, phút, gói tháng).
- RPM YouTube là các khoảng ước lượng rộng, phụ thuộc niche và mùa; RPM của Việt Nam **không** có con số riêng đáng tin trong nguồn tra cứu, chỉ biết thuộc nhóm thị trường thấp.
- Không có dữ liệu cho phân khúc "tài khoản người dùng thực" của TransFlow; mọi kịch bản phân khúc là minh hoạ.
- Chưa tính thuế, chi phí nhân sự, marketing, hỗ trợ khách hàng, lỗi/retry.

---

## 8. Nguồn tham khảo

**Nội bộ project:** `SRS_updated.md` §5.6, `System_Architecture_updated.md` §10, `Database_Design_updated.md` (`credit_pricing_config`), Business Model Canvas, Value Proposition Canvas.

**Giá dịch vụ dubbing/STT:**
- ElevenLabs API pricing — https://elevenlabs.io/pricing/api
- So sánh giá dubbing theo phút (Perso, tháng 07/2026) — https://perso.ai/blog/ai-dubbing-pricing-2026-cost-per-minute-compared
- So sánh HeyGen/ElevenLabs/Rask/Dubverse — https://www.heygen.com/blog/heygen-vs-elevenlabs-vs-rask-ai-vs-dubverse
- Giá Rask AI — https://fluxnote.io/guides/rask-ai-alternative-free-guide-2026
- Giá OpenAI transcribe/Whisper — https://costgoat.com/pricing/openai-transcription

**Thị trường Việt Nam:**
- CapCut Pro giá tham khảo — https://hoanghamobile.com/tin-tuc/tai-capcut-pro/
- CapCut Pro qua đại lý — https://bestapp.vn/blog/cach-tai-capcut-mien-phi-2026-tren-dien-thoai-pc-va-len-pro-chinh-chu
- CapCut Pro giá rẻ — https://taikhoanvip.vn/capcut-pro-gia-re/
- Công cụ dịch/lồng tiếng nội địa — https://dichtudong.com/vi-vn/ , https://aitransclips.com/

**Doanh thu creator (RPM):**
- RPM/CPM theo quốc gia — https://www.ytface.com/cpm-rates-by-country
- Thu nhập YouTube theo quốc gia — https://fluxnote.io/guides/youtube-earnings-by-country-comparison
- CPM/RPM, Shorts — https://creaticalc.com/blog/youtube-cpm-rates-by-country

---

## Phụ lục — Công thức dùng trong đánh giá

```
Giá job (Credit)      = Σ_cap [ x(cap) + y(cap)·(không BYOK) ] × units(cap)
Giá vốn AI (VNĐ)      = Σ_cap C_market(cap) × units(cap)
Hạ tầng phân bổ (VNĐ) = Σ_cap C_infra(cap) × units(cap)
Hạ tầng đầy đủ (VNĐ)  = (Infra_tháng ÷ Phút_video_thực) × phút video của job
Biên gộp sau phí      = (Doanh thu × (1 − phí_cổng) − Giá vốn AI − Hạ tầng) ÷ Doanh thu
Điểm hoà vốn (phút)   = Infra_tháng ÷ Doanh thu_x_mỗi_phút_video (theo loại job)
Break-even view       = Chi phí bản dub (USD) ÷ (RPM ÷ 1.000)
```
