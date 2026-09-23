# TÀI LIỆU NGHIỆP VỤ — Nền tảng TransFlow Media

> Dịch & Lồng tiếng video đa ngôn ngữ • Tóm tắt video đa ngôn ngữ
> Phiên bản nghiệp vụ gốc: **1.4** (chuyển thể từ `SRS.docx` sang Markdown) · Bản chỉnh lý hiện hành
> **1.4b** ngày 2026-09-12. Bản 1.4a đã đơn giản hoá RBAC thành **Lead / Member / Client**; bản 1.4b tiếp tục
> thu gọn phạm vi dịch thuật để tập trung Media Studio: **bỏ dịch file/text độc lập, bỏ Translation Memory,
> bỏ Batch dịch file; giữ Video Batch Localization, Glossary và QA như năng lực hỗ trợ Media Studio**.
> Tài liệu mô tả nghiệp vụ — không bao gồm nội dung kỹ thuật/kiến trúc hệ thống (xem `System_Architecture.md`,
> `Database_Design.md`).

---

## Ghi chú cập nhật — 2026-09-23 (bổ sung trên nền 1.4b)

Không đổi phạm vi hay RBAC của 1.4b; chỉ ghi nhận các năng lực đã triển khai:

- **Dự án gần đây & ghim dự án** trên thanh điều hướng (§5.1).
- **Quản trị nền tảng** (§5.8): thêm theo dõi hoạt động trực tiếp (số người dùng đang online), điều chỉnh
  Credit của người dùng, và quản trị nội dung trang **Hướng dẫn** công khai.

---

## Ghi chú cập nhật — Bản chỉnh lý 1.4b: thu gọn nền tảng dịch thuật, 2026-09-12

Bản 1.4b **giữ nguyên cấu trúc và phần lớn nghiệp vụ của SRS 1.4/1.4a**, chỉ chốt thêm phạm vi cho bản
TransFlow xây lại:

- **Bỏ Dịch file/Text Translation độc lập**: không còn luồng upload `.txt/.docx` → Document → Translation
  Job → Text Editor. Translation trong hệ thống chỉ còn là một capability bên trong pipeline Media Studio.
- **Bỏ Translation Memory (TM)** khỏi phạm vi hiện hành: không lookup/reuse câu dịch cũ, không embedding
  similarity, không TM write-back và không còn QA action `BLOCK_TM_WRITEBACK`.
- **Bỏ Batch dịch file**. Khái niệm Batch còn lại trong tài liệu **chỉ là Video Batch Localization**:
  N video × đúng 1 ngôn ngữ đích, mỗi video sinh một Media Job.
- **Giữ Glossary** theo Project vì có giá trị trực tiếp cho video localization (brand/product/thuật ngữ);
  đây là năng lực hỗ trợ/advanced, không phải một sản phẩm dịch thuật độc lập.
- **Giữ QA engine**, nhưng QA được xem là quality gate tích hợp trong màn hình review của Media Job,
  không phải một module sản phẩm độc lập. QA vẫn có thể chặn phê duyệt/xuất bản/render theo mức độ lỗi.
- Các phần Credit, BYOK, Preset, Notification và Usage Dashboard **chưa bị loại bỏ bởi bản chỉnh lý này**.
- Các quyết định role/access của bản 1.4a tiếp tục giữ nguyên.

Khi phần lịch sử 1.1–1.4a bên dưới xung đột với phạm vi dịch thuật, **1.4b là quyết định hiện hành**.

## Ghi chú cập nhật — Bản chỉnh lý 1.4a: giản lược Role & ưu tiên Media Studio, 2026-09-12

Tại thời điểm bản 1.4a, các nghiệp vụ Credit, BYOK, Translation Memory, Glossary, Batch, Notification
và Dashboard vẫn được giữ. **Bản 1.4b ở trên đã thay đổi riêng phạm vi Translation Memory và Batch dịch file.**
Mục tiêu của 1.4a là:

- xác định **Media Studio** (Localization + Summarization) là luồng sản phẩm trọng tâm;
- thống nhất đúng **3 role ở cấp Workspace**: `Lead`, `Member`, `Client`;
- bỏ role ở cấp Project — Project chỉ lưu danh sách user được gán quyền truy cập;
- Lead truy cập mặc định mọi Project trong Workspace;
- Member/Client chỉ truy cập Project được Lead gán;
- Member giữ đầy đủ quyền thao tác nghiệp vụ trong Project được gán; Client chỉ xem;
- giữ nguyên quy tắc QA/checkpoint theo người tạo job: Lead mọi job, Member chỉ job của mình, Client không
  được duyệt/override;
- preset cấp `SYSTEM` có thể được công bố như **template dùng chung**. Việc dùng template không làm user
  tham gia Workspace/Project của người khác; job luôn được tạo trong Project mà user có quyền thao tác.

Các ghi chú phiên bản 1.1–1.4 bên dưới được giữ lại để tham chiếu lịch sử; khi có xung đột về role thì
**bản chỉnh lý 1.4a này là quyết định hiện hành**.

## Ghi chú cập nhật — Phiên bản 1.4

So với phiên bản 1.3, tài liệu thay đổi phạm vi mục 5.4 — Dịch & Lồng tiếng hàng loạt (Batch Localization).
Mọi phần khác giữ nguyên như bản 1.3.

- Batch Localization giờ chỉ hỗ trợ N video × 1 ngôn ngữ đích (trước đây là N video × M ngôn ngữ đích).
- Bỏ giới hạn "tối đa 10 ngôn ngữ đích/lô" (không còn cần thiết vì mỗi lô chỉ có 1 ngôn ngữ); giữ nguyên
  giới hạn tối đa 20 video/lô.
- Màn hình theo dõi đổi từ dạng ma trận video × ngôn ngữ sang danh sách video kèm trạng thái (vì không còn
  chiều ngôn ngữ thứ 2).

**Cần xác nhận thêm:** Nếu người dùng muốn cùng bộ video ra thêm ngôn ngữ khác, cần tạo một lô xử lý mới
riêng cho ngôn ngữ đó — đây là đánh đổi đơn giản hoá, vui lòng xác nhận không ảnh hưởng đến nhu cầu thực tế
của bạn.

## Ghi chú cập nhật — Phiên bản 1.3 (giữ lại để tham chiếu)

So với phiên bản 1.2, tài liệu thay đổi mô hình phân quyền (mục 3) và quy tắc duyệt Kiểm tra chất lượng
(mục 5.7). Mọi phần khác giữ nguyên như bản 1.2.

- Bỏ hoàn toàn 4 vai trò chức năng theo Project (Project Manager, Translator, Proofreader, Client). Toàn hệ
  thống chỉ còn đúng 2 vai trò — Lead và Member — áp dụng thống nhất cho cả Workspace lẫn Project.
- Member giờ có đầy đủ quyền thao tác nghiệp vụ trong Project mình tham gia (tạo job, dịch, tinh chỉnh tóm
  tắt...) — không còn phân biệt theo chức năng như trước.
- Quy tắc mới cho Kiểm tra chất lượng (QA): Member chỉ được duyệt/bỏ qua lỗi QA (accept/override) đối với
  CHÍNH job do mình tạo ra, không được đụng vào QA của job do Member khác tạo trong cùng Project. Lead không
  bị giới hạn này — có toàn quyền trên mọi job.

**Cần xác nhận thêm:** Việc gộp vai trò làm mất đi vai trò xem-only (Client cũ). Nếu vẫn cần một dạng người
xem ngoài (khách hàng theo dõi tiến trình, không thao tác) trong tương lai, cần thiết kế bổ sung riêng —
hiện đã loại bỏ hoàn toàn theo yêu cầu. *(→ Đã được giải quyết bằng phần [BỔ SUNG] Client ở đầu tài liệu.)*

## Ghi chú cập nhật — Phiên bản 1.2 (giữ lại để tham chiếu)

So với phiên bản 1.1, tài liệu bổ sung/thay đổi nội dung nghiệp vụ của mục 5.5 — Tóm tắt video đa ngôn ngữ
(Summarization). Mọi phần khác giữ nguyên như bản 1.1.

