# 🌐 TransFlow — Nền Tảng Dịch Thuật & Tóm Tắt Video Đa Ngôn Ngữ

> **TransFlow Media Platform** — Giải pháp toàn diện ứng dụng Trí tuệ Nhân tạo (AI) kết hợp kiểm soát của con người (*Human-in-the-loop*) nhằm tự động hoá quy trình **Dịch thuật, Lồng tiếng** và **Tóm tắt video đa ngôn ngữ**.

---

## 👥 Danh Sách Thành Viên Thực Hiện

| STT | Họ và Tên | Mã Sinh Viên (MSSV) | Vai Trò | Nhiệm Vụ Đảm Nhiệm |
|:---:|:---|:---:|:---|:---|
| **1** | **Nguyễn Lê Hoàng Học** | `N23DCCN158` | **Trưởng nhóm** | • Quản lý tiến độ tổng thể, phân công và điều phối công việc trong nhóm.<br>• Phân tích kiến trúc hệ thống backend, thiết kế cơ sở dữ liệu và mô hình phân quyền.<br>• Chủ trì phát triển các dịch vụ Core Backend và điều phối pipeline dịch thuật, tóm tắt video. |
| **2** | **Hồ Đức Việt** | `N23DCCN203` | **Thành viên** | • Thiết kế và phát triển các dịch vụ cốt lõi của hệ thống Backend (Media Studio, cơ chế Credit Ledger, tích hợp xác thực).<br>• Xây dựng và tối ưu các pipeline xử lý video, tích hợp xử lý tác vụ bất đồng bộ.<br>• Phối hợp kiểm thử tích hợp các module backend và tối ưu hiệu năng xử lý. |
| **3** | **Huỳnh Quốc Huy** | `N23DCCN161` | **Thành viên** | • Xây dựng tài liệu đặc tả nghiệp vụ (SRS) và thiết kế giao diện API Backend.<br>• Phát triển module tích hợp AI Gateway (kết nối các mô hình STT, dịch thuật ngữ cảnh hóa, TTS, Vision).<br>• Phát triển và tích hợp cơ chế kiểm soát chất lượng (QA Gate) và Bảng thuật ngữ (Glossary). |
| **4** | **Nguyễn Hoài Phương** | `N23DCCN183` | **Thành viên** | • Thiết kế giao diện trải nghiệm người dùng (UI/UX) cho nền tảng TransFlow.<br>• Phát triển giao diện Frontend cho luồng tác nghiệp Media Studio (trình chỉnh sửa phụ đề, chọn giọng, xem trước video).<br>• Xây dựng các màn hình quản trị Không gian làm việc (Workspace), Dự án (Project) và Mẫu cấu hình (Preset). |
| **5** | **Trần Hữu Trung** | `N23DCCN200` | **Thành viên** | • Phát triển giao diện Frontend quản lý gói Credit, lịch sử giao dịch và bảng theo dõi mức sử dụng AI.<br>• Xây dựng giao diện xử lý hàng loạt (Video Batch Localization) và hệ thống thông báo trạng thái.<br>• Kiểm thử chức năng giao diện người dùng, đảm bảo tính thẩm mỹ và tính khả dụng của sản phẩm. |

---

## 📖 Giới Thiệu Tổng Quan Về Dự Án

Trong thời đại bùng nổ nội dung số, nhu cầu đưa video tiếp cận khán giả toàn cầu và chuyển đổi video dài thành các định dạng ngắn (Shorts, Reels, TikTok) ngày càng trở nên cấp thiết. Tuy nhiên, các phương pháp truyền thống thường gặp phải nhiều trở ngại:
- Chi phí dịch thuật và thuê diễn viên lồng tiếng chuyên nghiệp rất tốn kém và mất nhiều ngày xử lý.
- Tóm tắt và biên tập video thủ công đòi hỏi nhiều nhân lực và thời gian xem xét toàn bộ nội dung.
- Các công cụ dịch tự động đơn thuần thiếu tính kiểm soát chất lượng, dễ sai thuật ngữ chuyên ngành và dịch máy móc, mất tự nhiên.

