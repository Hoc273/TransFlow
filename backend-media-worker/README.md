# TransFlow Media Studio — Backend Media Worker

Dịch vụ **Media Processing Worker** độc lập của hệ thống **TransFlow Media Studio (v3.3 / SRS v1.4b)**, chịu trách nhiệm xử lý các tác vụ đa phương tiện nặng (audio/video processing) bằng **Python**, **FFmpeg**, **ffprobe** và **pydub**.

---

## 1. Vai trò & Kiến trúc

- **Stateless hoàn toàn**: Không kết nối trực tiếp vào cơ sở dữ liệu PostgreSQL.
- **Dispatch nội bộ**: Nhận yêu cầu từ Core Orchestrator (Spring Boot) qua các internal HTTP endpoints (`/internal/media/...`).
- **Xác thực HMAC-SHA256 Callback**: Đối với các tác vụ dài chạy nền (Background Tasks) như `render` và `audio-mix`, worker gửi thông báo tiến độ và kết quả về Spring Boot thông qua webhook được ký bằng header `X-Timestamp` và `X-Signature`.
- **Graceful Cancellation**: Hỗ trợ hủy tác vụ đang chạy (`cancel_registry`) mà không để rác tài nguyên tạm thời hoặc treo job.
- **Object Storage**: Đọc và ghi media artifacts (WAV, MP4, SRT, VTT) trực tiếp với MinIO / S3.

---

## 2. Danh mục API (`/internal/media/...`)

| Endpoint | Method | Mô tả | Chế độ |
|---|---|---|---|
| `/internal/media/extract-audio` | `POST` | Tách track âm thanh gốc từ video lưu thành file WAV. | Đồng bộ (Sync) |
| `/internal/media/audio-mix` | `POST` | Trộn âm thanh theo `MixPlan` (giọng TTS, nhạc nền/vocal stem, ducking). | Bất đồng bộ + Callback |
| `/internal/media/audio-mix/{correlation_id}/cancel` | `POST` | Hủy tiến trình trộn âm thanh đang thực thi. | Đồng bộ (Sync) |
| `/internal/media/render` | `POST` | Dựng video hoàn chỉnh: cắt ghép cut-ranges, ghép audio, burn Hard-sub / mux Soft-sub, reframing tỷ lệ khung hình, subtitle presentation layers. | Bất đồng bộ + Callback |
| `/internal/media/render/{correlation_id}/cancel` | `POST` | Hủy tiến trình render video đang thực thi. | Đồng bộ (Sync) |
| `/internal/media/probe` | `POST` | Phân tích metadata video/audio bằng `ffprobe` (codec, duration, streams, resolution). | Đồng bộ (Sync) |
| `/internal/media/frames/extract` | `POST` | Trích xuất keyframes tại các mốc thời gian phục vụ phân tích ngữ cảnh hình ảnh VLM. | Đồng bộ (Sync) |
| `/internal/media/capabilities` | `GET` | Cung cấp danh sách capability kỹ thuật của worker cho Spring Boot. | Đồng bộ (Sync) |
| `/health` | `GET` | Health check & số lượng render đang kích hoạt. | Đồng bộ (Sync) |

---

## 3. Cấu trúc thư mục

```text
backend-media-worker/
├── Dockerfile                   # Multi-stage image với FFmpeg và fonts DejaVu
├── requirements.txt             # Thư viện Python chính & test dependencies
├── pytest.ini                   # Cấu hình kiểm thử tự động pytest
├── README.md                    # Tài liệu kỹ thuật này
├── app/
│   ├── main.py                  # Khởi tạo FastAPI application & lifespan
│   ├── api/
│   │   ├── audio_mix.py         # Endpoint xử lý Audio Mix (CT8)
│   │   ├── capabilities.py      # Endpoint quảng bá capability (CT10.2)
│   │   ├── extract_audio.py     # Endpoint tách audio WAV từ video
│   │   ├── frames.py            # Endpoint trích xuất keyframes cho VLM (M17.1-A)
│   │   ├── probe.py             # Endpoint probe video metadata (ffprobe)
│   │   └── render.py            # Endpoint render video chính (Hard-sub/Soft-sub)
│   ├── core/
│   │   ├── capability.py        # Định nghĩa các capability và feature cờ
│   │   └── config.py            # Pydantic Settings (MinIO, Callback Secret,...)
│   └── services/
│       ├── callback.py          # HTTP Client gửi callback có ký HMAC & retry
│       ├── cancel_registry.py   # Registry quản lý trạng thái hủy job
│       ├── ffmpeg.py            # Wrapper lệnh FFmpeg / ffprobe an toàn
│       ├── frame_sampler.py     # Lấy mẫu khung hình video base64
│       ├── generative_compose.py# Composition kịch bản tóm tắt đa phương thức
│       ├── hmac.py              # Ký HMAC-SHA256 payload
│       ├── legacy_render_audio.py# Fallback audio mapping tương thích
│       ├── media_probe.py       # Phân tích kỹ thuật video
│       ├── mix_executor.py      # Thực thi bộ trộn âm thanh
│       ├── render_validation.py # Kiểm tra chất lượng kỹ thuật video trước khi upload
│       └── storage.py           # MinIO / S3 client
└── tests/                       # Bộ kiểm thử 199 unit & contract tests
```

---

## 4. Cài đặt & Khởi chạy

### 4.1 Cài đặt môi trường cục bộ
Yêu cầu:
- Python 3.11+
- FFmpeg & ffprobe đã được cài đặt trong `PATH`
- MinIO / S3 đang hoạt động

```bash
# Cài đặt dependencies
pip install -r requirements.txt

# Khởi chạy server development
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4.2 Chạy bằng Docker
```bash
docker build -t transflow-media-worker .
docker run -p 8000:8000 \
  -e MEDIA_WORKER_MINIO_ENDPOINT="http://host.docker.internal:9000" \
  -e MEDIA_WORKER_CALLBACK_SECRET="change-me" \
  transflow-media-worker
```

---

## 5. Chạy Kiểm thử (Testing)

```bash
python -m pytest
```
Bộ test gồm 199 test cases kiểm tra toàn diện:
- Tạo filtergraph và câu lệnh FFmpeg cho Hard-sub, Soft-sub, và reframe aspect ratio.
- Xử lý mix audio, ducking, và timeline synchronization.
- Ký HMAC-SHA256 và xác thực payload callback.
- Validate video probe, duration tolerance, và presentation layers v2.