- Đổi bản chất cơ chế tóm tắt: AI không còn chỉ "chọn đoạn giữ nguyên câu gốc" — mà trước tiên VIẾT LẠI
  (soạn) nội dung tóm tắt hoàn chỉnh bằng chính ngôn ngữ đích người dùng chọn, sau đó mới chọn các đoạn
  video gốc khớp với nội dung vừa soạn.
- Người dùng phải chọn ngôn ngữ tóm tắt chính NGAY KHI tạo yêu cầu (trước đây chọn ngôn ngữ đích sau khi đã
  có phương án cắt).
- Tinh chỉnh theo phản hồi (Refine) giờ tác động trực tiếp lên nội dung đã soạn, không chỉ lên việc chọn đoạn.
- Muốn có thêm bản tóm tắt ở ngôn ngữ khác ngoài ngôn ngữ chính, hệ thống dịch nội dung đã hoàn thiện sang
  ngôn ngữ đó, giữ nguyên các đoạn video đã chọn — không soạn/chọn đoạn lại từ đầu cho mỗi ngôn ngữ (thiết
  kế đề xuất, xem ghi chú cần xác nhận trong mục 5.5).

**Cần xác nhận thêm:** Phương án Tự tạo thủ công (Custom Proposal) không đổi bản chất — người dùng vẫn tự
chọn đoạn từ lời thoại gốc, phụ đề vẫn được dịch sát nghĩa như luồng Dịch & Lồng tiếng thông thường (không
qua bước AI soạn lại nội dung).

## Ghi chú cập nhật — Phiên bản 1.1 (giữ lại để tham chiếu)

- Bổ sung mô hình tổ chức Workspace – Project: tự động khởi tạo Workspace và Project mặc định khi người
  dùng đăng nhập lần đầu.
- Bổ sung vai trò cấp Workspace: Lead và Member (thay cho việc chỉ có "Admin" quản lý workspace như bản 1.0).
- Thay đổi mô hình thanh toán: chuyển từ mô hình "gói thuê bao (subscription)" sang mô hình "Credit" — mua
  gói nạp Credit, cấp Credit miễn phí ban đầu không hoàn lại.
- Bỏ cấu hình nguồn AI ở cấp Workspace — chỉ còn cấu hình API key cá nhân trong Cài đặt cá nhân của từng
  người dùng.
- Bổ sung 2 chế độ tính chi phí trong Workspace (do Lead cấu hình) và công thức tính Credit tiêu tốn cho mỗi
  thao tác AI.

**Cần xác nhận thêm:** Vai trò "Lead" trong bản cập nhật này được hiểu là kế thừa toàn bộ quyền quản trị
Workspace trước đây thuộc về vai trò "Admin" ở bản 1.0. Vui lòng xác nhận cách hiểu này có đúng với mong
muốn của bạn không.

**Cần xác nhận thêm:** Công thức tính Credit cho Trường hợp 2 (không có API key riêng) hiện dùng dạng tạm:
Credit = x × token đã dùng + y × token đã dùng, trong đó "y" (hệ số quy đổi giá token) là placeholder — cần
được xác định chính thức (có thể khác nhau theo nhà cung cấp/loại thao tác) ở giai đoạn sau.

---

## 1. Giới thiệu

### 1.1 Mục đích tài liệu
Tài liệu này mô tả toàn bộ nghiệp vụ của nền tảng TransFlow Media — một sản phẩm cho phép người dùng tải
video lên và sử dụng trí tuệ nhân tạo (AI) để xử lý theo hai nhu cầu chính: dịch/lồng tiếng video sang nhiều
ngôn ngữ, hoặc tóm tắt video dài thành clip ngắn đa ngôn ngữ.

Tài liệu tập trung hoàn toàn vào góc nhìn nghiệp vụ (quy trình, vai trò, luật nghiệp vụ, ràng buộc) — không
đề cập chi tiết kỹ thuật, kiến trúc hệ thống hay cấu trúc dữ liệu.

### 1.2 Đối tượng đọc
Ban điều hành, Product/Business Analyst, Project Manager, đội vận hành khách hàng, và bất kỳ ai cần hiểu
sản phẩm hoạt động ra sao về mặt nghiệp vụ mà không cần kiến thức kỹ thuật.

### 1.3 Bảng thuật ngữ nghiệp vụ

| Thuật ngữ | Giải thích |
|---|---|
| Workspace (Không gian làm việc) | Đơn vị tổ chức riêng của một khách hàng/nhóm — nơi chứa các Project, thành viên và cấu hình chi phí, tách biệt hoàn toàn với khách hàng khác. |
| Project (Dự án) | Nơi làm việc thực tế — nơi video được tải lên và xử lý. Mỗi Project luôn thuộc về đúng 1 Workspace; 1 Workspace có thể chứa nhiều Project. |
| Lead | Người đứng đầu một Workspace — mặc định là người tạo/sở hữu Workspace đó. Có toàn quyền quản trị Workspace: quản lý thành viên, cấu hình mặc định, cấu hình cách tính chi phí. |
| Member | Thành viên của Workspace, được Lead gán vào một hoặc nhiều Project cụ thể; có đầy đủ quyền thao tác nghiệp vụ trong các Project được gán. |
| Client | Thành viên xem-only của Workspace, được Lead gán vào một hoặc nhiều Project cụ thể; chỉ được xem tiến trình & kết quả trong các Project được gán, không được tạo/thao tác job hay duyệt QA. |
| Credit | Đơn vị tiền tệ nội bộ duy nhất dùng để thanh toán cho mọi thao tác sử dụng AI trên nền tảng. |
| Gói Credit | Gói trả phí để nạp/mua thêm Credit, sử dụng khi số dư Credit hiện có không đủ. |
| API key cá nhân (BYOK) | Tài khoản/khoá truy cập nguồn AI do chính người dùng tự kết nối, cấu hình trong phần Cài đặt cá nhân. |
| Hệ số hạ tầng (x) | Hệ số quy đổi sang Credit cho chi phí vận hành hạ tầng, tính trên mỗi token đã sử dụng — áp dụng cho mọi thao tác AI, không phân biệt nguồn AI. |
| Hệ số giá token (y) | Hệ số quy đổi sang Credit tương ứng với chi phí token AI thực tế — chỉ phát sinh khi người thực hiện thao tác không tự cấu hình API key cá nhân (dùng nguồn AI do nền tảng cung cấp). |
| Job xử lý | Một yêu cầu xử lý cho 1 video sang 1 ngôn ngữ đích cụ thể (dịch hoặc tóm tắt). |
| Dịch hàng loạt (Batch) | Một yêu cầu duy nhất bao gồm nhiều video xử lý cùng 1 ngôn ngữ đích (N video × 1 ngôn ngữ); hệ thống tự tách thành nhiều job con (mỗi video 1 job) và xử lý song song (v1.4). |
| Con người xác nhận (Human-in-the-loop) | Nguyên tắc: AI chỉ đề xuất, con người luôn là người quyết định cuối cùng ở các mốc quan trọng trước khi tiếp tục. |
| Tinh chỉnh theo phản hồi (Refine) | Người dùng góp ý bằng văn bản, AI chỉnh sửa lại đúng phương án đang có (không tạo lại từ đầu). |
| Nội dung tóm tắt (Script) | Bản nội dung hoàn chỉnh do AI soạn (viết lại/diễn giải) bằng ngôn ngữ đích khi thực hiện Tóm tắt video — dùng trực tiếp làm phụ đề, không phải bản dịch nguyên văn lời thoại gốc (v1.2). |
| Phụ đề cứng / phụ đề mềm | Phụ đề in liền vào khung hình video (cứng) hoặc phụ đề đi kèm dưới dạng tệp rời, có thể bật/tắt (mềm). |
| Bảng thuật ngữ (Glossary) | Danh sách từ/cụm từ chuyên ngành cần dịch thống nhất theo đúng quy định của khách hàng/dự án. |
| Kiểm tra chất lượng (QA) | Bước kiểm tra tự động chất lượng bản dịch/phụ đề trước khi cho phép duyệt, xuất bản hoặc dựng video. |
| Mẫu cấu hình (Preset) | Bộ cấu hình có sẵn (kiểu chữ phụ đề, giọng đọc mặc định, màu sắc khung nền...) giúp người dùng không phải chọn lại từ đầu mỗi lần. |