**TransFlow** ra đời như một giải pháp **SaaS (Software-as-a-Service)** hiện đại, kết hợp sức mạnh xử lý của AI với tư duy biên tập của con người, mang lại khả năng bản địa hoá và rút gọn video chất lượng cao, nhanh chóng và tối ưu chi phí.

---

## 🎯 Hai Giá Trị Cốt Lõi

```
                        ┌────────────────────────────────────────┐
                        │            TransFlow Media             │
                        └───────────────────┬────────────────────┘
                                            │
               ┌────────────────────────────┴────────────────────────────┐
               ▼                                                         ▼
  🎬 DỊCH & LỒNG TIẾNG VIDEO                                ✂️ TÓM TẮT VIDEO ĐA NGÔN NGỮ
      (Video Localization)                                      (Video Summarization)
  • Phụ đề song ngữ chuẩn xác                                • AI soạn lại nội dung hấp dẫn
  • Đa dạng giọng đọc lồng tiếng AI                          • Tự động chọn đoạn cắt khớp hình
  • Xử lý đơn lẻ hoặc hàng loạt (Batch)                      • Tinh chỉnh linh hoạt theo phản hồi
```

### 1. Dịch & Lồng tiếng Video (Video Localization)
Biến một video gốc thành nhiều phiên bản ngôn ngữ khác nhau chỉ trong vài phút:
- Tự động tách lời thoại, nhận diện câu thoại và mốc thời gian chính xác.
- Dịch thuật ngữ cảnh hóa sang ngôn ngữ đích với sự hỗ trợ của Bảng thuật ngữ chuyên ngành.
- Lồng tiếng đa dạng: Giữ nguyên âm thanh gốc, thay thế hoàn toàn giọng mới, hoặc trộn hài hòa giọng lồng tiếng mới với nhạc nền và hiệu ứng gốc.
- Xuất bản phụ đề linh hoạt: Phụ đề mềm (bật/tắt tùy ý) hoặc phụ đề cứng (in trực tiếp lên video), luôn đính kèm file phụ đề rời (`.srt`, `.vtt`).

### 2. Tóm tắt Video Đa Ngôn Ngữ (Video Summarization)
Chuyển đổi video dài thành các clip ngắn cô đọng, súc tích theo độ dài mong muốn:
- **Cơ chế biên tập thông minh**: AI đóng vai trò như một biên tập viên chuyên nghiệp — trực tiếp viết lại (soạn kịch bản) nội dung tóm tắt bằng ngôn ngữ đích với hành văn tự nhiên, sau đó tự động tìm và cắt ghép các phân cảnh video gốc khớp với kịch bản đó.
- **Hỗ trợ phân tích ngữ cảnh hình ảnh**: Cho phép phân tích khung hình chuyển cảnh để kịch bản tóm tắt bám sát cả lời nói lẫn hình ảnh diễn ra trên video.
- **Tùy biến & Tinh chỉnh (Refine)**: Người dùng có thể yêu cầu AI chỉnh sửa kịch bản bằng câu lệnh tự nhiên (ví dụ: *"nhấn mạnh kết quả nghiên cứu"*, *"viết ngắn gọn đoạn mở đầu"*) hoặc chủ động tự chọn đoạn cắt thủ công.
- **Mở rộng đa ngôn ngữ**: Từ một clip tóm tắt đã ưng ý, có thể dễ dàng dịch và lồng tiếng sang các ngôn ngữ khác mà vẫn giữ nguyên cấu trúc đoạn cắt đã định hình.

---

## 🌟 Các Tính Năng Nghiệp Vụ Nổi Bật