---

## 2. Tổng quan sản phẩm

### 2.1 Sản phẩm là gì
TransFlow Media là một nền tảng dịch vụ trực tuyến (SaaS) phục vụ nhiều khách hàng độc lập cùng lúc. Mỗi
khách hàng làm việc trong một Workspace riêng, bên trong chứa một hoặc nhiều Project — nơi thực sự diễn ra
việc tải video lên và xử lý bằng AI. Con người xác nhận ở những mốc quan trọng trước khi hoàn tất.

### 2.2 Hai giá trị cốt lõi mà sản phẩm mang lại
- **Dịch & Lồng tiếng đa ngôn ngữ (Localization):** Biến 1 video gốc thành nhiều phiên bản ở các ngôn ngữ
  khác nhau — có phụ đề song ngữ và có thể lồng tiếng (thay hoặc trộn giọng nói mới), giúp nội dung tiếp cận
  được khán giả quốc tế.
- **Tóm tắt video đa ngôn ngữ (Summarization):** Biến 1 video dài thành clip ngắn theo đúng độ dài mong
  muốn, do AI đề xuất đoạn cắt hay nhất kèm lý do, sau đó có thể dịch/lồng tiếng clip đó sang các ngôn ngữ
  khác.

### 2.3 Nguyên tắc vận hành xuyên suốt
- AI luôn chỉ đóng vai trò đề xuất — con người là người quyết định cuối cùng ở các bước quan trọng.
- Mọi video trước khi được xử lý đều phải được chủ sở hữu xác nhận đồng ý về bản quyền nội dung.
- Việc xử lý bằng AI diễn ra ở chế độ nền — người dùng theo dõi tiến trình theo thời gian thực và được
  thông báo khi hoàn tất hoặc gặp lỗi.
- Dữ liệu, cấu hình và chi phí của từng Workspace hoàn toàn tách biệt, không lẫn giữa các khách hàng với nhau.
- Mọi thao tác sử dụng AI đều được quy đổi và trừ vào số dư Credit tương ứng.

### 2.4 Các nhóm nghiệp vụ chính


| Nhóm nghiệp vụ | Người dùng chính | Mô tả ngắn |
|---|---|---|
| Tài khoản, Workspace & Project | Mọi người dùng | Đăng nhập, khởi tạo Workspace/Project tự động, quản lý thành viên |
| Dịch & Lồng tiếng (đơn lẻ + hàng loạt) | Lead, Member | Dịch và lồng tiếng video sang một hoặc nhiều ngôn ngữ |
| Tóm tắt video | Lead, Member | AI đề xuất đoạn cắt hay nhất để tạo clip ngắn đa ngôn ngữ |
| Hỗ trợ Localization & Kiểm tra chất lượng | Lead, Member | Bảng thuật ngữ theo Project và QA tích hợp trong Media Job |
| Credit & Thanh toán | Lead, mọi người dùng | Cấp Credit ban đầu, mua gói Credit, cấu hình cách tính chi phí Workspace |
| Cấu hình mẫu & Nguồn AI cá nhân | Mọi người dùng, Lead | Cấu hình API key cá nhân, mẫu cấu hình mặc định |
| Thông báo & Bảng theo dõi | Mọi người dùng | Theo dõi tiến trình job, thống kê sử dụng AI và Credit |
| Theo dõi tiến trình (chỉ xem) | Client | Xem tiến trình & kết quả job trong Project được gán, không thao tác |

> **Ưu tiên sản phẩm:** trong bản xây lại, **Dịch & Lồng tiếng** và **Tóm tắt video** là hai luồng chính của
> Media Studio. Glossary và QA được giữ như năng lực hỗ trợ trực tiếp; Translation Memory và luồng dịch
> file/text độc lập đã được loại khỏi phạm vi. Credit/Thanh toán, Preset, BYOK, Notification và Dashboard
> vẫn được giữ trong tài liệu nhưng không phải bề mặt sản phẩm chính.


---

## 3. Cơ cấu tổ chức & Vai trò người dùng

### 3.1 Mô hình Workspace – Project
- Khi người dùng đăng nhập vào hệ thống lần đầu tiên, hệ thống tự động khởi tạo cho họ 1 Workspace mặc
  định, và bên trong Workspace đó tự động có sẵn 1 Project mặc định — người dùng có thể bắt đầu làm việc
  ngay mà không cần thao tác khởi tạo thủ công.
- Project là nơi làm việc thực sự: video được tải lên, xử lý, và mọi kết quả đều gắn với 1 Project cụ thể.
- Mỗi Project luôn thuộc về đúng 1 Workspace — không tồn tại Project nào nằm ngoài Workspace.
- 1 Workspace có thể chứa nhiều Project khác nhau (ví dụ: theo từng khách hàng, từng chiến dịch, từng nhóm
  nội dung riêng).
- Người dùng có thể tạo thêm Workspace khác ngoài Workspace mặc định, và trong mỗi Workspace có thể tạo
  thêm nhiều Project theo nhu cầu.

### 3.2 Vai trò — 3 vai trò cấp Workspace, Project chỉ quản lý phạm vi truy cập **[cập nhật 1.4a]**

Toàn hệ thống dùng đúng **3 vai trò ở cấp Workspace**:

| Vai trò | Cấp gán | Số lượng | Quyền hạn chính |
|---|---|---|---|
| **Lead** | Workspace | Đúng 1 người/Workspace (mặc định là người tạo Workspace) | Toàn quyền quản trị Workspace: quản lý thành viên, tạo/quản lý Project, cấu hình cách tính chi phí Credit, cấu hình mẫu mặc định. Lead mặc định có quyền truy cập và thao tác trên **mọi Project** thuộc Workspace, đồng thời có quyền duyệt/bỏ qua lỗi QA trên mọi job. |
| **Member** | Workspace | Không giới hạn | Người làm việc nội bộ. Không quản trị Workspace. Chỉ truy cập các Project được Lead gán; trong Project được gán có đầy đủ quyền nghiệp vụ: tạo job/batch, dịch, sửa phụ đề, chọn giọng, tạo/tinh chỉnh phương án tóm tắt, rerun và xem toàn bộ job/kết quả của Project. |
| **Client** | Workspace | Không giới hạn | Người ngoài/khách hàng theo dõi. Chỉ truy cập các Project được Lead gán và **chỉ có quyền xem** tiến trình/kết quả; không được tạo hoặc thay đổi job, QA, checkpoint hay rerun. |

**Project không có role riêng.** Việc một Member/Client có được vào Project hay không được quyết định bằng
danh sách gán Project. Role của user luôn lấy từ Workspace:

- Lead → tự động truy cập mọi Project trong Workspace, không cần gán từng Project.
- Member/Client → phải được Lead gán vào từng Project cụ thể.
- Một user không thể là Member ở Project A nhưng Client ở Project B trong cùng Workspace. Nếu cần mức quyền
  khác nhau như vậy trong tương lai, phải bổ sung capability riêng thay vì tạo thêm role chức năng.

Cách tách này giữ role đơn giản nhưng vẫn đảm bảo Member trong cùng Workspace không tự động nhìn thấy
Project/job của nhau.

### 3.3 Quy tắc riêng cho Kiểm tra chất lượng (QA) theo người tạo job

Việc giản lược role **không thay đổi** quy tắc QA hiện có:

- **Member**: chỉ được duyệt/xác nhận đạt QA (accept) hoặc bỏ qua lỗi chất lượng (override, có lý do) đối
  với **job do chính mình tạo**, và chỉ khi Member có quyền truy cập Project chứa job.
- **Lead**: không bị giới hạn theo người tạo — được duyệt/bỏ qua QA trên mọi job trong Workspace.
- **Client**: không có quyền duyệt/bỏ qua QA trong bất kỳ trường hợp nào.
- Quyền **xem** không giới hạn theo người tạo: Member/Client đã được gán vào Project có thể xem toàn bộ job
  của Project đó.

Mỗi job phải lưu rõ `created_by` để kiểm tra quyền QA/checkpoint; `created_by` **không được dùng để giới hạn
quyền xem Project/job**.

---

## 4. Phạm vi nghiệp vụ của dự án

### 4.1 Trong phạm vi triển khai
- Đăng ký/đăng nhập bằng email-mật khẩu hoặc tài khoản Google; tự động khởi tạo Workspace và Project mặc
  định khi đăng nhập lần đầu; quản lý Workspace/Project; **3 vai trò cấp Workspace: Lead / Member / Client**,
  kết hợp Project assignment để giới hạn phạm vi dữ liệu.
- Tải video lên (tối đa 500MB, tối đa 30 phút/video) và xác nhận đồng ý điều khoản bản quyền theo phiên bản
  hiện hành.
- Dịch & lồng tiếng video đa ngôn ngữ: chọn giọng đọc, phụ đề cứng/mềm, luôn xuất kèm tệp phụ đề rời; cho
  phép chạy lại một công đoạn bất kỳ mà không cần làm lại từ đầu.
- Dịch & lồng tiếng hàng loạt: chọn nhiều video cùng 1 ngôn ngữ đích, hệ thống tự tạo và theo dõi toàn bộ
  các job con tương ứng (mỗi video 1 job, cùng ngôn ngữ).
- Tóm tắt video đa ngôn ngữ: AI đề xuất một phương án cắt duy nhất, người dùng tinh chỉnh qua phản hồi bằng
  văn bản, có thể tự tạo phương án thủ công, tuỳ chọn phân tích thêm ngữ cảnh hình ảnh, sau đó dịch/lồng
  tiếng clip sang ngôn ngữ đích.
- Năng lực hỗ trợ Media Studio: Bảng thuật ngữ theo Project, Kiểm tra chất lượng (QA), Thông báo và Bảng
  theo dõi mức sử dụng AI. Không còn Translation Memory.
- Mẫu cấu hình dựng sẵn (giọng đọc, kiểu phụ đề, màu khung nền) dùng chung một mô hình duy nhất, áp dụng
  theo cấp hệ thống / không gian làm việc / dự án.
- Thanh toán theo Credit: cấp Credit miễn phí ban đầu (không refill), mua gói Credit bổ sung, cấu hình API
  key cá nhân trong Cài đặt cá nhân, và 2 chế độ tính chi phí do Lead cấu hình cho Workspace.
- Quản trị nền tảng dành cho tài khoản nội bộ có cờ `is_platform_admin`: xem KPI toàn hệ thống, trạng thái
  dịch vụ, danh bạ người dùng, danh sách Workspace và nhật ký kiểm toán qua khu vực tách biệt với Workspace.

### 4.2 Định hướng mở rộng trong tương lai (chưa triển khai ở giai đoạn này)
- Sản xuất nội dung sáng tạo bằng AI (tạo video mới từ ý tưởng/tư liệu, thay vì chỉ xử lý video có sẵn).

### 4.3 Ngoài phạm vi (không triển khai ở dự án này)
- **Dịch file/Text Translation độc lập**: không upload `.txt/.docx` để tạo Document/Translation Job/Text Editor.
  Nếu Media Studio cần dịch nội dung, việc dịch diễn ra bên trong pipeline của Media Job.
- **Batch dịch file**: không có lô xử lý `.txt/.docx`; khái niệm Batch còn lại chỉ là Video Batch Localization (§5.4).
- **Translation Memory (TM)**: không lưu/reuse câu dịch cũ và không có TM write-back trong phạm vi hiện hành.
- Nhân bản giọng nói cá nhân (voice cloning) và đồng bộ khẩu hình (lip-sync).
- Công cụ dựng video đầy đủ tính năng (hiệu ứng chuyển cảnh phức tạp, chèn watermark tự động).
- Cổng API công khai cho lập trình viên bên ngoài, hệ thống plugin mở rộng, quản lý phiên bản/khôi phục
  thay đổi.
- Xử lý nội dung dạng podcast, cuộc họp ghi âm, hoặc phát trực tiếp (livestream).

### 4.4 Định hướng giai đoạn 2 (tuỳ chọn, không bắt buộc)
- Nhập video qua đường dẫn: cho phép người dùng dán liên kết video từ nền tảng khác thay vì phải tự tải về
  máy rồi upload lại thủ công.
- Tự động đăng video lên mạng xã hội: sau khi hoàn tất xử lý, cho phép đăng thẳng video lên các nền tảng
  mạng xã hội đã liên kết mà không cần tải về rồi đăng thủ công từng nơi.

---

## 5. Quy trình nghiệp vụ chi tiết

### 5.1 Tài khoản, Workspace & Project **[cập nhật 1.4a]**
- Người dùng đăng ký/đăng nhập bằng email và mật khẩu, hoặc bằng tài khoản Google.
- Ngay khi đăng nhập lần đầu tiên, hệ thống tự động tạo 1 Workspace mặc định cho người dùng đó (người dùng
  trở thành Lead của Workspace này), kèm theo 1 Project mặc định bên trong — sẵn sàng để bắt đầu sử dụng.
- Lead có thể tạo thêm Project mới trong Workspace của mình, hoặc tạo thêm Workspace khác.
- Lead mời user vào Workspace và gán một trong 2 vai trò `Member` hoặc `Client`.
- Sau khi là thành viên Workspace, Member/Client chỉ nhìn thấy và truy cập các Project được Lead gán.
- Lead không cần được gán vào từng Project vì mặc định có quyền trên toàn Workspace.
- Project assignment **không mang role riêng**; quyền thao tác được suy ra từ role Workspace:
  - Member: đầy đủ quyền nghiệp vụ trong Project được gán.
  - Client: chỉ xem trong Project được gán.

**Dự án gần đây & ghim dự án [bổ sung 2026-09-23]**
- Thanh điều hướng bên trái có mục **"Gần đây"**, liệt kê các Project mà người dùng vừa mở trong Workspace
  hiện tại. Một Project được tính là "đã mở" khi người dùng chọn Project đó trong Media Studio hoặc mở một
  job thuộc Project đó.
- Người dùng có thể **ghim** một Project để nó luôn nằm ở đầu danh sách, và bỏ ghim bất kỳ lúc nào. Các
  Project đã ghim hiển thị trước (theo thứ tự ghim), sau đó là tối đa 5 Project mở gần nhất chưa ghim.
- Bấm vào một Project trong danh sách sẽ mở Media Studio của Project đó.
- Danh sách là **riêng của từng người dùng và từng Workspace**. Project đã bị xoá hoặc người dùng không còn
  được gán sẽ tự ẩn khỏi danh sách — mục này không cấp thêm quyền truy cập nào.
- Danh sách và trạng thái ghim được lưu trên trình duyệt của người dùng, **không đồng bộ** giữa các thiết bị
  hoặc trình duyệt khác nhau. Hiện chỉ có trên giao diện desktop.

### 5.2 Tải video lên & Đồng ý điều khoản
- Người dùng tải lên 1 video (tối đa 500MB, tối đa 30 phút) vào một Project cụ thể. Hệ thống kiểm tra định
  dạng và thời lượng hợp lệ.
- Trước khi tạo bất kỳ yêu cầu xử lý nào, người dùng bắt buộc phải xác nhận đồng ý với điều khoản bản quyền
  nội dung — luôn đối chiếu theo đúng phiên bản điều khoản đang hiện hành tại thời điểm đó.
- Sự đồng ý này gắn liền với video gốc; mọi bản dẫn xuất từ video đó đều kế thừa sự đồng ý đã xác nhận,
  không phải xác nhận lại nhiều lần.

### 5.3 Dịch & Lồng tiếng video (Localization)