### 🏢 1. Không Gian Làm Việc & Phân Quyền Linh Hoạt (Workspace & Project)
- **Tự động khởi tạo**: Người dùng đăng nhập lần đầu sẽ được cấp ngay 1 Workspace và 1 Project mặc định để bắt đầu làm việc ngay tức thì.
- **Cơ chế phân quyền 3 vai trò rõ ràng**:
  - 👑 **Lead (Trưởng nhóm)**: Toàn quyền quản trị Workspace, quản lý thành viên, cấu hình chi phí và có quyền duyệt trên mọi dự án/công việc.
  - 🛠️ **Member (Thành viên tác nghiệp)**: Thực hiện đầy đủ các tác vụ nghiệp vụ (tải video, tạo job dịch, tinh chỉnh tóm tắt, xuất bản) trong các Project được phân công.
  - 👁️ **Client (Khách hàng / Đối tác)**: Chế độ chỉ xem (Read-only), theo dõi tiến trình và kết quả nghiệm thu mà không can thiệp vào quy trình xử lý.

### ⚡ 2. Xử Lý Hàng Loạt (Video Batch Localization)
- Hỗ trợ chọn đồng thời lên tới **20 video** và xử lý sang cùng một ngôn ngữ đích trong một lần thiết lập.
- Mỗi video được xử lý độc lập; lỗi ở một video không làm gián đoạn các video còn lại trong lô.
- Dễ dàng theo dõi tiến độ từng video, tải về trọn gói dưới dạng file nén hoặc tải lẻ từng video hoàn thiện.

### 🛡️ 3. Kiểm Tra Chất Lượng Tích Hợp (Quality Assurance - QA Gate)
- Hệ thống tự động rà soát chất lượng bản dịch và phụ đề theo 4 cấp độ nghiêm trọng (*Thấp / Trung bình / Cao / Nghiêm trọng*).
- Cảnh báo hoặc ngăn chặn xuất bản/dựng video nếu phát hiện lỗi ngữ nghĩa hoặc lỗi hiển thị nghiêm trọng (ví dụ: phụ đề chồng lấn thời gian).
- Quy tắc duyệt và ghi đè lỗi (*Override*) minh bạch: Lead có quyền duyệt mọi việc, Member được chủ động duyệt trên các công việc do chính mình tạo ra, đi kèm lý do giải trình được lưu vết rõ ràng.

### 📚 4. Bảng Thuật Ngữ Chuyên Ngành (Glossary)
- Thiết lập danh mục từ vựng, tên riêng, thuật ngữ thương hiệu riêng cho từng dự án.
- Đảm bảo AI dịch chuẩn xác và đồng nhất các khái niệm đặc thù trong suốt quá trình sản xuất.

### 🔄 5. Nguyên Tắc "Con Người Làm Chủ" (Human-in-the-Loop) & Rerun Từng Công Đoạn
- AI đóng vai trò đề xuất, con người giữ quyền quyết định cuối cùng ở từng cột mốc quan trọng.
- Người dùng có thể chỉnh sửa phụ đề, câu từ bất cứ lúc nào.
- **Khả năng chạy lại linh hoạt (Rerun from stage)**: Khi cần thay đổi giọng đọc hoặc sửa phụ đề sau khi đã dựng, hệ thống cho phép chạy lại đúng công đoạn cần sửa mà không phải chạy lại toàn bộ từ đầu, giúp tiết kiệm tối đa chi phí và thời gian.

### 💎 6. Quản Lý Chi Phí Minh Bạch & Cơ Chế BYOK
- **Đơn vị tiền tệ Credit thống nhất**: Toàn bộ thao tác AI được quy đổi thành Credit rõ ràng, minh bạch.
- **Mang API Key riêng (BYOK - Bring Your Own Key)**: Người dùng có thể cấu hình API key cá nhân của các nhà cung cấp AI để chỉ trả phí hạ tầng vận hành, giúp tiết kiệm đáng kể chi phí sử dụng.
- **Chế độ thanh toán Workspace đa dạng**:
  - *Lead chịu toàn bộ*: Trưởng nhóm chi trả toàn bộ chi phí sử dụng trong không gian làm việc.
  - *Ai dùng nấy trả*: Từng thành viên tự thanh toán cho các thao tác do chính mình thực hiện.