**Mục tiêu nghiệp vụ**
Từ 1 video gốc, hệ thống dịch nội dung sang ngôn ngữ đích, luôn tạo ra phụ đề song ngữ (có thể xuất riêng
dưới dạng tệp phụ đề), và tuỳ chọn lồng tiếng bằng giọng đọc AI. Quá trình chỉ được xuất bản khi đã vượt qua
kiểm tra chất lượng.

**Các bước xử lý chính**
Sau khi tạo yêu cầu, hệ thống tự động thực hiện tuần tự các bước xử lý sau (chạy nền, người dùng theo dõi
tiến trình):
1. Tách âm thanh khỏi video.
2. (Tuỳ chọn) Tách riêng lời thoại khỏi nhạc nền/hiệu ứng âm thanh.
3. Chuyển giọng nói thành văn bản (nhận diện lời thoại theo từng câu, có mốc thời gian).
4. (Tuỳ chọn) AI đề xuất đoạn cắt quan trọng cần giữ lại, nếu người dùng chọn chế độ xử lý rút gọn.
5. Dịch nội dung sang ngôn ngữ đích.
6. Lồng tiếng bằng giọng đọc AI theo ngôn ngữ đích (nếu người dùng chọn lồng tiếng).
7. (Tuỳ chọn) Hoà trộn giọng lồng tiếng mới với nhạc nền/hiệu ứng gốc đã tách riêng.
8. Dựng video hoàn chỉnh và xuất kết quả.

Người dùng thông thường chỉ nhìn thấy 6 bước "logic" dễ hiểu trên giao diện; các bước không áp dụng cho lựa
chọn hiện tại sẽ tự động được bỏ qua và không hiển thị.

**Hai chế độ xử lý**
- Dịch nguyên văn: dịch toàn bộ nội dung video từ đầu đến cuối, giữ nguyên khung thời gian gốc.
- AI đề xuất cắt trước khi dịch: AI đề xuất giữ lại những đoạn quan trọng trước, chỉ dịch phần được giữ
  lại — giúp tiết kiệm chi phí và thời gian xử lý với video dài.

**Lựa chọn về giọng lồng tiếng và âm thanh đầu ra**
- Giữ nguyên âm thanh gốc, không lồng tiếng.
- Thay thế hoàn toàn bằng giọng lồng tiếng mới.
- Trộn giọng lồng tiếng mới với nhạc nền/hiệu ứng âm thanh gốc.

Giọng đọc được chọn phải cùng ngôn ngữ với ngôn ngữ đích của video — hệ thống sẽ từ chối rõ ràng nếu lựa
chọn không phù hợp.

**Xuất bản kết quả**
- Phụ đề cứng: in liền vào khung hình video.
- Phụ đề mềm (mặc định): đi kèm dưới dạng tệp rời, người xem có thể bật/tắt.
- Luôn xuất kèm tệp phụ đề độc lập, bất kể lựa chọn phụ đề cứng hay mềm.
- Người dùng có thể tuỳ chỉnh cách trình bày phụ đề: vị trí, màu chữ/nền, kiểu khung nền, số ký tự tối đa
  mỗi dòng.
- Việc dựng video/xuất bản sẽ bị chặn nếu bản dịch/phụ đề còn tồn tại lỗi chất lượng nghiêm trọng chưa được
  xử lý.

**Sửa phụ đề sau khi đã xử lý**
Người dùng có thể chỉnh sửa nội dung hoặc thời gian phụ đề bất kỳ lúc nào. Nếu việc sửa xảy ra sau khi đã
lồng tiếng hoặc dựng video, các bước phía sau sẽ được đánh dấu là "cần chạy lại" — hệ thống không tự động
chạy lại ngay mà chờ người dùng chủ động yêu cầu, tránh phát sinh chi phí Credit ngoài ý muốn.

**Hai chế độ vận hành**
- Chế độ thủ công (Manual): người dùng phải xác nhận tại từng mốc quan trọng trước khi hệ thống tiếp tục
  bước kế tiếp.
- Chế độ tự động (Auto): hệ thống tự chạy liên tục hết quy trình, chỉ dừng lại khi gặp lỗi hoặc khi đến
  bước cuối cùng cần xuất bản.

**Chạy lại từ một công đoạn bất kỳ**
Người dùng có thể chọn bất kỳ công đoạn nào đã hoàn tất để chạy lại, thay vì bắt buộc phải làm lại từ đầu.
Kết quả của các công đoạn trước đó được giữ nguyên và tái sử dụng, không tính lại chi phí Credit cho những
phần đó.

### 5.4 Dịch & Lồng tiếng hàng loạt (Video Batch Localization) — đã đơn giản hoá (v1.4/1.4b)

> **Phạm vi 1.4b:** đây là **Batch video duy nhất còn giữ**. Không liên quan tới Batch dịch file/text cũ.
> Mỗi item của batch là một video và sinh một `Media Job`; không tạo `Document` hay Text Translation Job.

Mục tiêu: cho phép người dùng xử lý nhiều video CÙNG một ngôn ngữ đích trong cùng một lần thao tác, thay vì
phải tạo yêu cầu thủ công cho từng video.

**Cần xác nhận thêm:** Đã đổi phạm vi so với bản trước: một lô xử lý (Batch) giờ chỉ áp dụng CHO ĐÚNG 1
NGÔN NGỮ ĐÍCH tại một thời điểm (N video × 1 ngôn ngữ), không còn hỗ trợ chọn nhiều ngôn ngữ đích cùng lúc
trong 1 lô. Nếu người dùng muốn cùng bộ video đó ra thêm ngôn ngữ khác, cần tạo một lô xử lý mới riêng cho
ngôn ngữ đó.

- Người dùng chọn nhiều video (đã tải lên và đã đồng ý điều khoản) cùng ĐÚNG 1 ngôn ngữ đích, áp dụng một
  bộ cấu hình chung (giọng đọc, phụ đề, chế độ xử lý...) cho toàn bộ lô.
- Hệ thống tự động tạo ra các yêu cầu xử lý con tương ứng — mỗi video 1 yêu cầu con, cùng chung 1 ngôn ngữ
  đích của lô — và xử lý độc lập với nhau.
- Giới hạn: tối đa 20 video trong một lô.
- Màn hình theo dõi hiển thị dạng danh sách video kèm trạng thái xử lý của từng video (không còn là ma trận
  video × ngôn ngữ vì chỉ có 1 ngôn ngữ đích).
- Một yêu cầu con bị lỗi không làm dừng hay ảnh hưởng đến các yêu cầu con khác trong cùng lô.
- Người dùng có thể chạy lại riêng từng yêu cầu con bị lỗi, không cần chạy lại toàn bộ lô.
- Có thể tải về toàn bộ kết quả đã hoàn thành dưới dạng một gói nén, hoặc xuất riêng từng kết quả.
- Có thể huỷ toàn bộ lô xử lý hoặc huỷ riêng từng yêu cầu con.

### 5.5 Tóm tắt video đa ngôn ngữ (Summarization)

**Mục tiêu nghiệp vụ (đã cập nhật — v1.2)**
Từ một video dài, AI VIẾT LẠI (soạn) một bản nội dung tóm tắt hoàn chỉnh bằng chính ngôn ngữ đích mà người
dùng chọn — không chỉ trích nguyên văn lời thoại gốc — sau đó chọn ra những đoạn video gốc tương ứng khớp
với nội dung vừa soạn, ghép lại thành video ngắn theo đúng độ dài mong muốn, kèm lý do lựa chọn. Con người
luôn là người quyết định cuối cùng — AI chỉ đề xuất, không tự ý dựng video khi chưa được xác nhận.

**Cần xác nhận thêm:** Đây là thay đổi bản chất so với bản 1.1 (khi đó AI chỉ chọn/giữ nguyên câu thoại gốc
rồi mới dịch). Nay AI đóng vai trò như một người biên tập viết lại nội dung bằng ngôn ngữ đích trước, rồi
mới đi tìm hình ảnh khớp với nội dung đó.

**Yêu cầu tóm tắt**
- Người dùng nhập độ dài mong muốn cho video kết quả (ví dụ: 60 giây, 3 phút).
- Chọn ngôn ngữ tóm tắt chính ngay khi tạo yêu cầu (mới — v1.2): vì nội dung tóm tắt được AI soạn trực tiếp
  bằng ngôn ngữ này, người dùng phải chọn ngôn ngữ đích chính ngay từ bước tạo yêu cầu. Ngôn ngữ chính có
  thể trùng hoặc khác ngôn ngữ gốc của video.
- Kết quả được chấp nhận trong một khoảng dung sai hợp lý quanh độ dài yêu cầu; nếu video gốc ngắn hơn độ
  dài mong muốn, hệ thống vẫn đề xuất theo đúng độ dài gốc kèm cảnh báo rõ ràng.
- Người dùng có thể bật thêm tuỳ chọn phân tích ngữ cảnh hình ảnh (mặc định tắt) — mô tả hình ảnh này còn
  giúp AI viết nội dung tóm tắt sinh động và chính xác hơn, không chỉ giúp chọn đoạn.

**AI soạn nội dung & chọn đoạn video tương ứng**
Hệ thống phân tích lời thoại gốc (và mô tả hình ảnh, nếu có bật phân tích ngữ cảnh hình ảnh), sau đó thực
hiện 2 việc trong cùng 1 phương án:
1. Soạn (viết lại/diễn giải/tóm lược) một bản nội dung tóm tắt hoàn chỉnh bằng ngôn ngữ đích đã chọn — hành
   văn tự nhiên theo đúng ngôn ngữ đó, không phải dịch máy móc từng câu.
2. Chọn ra các đoạn video gốc tương ứng khớp với từng phần nội dung vừa soạn (dựa trên những câu/ý gốc mà
   phần nội dung đó được xây dựng từ đó), để đảm bảo phụ đề hiển thị đúng lúc hình ảnh liên quan đang chiếu.

Kết quả là 1 phương án duy nhất, gồm: nội dung tóm tắt hoàn chỉnh bằng ngôn ngữ đích, các đoạn video tương
ứng, lý do lựa chọn tổng thể và theo từng đoạn, cùng mức độ tin cậy và cảnh báo (nếu có).

**Tự tạo phương án thủ công (không đổi)**
Người dùng vẫn có thể tự chọn tay các đoạn trực tiếp từ lời thoại gốc của video — không qua bước AI soạn
nội dung mới. Với phương án tự tạo, phụ đề được dịch sát nghĩa từ lời thoại gốc trong đoạn đã chọn, dùng
chung cơ chế dịch như nghiệp vụ Dịch & Lồng tiếng (khác với phương án AI, nơi phụ đề chính là nội dung do AI
soạn). Phương án tự tạo không bị xoá bỏ khi người dùng tạo thêm đề xuất mới từ AI.

**Tinh chỉnh đề xuất qua phản hồi (Refine)**
- Người dùng nhập phản hồi bằng văn bản; phản hồi này tác động trực tiếp lên NỘI DUNG TÓM TẮT đã soạn (ví
  dụ: "viết ngắn gọn hơn ở đoạn mở đầu", "nhấn mạnh kết quả cuối cùng"), chứ không chỉ đơn thuần điều chỉnh
  việc chọn đoạn.
- AI viết lại phần nội dung liên quan theo đúng phản hồi, sau đó chọn lại đoạn video tương ứng nếu cần.
- Giới hạn tối đa 5 lần tinh chỉnh cho mỗi phiên làm việc.
- Mỗi phiên làm việc tinh chỉnh có thời hạn nhất định; nếu hết hạn, người dùng chỉ cần mở lại để tiếp tục —
  các phương án đã lưu trước đó không bị mất.
- Nếu phương án đang chọn đã được dùng để tạo bản dịch, người dùng cần đổi sang phương án khác trước khi
  tiếp tục tinh chỉnh.

**Phân tích ngữ cảnh hình ảnh (tuỳ chọn)**
Khi được bật, hệ thống trích xuất một số khung hình tiêu biểu tại các điểm chuyển cảnh và dùng AI để mô tả
nội dung hình ảnh. Những mô tả này được đưa vào cùng với lời thoại khi AI soạn nội dung tóm tắt và chọn đoạn
(kể cả khi tinh chỉnh). Tính năng này mặc định tắt vì làm tăng thêm chi phí Credit và thời gian xử lý.

**Chọn phương án & tạo phụ đề**
- Nếu chọn phương án do AI đề xuất: phụ đề chính là nội dung đã soạn (đã ở đúng ngôn ngữ đích) — không cần
  dịch lại, hệ thống chỉ cắt nội dung đó theo đúng các đoạn video tương ứng.
- Nếu chọn phương án tự tạo thủ công: phụ đề được dịch từ lời thoại gốc như luồng Dịch & Lồng tiếng thông
  thường.

**Tóm tắt thêm ngôn ngữ khác (đổi tên từ "Tóm tắt đa ngôn ngữ")**
- Nếu người dùng muốn có thêm bản tóm tắt ở một ngôn ngữ khác ngoài ngôn ngữ chính đã chọn ban đầu, hệ
  thống DỊCH nội dung tóm tắt đã hoàn thiện (đã qua chọn đoạn, đã qua tinh chỉnh) sang ngôn ngữ bổ sung đó,
  tái sử dụng cùng cơ chế Bảng thuật ngữ/Kiểm tra chất lượng như nghiệp vụ Dịch & Lồng tiếng.
- Các đoạn video đã chọn được GIỮ NGUYÊN cho mọi ngôn ngữ bổ sung — hệ thống không soạn nội dung và chọn
  đoạn lại từ đầu cho từng ngôn ngữ.
- Có thể lồng tiếng (tuỳ chọn) cho clip ngắn ở từng ngôn ngữ, dùng chung cơ chế chọn giọng như nghiệp vụ
  Dịch & Lồng tiếng.

**Cần xác nhận thêm:** Đây là thiết kế đề xuất nhằm đảm bảo tính nhất quán giữa các phiên bản ngôn ngữ của
cùng 1 clip. Phương án khác là để AI soạn nội dung và chọn đoạn ĐỘC LẬP cho mỗi ngôn ngữ. Vui lòng xác nhận
cách nào đúng ý bạn.

**Xuất bản**
- Kết quả cuối cùng là clip video đã ghép các đoạn được chọn, gắn phụ đề (nội dung do AI soạn, hoặc bản
  dịch nếu là phương án tự tạo/ngôn ngữ bổ sung), kèm tệp phụ đề rời.
- Vẫn giữ 2 lựa chọn phụ đề cứng/mềm như nghiệp vụ Dịch & Lồng tiếng.

**Xử lý ngoại lệ**
Nếu có sự cố xảy ra do hạ tầng kỹ thuật, hệ thống tự động thử lại. Nếu là lỗi do nghiệp vụ, yêu cầu sẽ dừng
lại ngay và thông báo rõ nguyên nhân cho người dùng xử lý, không tự thử lại nhiều lần.

### 5.6 Credit & Thanh toán

**Đơn vị thanh toán**
Toàn bộ chi phí sử dụng AI trên nền tảng được quy đổi và tính bằng "Credit" — đơn vị tiền tệ nội bộ duy
nhất, áp dụng thống nhất cho mọi Workspace.

**Cấp Credit ban đầu**
- Khi người dùng đăng nhập vào hệ thống lần đầu tiên, hệ thống tự động cấp một số lượng Credit miễn phí ban
  đầu vào tài khoản cá nhân.
- Số Credit khởi tạo này KHÔNG được làm mới/refill định kỳ.
- Khi Credit được cấp ban đầu đã dùng hết, cách duy nhất để có thêm Credit là mua gói Credit.

**Mua gói Credit**
Người dùng có thể mua các gói Credit bổ sung bất kỳ lúc nào để nạp thêm vào số dư cá nhân.

**Cần xác nhận thêm:** Chi tiết các mức gói, đơn giá, và hình thức thanh toán chưa được mô tả — cần bổ sung
ở giai đoạn thiết kế chi tiết sau.