### 🎨 7. Mẫu Cấu Hình Dựng Sẵn (Presets & Templates)
- Định hình sẵn phong cách hiển thị phụ đề (font chữ, kích thước, màu nền, vị trí) và cấu hình giọng đọc chuẩn.
- Áp dụng phân tầng theo 3 cấp độ: *Hệ thống ➔ Không gian làm việc (Workspace) ➔ Dự án (Project)*, giúp chuẩn hóa nhận diện thương hiệu cho toàn bộ video sản xuất ra.

---

## 🔄 Quy Trình Trải Nghiệm (Workflow Nghiệp Vụ)

```
[ 1. Tải Video & Xác nhận bản quyền ]
                 │
                 ▼
[ 2. Lựa chọn Dịch & Lồng tiếng HOẶC Tóm tắt nội dung ]
                 │
                 ├────────────────────────────────────────┐
                 ▼                                        ▼
      【 DỊCH & LỒNG TIẾNG 】                     【 TÓM TẮT VIDEO 】
      • Nhận diện lời thoại & mốc thời gian    • Đặt thời lượng mục tiêu
      • Áp dụng Glossary & Dịch thuật          • AI soạn kịch bản tóm tắt
      • Lựa chọn & tạo giọng đọc AI            • Ghép đoạn cắt & Tinh chỉnh
                 │                                        │
                 └───────────────────┬────────────────────┘
                                     ▼
                      [ 3. Kiểm tra Chất lượng (QA) ]
                                     │
                                     ▼
                     [ 4. Con người Phê duyệt / Tinh chỉnh ]
                                     │
                                     ▼
                      [ 5. Dựng & Xuất bản Video / Phụ đề ]
```

---

## 📌 Các Nguyên Tắc Vận Hành Cốt Lõi

1. **Bảo mật & Phân lập Dữ liệu**: Dữ liệu, video, cấu hình và ngân sách của từng Workspace được cách ly hoàn toàn, đảm bảo tính riêng tư tuyệt đối.
2. **Tuân thủ Bản quyền**: Bắt buộc người dùng xác nhận điều khoản bản quyền nội dung trước khi thực hiện bất kỳ thao tác xử lý nào trên video.
3. **Xử lý Bất đồng bộ**: Mọi tác vụ AI và xử lý đa phương tiện được tiến hành chạy nền liên tục; người dùng có thể theo dõi tiến độ theo thời gian thực mà không cần chờ đợi gián đoạn công việc khác.
4. **Kiểm soát Tự động & Thủ công**: Hỗ trợ cả hai chế độ: Tự động chạy hoàn chỉnh đến bước cuối (*Auto mode*) hoặc Dừng chờ người dùng duyệt tại từng cột mốc (*Manual mode*).

---

## 🚀 Định Hướng Phát Triển Tiếp Theo

- 🔗 **Nhập video trực tiếp từ liên kết (URL Fetching)**: Hỗ trợ dán liên kết video từ các nền tảng trực tuyến mà không cần tải thủ công về máy.
- 📲 **Xuất bản đa kênh tự động**: Liên kết và đăng tải thẳng video hoàn thiện lên các nền tảng mạng xã hội (YouTube, TikTok, Facebook).
- 🎨 **Mở rộng bộ công cụ biên tập sáng tạo**: Bổ sung các hiệu ứng trình bày phụ đề động, chuyển cảnh nâng cao và phân tích chuyên sâu mức độ tương tác nội dung.

---
*TransFlow — Tối ưu hóa quy trình sản xuất nội dung video toàn cầu.*