**Cấu hình nguồn AI cá nhân**
- Mỗi người dùng có thể tự cấu hình API key của nhà cung cấp AI riêng (BYOK) trong phần Cài đặt cá nhân.
- Đây là cấu hình ở cấp độ cá nhân duy nhất — không có cấu hình API key ở cấp độ Workspace.

**Cấu hình cách tính chi phí trong Workspace (do Lead thiết lập)**
Lead của một Workspace chọn 1 trong 2 cách tính chi phí, áp dụng cho toàn bộ Project thuộc Workspace đó:
- Lead chịu toàn bộ chi phí: mọi chi phí Credit phát sinh từ việc sử dụng AI trong các Project thuộc
  Workspace — dù do chính Lead hay do Member nào thực hiện — đều được trừ vào số dư Credit của Lead.
- Ai dùng người đó trả: mỗi người dùng (kể cả Lead) tự chịu chi phí Credit cho chính những thao tác AI mà
  mình thực hiện, trừ vào số dư Credit cá nhân của người đó.

**Công thức tính số Credit tiêu tốn cho mỗi thao tác AI**
Số Credit bị trừ cho mỗi thao tác được tính dựa trên việc người TRỰC TIẾP THỰC HIỆN thao tác đó có tự cấu
hình API key cá nhân hay không. Điều này hoàn toàn độc lập với việc chi phí sẽ được trừ vào số dư của ai.

- **Trường hợp 1** — Người thực hiện đã tự cấu hình API key cá nhân: hệ thống chỉ tính phí hạ tầng vận hành.
  `Credit sử dụng = x × Số token đã dùng`
- **Trường hợp 2** — Người thực hiện KHÔNG cấu hình API key cá nhân (dùng nguồn AI do nền tảng cung cấp):
  hệ thống tính thêm cả chi phí token thực tế, ngoài phí hạ tầng.
  `Credit sử dụng = (x × Số token đã dùng) + (y × Số token đã dùng)`

Trong đó: `x` = hệ số phí hạ tầng (áp dụng mọi trường hợp), `y` = hệ số quy đổi chi phí token thực tế sang
Credit (chỉ áp dụng ở Trường hợp 2).

**Cần xác nhận thêm:** Công thức ở Trường hợp 2 hiện là công thức tạm/dự kiến. Hệ số "y" cần được xác định
chính thức ở giai đoạn sau. Ngoài ra, hành vi hệ thống khi số dư Credit không đủ để thực hiện một thao tác
(chặn tạo job ngay từ đầu, hay cho phép xử lý rồi báo nợ) cũng cần được xác nhận thêm.

**Ví dụ minh hoạ cách áp dụng** (Member A và Lead B trong cùng 1 Workspace):

| Người thực hiện | Có API key cá nhân? | Công thức tính Credit | Chế độ "Lead trả hết" — trừ vào | Chế độ "Ai dùng người đó trả" — trừ vào |
|---|---|---|---|---|
| Lead (B) | Có | x × token | Lead (B) | Lead (B) |
| Lead (B) | Không | x × token + y × token | Lead (B) | Lead (B) |
| Member (A) | Có | x × token | Lead (B) | Member (A) |
| Member (A) | Không | x × token + y × token | Lead (B) | Member (A) |

**Bảng theo dõi mức sử dụng AI**
Cung cấp thống kê các thao tác AI đã thực hiện (chuyển giọng nói thành văn bản, dịch, lồng tiếng, tóm tắt,
dựng video, phân tích hình ảnh) và số Credit tương ứng đã tiêu tốn, theo từng Workspace/Project/người dùng
và theo thời gian.

### 5.7 Nghiệp vụ hỗ trợ Media Studio

**Bảng thuật ngữ (Glossary)**
Mỗi Project có một bảng thuật ngữ riêng, liệt kê các từ/cụm từ chuyên ngành cần được dịch thống nhất.
Glossary được áp dụng trước khi AI dịch và có thể nhập từ CSV. Đây là tính năng hỗ trợ/advanced của
Localization, không phải một module dịch thuật độc lập.

**Translation Memory (TM) — đã loại khỏi phạm vi 1.4b**
Hệ thống không còn lưu/reuse câu dịch cũ, không tìm kiếm tương đồng bằng embedding và không write-back bản
dịch vào TM. Việc dịch sử dụng context hiện tại + Glossary + provider AI.

**Kiểm tra chất lượng (QA) [cập nhật 1.4b]**
- QA là quality gate **tích hợp trong Media Job/Review**, không phải một khu vực nghiệp vụ độc lập.
- Mỗi lỗi phát hiện được phân theo 4 mức độ nghiêm trọng: Thấp / Trung bình / Cao / Nghiêm trọng.
- Tuỳ mức độ, lỗi có thể chặn một hoặc nhiều hành động: phê duyệt, xuất bản hoặc dựng video.
- Không còn action `BLOCK_TM_WRITEBACK` vì Translation Memory đã bị loại.
- Lead có toàn quyền duyệt/bỏ qua lỗi để tiếp tục (override) trên MỌI job trong Workspace của mình. Member
  chỉ có quyền này đối với job DO CHÍNH MÌNH TẠO RA trong Project được gán. Client không có quyền này
  trong bất kỳ trường hợp nào. Mọi trường hợp override đều bắt buộc phải ghi lý do rõ ràng và luôn được
  lưu vết.
- Một số lỗi kỹ thuật đặc biệt nghiêm trọng (ví dụ phụ đề chồng lấn thời gian) không bao giờ được phép bỏ
  qua — kể cả Lead.

**Mẫu cấu hình (Preset)**
- Một mẫu cấu hình bao gồm: kiểu trình bày phụ đề, cấu hình giọng đọc mặc định theo từng ngôn ngữ, và cấu
  hình hiển thị khi dựng video.
- Mẫu cấu hình có thể được thiết lập ở 3 cấp độ: toàn hệ thống, theo từng Workspace, hoặc theo từng Project
  cụ thể — mỗi cấp chỉ có 1 mẫu mặc định.
- Khi tạo một yêu cầu xử lý mới, hệ thống tự động áp dụng cấu hình theo thứ tự ưu tiên: lựa chọn tường minh
  của người dùng > mẫu mặc định của Project > mẫu mặc định của Workspace > mẫu mặc định chung của hệ thống.
- Mẫu cấp **hệ thống** có thể được công bố trong danh mục template dùng chung để người dùng tạo video nhanh.
  Việc sử dụng template chỉ sao chép/snapshot cấu hình vào job thuộc Project mà user có quyền; **không** cấp
  quyền vào Workspace/Project chứa nguồn template và không làm lộ job của người dùng khác.

**Thông báo**
Người dùng được thông báo khi một yêu cầu xử lý (đơn lẻ hoặc lô) hoàn thành, gặp lỗi, hoặc chuyển sang
trạng thái "cần chạy lại".

### 5.8 Quản trị nền tảng (Platform Super Admin)

- Platform Super Admin là quyền vận hành nội bộ toàn hệ thống, được xác định bằng cờ
  `users.is_platform_admin`; đây **không phải** role thứ tư của Workspace và không thay đổi mô hình
  `LEAD/MEMBER/CLIENT`.
- Chỉ tài khoản có cờ này mới được truy cập khu vực `/platform` và API `/api/platform/*`.
- Khu vực quản trị cung cấp: tổng quan KPI, hoạt động trực tiếp (job đang xử lý, job hoàn thành trong
  ngày, token AI trong 1 giờ qua, số người dùng đang online), sức khỏe PostgreSQL/Redis/RabbitMQ/MinIO/AI
  Worker, danh bạ người dùng, danh sách Workspace và nhật ký kiểm toán.
- "Đang online" = người dùng đã đăng nhập và còn mở ứng dụng trong khoảng 2 phút gần nhất; nhiều tab của
  cùng một người chỉ tính 1.
- **Điều chỉnh Credit [bổ sung 2026-09-23]:** Super Admin xem số dư và cộng/trừ Credit cho bất kỳ người dùng
  nào (ví dụ hoàn Credit cho job lỗi), kèm lý do. Không được trừ làm số dư âm. Mỗi lần điều chỉnh được ghi
  vào lịch sử giao dịch Credit của người dùng (loại "Điều chỉnh") và vào nhật ký kiểm toán.
- **Trang Hướng dẫn [bổ sung 2026-09-23]:** Super Admin quản lý nội dung hướng dẫn song ngữ Việt/Anh theo
  chuyên mục → bài viết (tạo, sửa, sắp xếp, xoá, chuyển Nháp/Xuất bản, xem trước). Chỉ bài đã xuất bản
  thuộc chuyên mục đang hiển thị mới xuất hiện ở trang `/guide`; trang này ai cũng xem được, không cần đăng
  nhập. Không xoá được chuyên mục khi còn bài viết.
- Người không có cờ Platform Admin phải bị từ chối ở backend, kể cả khi biết URL hoặc tự gọi API.
- Ngoài 2 thao tác trên, các API quản trị chỉ phục vụ quan sát/tra cứu trong MVP; không cấp quyền sửa dữ
  liệu nghiệp vụ của Workspace (Project, Media Job, thành viên…) hoặc bỏ qua các gate RBAC/ownership hiện
  hành.

---

## 6. Ràng buộc & nguyên tắc nghiệp vụ quan trọng

| Nguyên tắc | Nội dung |
|---|---|
| Giới hạn video | Mỗi video tải lên tối đa 500MB và tối đa 30 phút. |
| Giới hạn lô xử lý | Chỉ còn Video Batch Localization: tối đa 20 video, đúng 1 ngôn ngữ đích/lô. Không có Batch dịch file. |
| Xử lý nền, không chờ trực tuyến | Mọi xử lý AI chạy ở chế độ nền; người dùng theo dõi tiến trình theo thời gian thực. |
| Kiểm soát quyền ở mọi hành động nhạy cảm | Các hành động như dựng video, xuất bản, bỏ qua lỗi chất lượng luôn được kiểm tra quyền hạn thực sự phía hệ thống. |
| Một yêu cầu xử lý không có trạng thái "lỗi một phần" | Với 1 yêu cầu xử lý đơn lẻ, lỗi ở bất kỳ khâu nào cũng khiến toàn bộ yêu cầu được đánh dấu là lỗi hoàn toàn. Trạng thái "một phần lỗi" chỉ áp dụng ở cấp độ toàn bộ lô xử lý hàng loạt. |
| Sự đồng ý bản quyền luôn phải cập nhật theo phiên bản mới nhất | Hệ thống luôn đối chiếu với đúng 1 phiên bản điều khoản đang hiện hành tại thời điểm tạo yêu cầu xử lý. |
| Chỉnh sửa sau xử lý không tự động chạy lại | Khi người dùng sửa nội dung đã qua các bước sau, hệ thống chỉ đánh dấu "cần chạy lại", chờ người dùng chủ động xác nhận. |
| Project luôn thuộc về đúng 1 Workspace | Không tồn tại Project độc lập ngoài Workspace; 1 Workspace có thể chứa nhiều Project. |
| Mỗi Workspace có đúng 1 Lead | Vai trò Lead do người tạo Workspace mặc nhiên đảm nhận; số lượng Member/Client không giới hạn. |
| Credit ban đầu không hoàn lại / không tự làm mới | Số Credit được cấp miễn phí khi đăng nhập lần đầu chỉ cấp một lần duy nhất; muốn có thêm Credit chỉ có thể mua gói. |
| Cấu hình API key chỉ ở cấp cá nhân | Không có cấu hình nguồn AI ở cấp Workspace; mỗi người dùng tự quản lý API key riêng của mình. |
| Công thức tính Credit độc lập với chế độ thanh toán | Việc áp dụng công thức Trường hợp 1 hay Trường hợp 2 chỉ phụ thuộc người thực hiện thao tác có API key cá nhân hay không. |
| Role và Project access tách biệt | Role nằm ở Workspace; Member/Client chỉ truy cập Project được gán. Client luôn bị chặn ở mọi hành động tạo/sửa/duyệt — chỉ có quyền xem. |
| Dịch thuật tập trung vào Media Studio | Không có dịch file/Text Translation hoặc Translation Memory; giữ Glossary, QA và Video Batch Localization như năng lực hỗ trợ video. |
| Platform Admin độc lập với RBAC Workspace | `is_platform_admin` là cờ vận hành cấp hệ thống, không phải role Workspace và phải được kiểm tra ở backend cho mọi `/api/platform/*`. |

---

## 7. Phụ lục

### 7.1 Ma trận nghiệp vụ theo vai trò **[cập nhật 1.4a]**

Bảng dưới đây tổng hợp các nghiệp vụ chính mà Lead, Member và Client có thể thực hiện. Với các dòng có đánh
dấu (*), quyền của Member chỉ áp dụng cho job DO CHÍNH MEMBER ĐÓ TẠO RA (xem mục 3.3).

| Nghiệp vụ | Lead | Member | Client |
|---|---|---|---|
| Quản lý thành viên & Workspace/Project | ✔ | — | — |
| Cấu hình cách tính chi phí Workspace | ✔ | — | — |
| Cấu hình mẫu mặc định | ✔ | — | — |
| Mua gói Credit (cho bản thân) | ✔ | ✔ | ✔ |
| Cấu hình API key cá nhân | ✔ | ✔ | ✔ |
| Tạo yêu cầu xử lý (đơn/hàng loạt) | ✔ | ✔ | — |
| Dịch, sửa phụ đề, chọn giọng | ✔ | ✔ | — |
| Tạo/tinh chỉnh phương án tóm tắt | ✔ | ✔ | — |
| Kiểm tra chất lượng & phê duyệt | ✔ (mọi job) | ✔ (*chỉ job của mình) | — |
| Bỏ qua lỗi chất lượng — override (có lý do) | ✔ (mọi job) | ✔ (*chỉ job của mình) | — |
| Xác nhận tại các mốc quan trọng | ✔ (mọi job) | ✔ (*chỉ job của mình) | — |
| Xem tiến trình & kết quả (mọi job trong Project) | ✔ | ✔ | ✔ |

Platform Super Admin không nằm trong ma trận role Workspace ở trên. Quyền này chỉ mở khu vực quan sát
toàn nền tảng theo §5.8 và không tự biến tài khoản thành Lead của các Workspace.

### 7.2 Danh sách các điểm cần xác nhận thêm

Tổng hợp các giả định/khoảng trống nghiệp vụ phát sinh trong quá trình biên soạn, cần được xác nhận trước
khi chuyển sang giai đoạn thiết kế chi tiết:

1. Vai trò "Lead" có kế thừa đúng toàn bộ quyền hạn của "Admin" ở bản 1.0 hay không, hay cần tách riêng
   thêm vai trò quản trị khác?
2. Hệ số giá token "y" trong công thức Trường hợp 2 sẽ được xác định như thế nào — cố định toàn hệ thống
   hay khác nhau theo loại thao tác/nhà cung cấp AI?
3. Chi tiết các gói Credit (mức giá, số lượng Credit tương ứng, hình thức thanh toán) sẽ được quy định ra sao?
4. Khi số dư Credit không đủ để thực hiện một thao tác, hệ thống sẽ chặn ngay từ đầu hay xử lý theo cách khác?
5. Một Workspace có thể có nhiều hơn 1 Lead (đồng sở hữu) trong tương lai hay không, hay luôn giới hạn đúng
   1 Lead?
6. ~~Có cần khôi phục lại một dạng vai trò xem-only cho khách hàng không?~~ **✅ ĐÃ CHỐT** — dùng role
   `Client` ở cấp Workspace, kết hợp Project assignment.
7. ~~Member có được tự thêm Member/Client khác vào Project không?~~ **✅ ĐÃ CHỐT cho bản hiện tại** — chỉ
   Lead quản lý thành viên Workspace và Project assignment; Member/Client không tự cấp quyền cho user khác.
8. Client có cần thêm quyền tương tác nhẹ ngoài xem thuần tuý không (ví dụ bình luận/yêu cầu chỉnh sửa)?
   Hiện Client vẫn là read-only; nếu bổ sung sau nên dùng capability riêng thay vì tạo thêm role.
