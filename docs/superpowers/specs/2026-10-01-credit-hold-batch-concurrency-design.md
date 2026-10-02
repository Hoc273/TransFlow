# Credit Hold, Cost Estimate & Batch Concurrency — Design

- **Ngày:** 2026-10-01
- **Trạng thái:** Đã duyệt thiết kế, chờ review spec
- **Module:** `credit` (A), `media_job`, `batch` (B), frontend, docs
- **Thay thế:** quyết định "pre-authorize để Phase 2" tại `docs/Credit_Coefficient_Calculation.md` (mục hiện ở dòng ~533) — nay đưa vào MVP.

## 1. Vấn đề

Credit đang trả sau theo từng stage: `requireCredit` → `canAffordUsage` chặn trước mỗi stage AI, thiếu thì stage
`FAILED` với `INSUFFICIENT_CREDIT`. Lúc tạo job chỉ kiểm tra `balance > 0`. Batch tạo và dispatch ngay cả 20 job.

Hệ quả: với 100 credit và một batch 10 video cần ~340 credit, mọi job cùng chạy STT/TRANSLATE song song, cùng cạn
credit giữa chừng → **0 video hoàn chỉnh + 10 job FAILED**, credit đã tiêu không ra sản phẩm.

Thêm nữa, cả 20 job cùng đổ vào hàng đợi trên 1 VPS (mọi stage chia nhau `MEDIA_STAGE_CONSUMERS=3`).

## 2. Mục tiêu / Phi mục tiêu

**Mục tiêu**
1. Trước khi tạo batch, user thấy ước tính chi phí và số video chạy đủ được.
2. Job chỉ bắt đầu khi giữ chỗ được toàn bộ chi phí ước tính; thiếu credit thì **chờ** (`WAITING_CREDIT`), không FAILED;
   nạp thêm thì tự chạy tiếp.
3. Mỗi batch chạy song song tối đa N job (mặc định 2), job tạo sớm chạy trước.

**Phi mục tiêu**
- Không cho nợ (balance không bao giờ < 0).
- Không thay đổi công thức giá `usageCost` hay bảng giá versioned.
- Không đổi giới hạn consumer toàn cục `MEDIA_STAGE_CONSUMERS`.
- Không thêm hàng đợi ưu tiên giữa các batch / user.

## 3. Ước tính chi phí

### 3.1 Đơn vị ước tính theo stage

Đầu vào: `durationSec = media_assets.duration_ms / 1000` (làm tròn lên) và cấu hình job.

| Stage | Capability | Đơn vị | Công thức | Điều kiện |
|---|---|---|---|---|
| STT | `STT` | giây | `durationSec` | luôn |
| SUMMARIZE (hybrid) | `SUMMARIZE_SCRIPT` | token | `transcriptTokens × 2 + PROMPT_OVERHEAD` | recipe có SUMMARIZE |
| VISION | `VISION` | token | `keyframes × TOKENS_PER_FRAME` | `visualContextEnabled` |
| TRANSLATE | `TRANSLATE` | token | `transcriptTokens × 2 + PROMPT_OVERHEAD` | luôn (recipe localization) |
| TTS | `TTS` | ký tự | `durationSec × CHARS_PER_SEC` | `outputAudioMode ≠ ORIGINAL_ONLY` |
| RENDER | `RENDER` | giây | `durationSec` | luôn |

Với `transcriptTokens = durationSec × WORDS_PER_SEC × TOKENS_PER_WORD`.

Hằng số (cấu hình qua `app.credit.estimate.*`, giá trị mặc định):
`WORDS_PER_SEC = 2.5`, `TOKENS_PER_WORD = 1.5`, `PROMPT_OVERHEAD = 1500`, `CHARS_PER_SEC = 15`,
`TOKENS_PER_FRAME` và `keyframes` lấy theo cấu hình VLM hiện có, `SAFETY_FACTOR = 1.2`.

EXTRACT_AUDIO, SOURCE_SEPARATION, AUDIO_MIX hiện không tính credit → không ước tính.

### 3.2 Đổi đơn vị → credit

`CreditService` thêm hàm công khai, dùng **chính** `usageCost` đang dùng cho `chargeUsage`:

```java
BigDecimal estimateCost(UUID workspaceId, UUID performedByUserId, String capability, long units,
                        boolean hasPersonalApiKey, String providerScope, Instant pricedAt);
```

Provider (BYOK hay platform, `providerScope`) resolve qua `ProviderResolverService` cho từng capability như lúc
chạy thật; `pricedAt = now` khi ước tính trước tạo, `job.createdAt` khi ước tính cho hold. Tổng cộng các stage
rồi nhân `SAFETY_FACTOR`, làm tròn 4 chữ số.

Đơn vị `MediaJobCostEstimator` (package `media_job.pipeline`, mới) chứa toàn bộ logic 3.1 + gọi `estimateCost`.
Dùng chung cho endpoint ước tính và cho việc tạo hold.

### 3.3 Endpoint

`POST /api/workspaces/{workspaceId}/projects/{projectId}/batches/estimate`
— body giống `CreateBatchRequest` (`sourceAssetIds`, `targetLang`, `sharedConfig`). Quyền: `requireProjectWriteAccess`.

```json
{
  "code": 1000, "message": "...",
  "data": {
    "items": [
      { "assetId": "...", "durationSec": 312,
        "stages": [ { "stage": "STT", "units": 312, "credit": 3.12 }, ... ],
        "totalCredit": 34.0 }
    ],
    "totalCredit": 340.0,
    "availableBalance": 100.0,
    "affordableVideos": 2
  }
}
```

`affordableVideos` = số video **đầu danh sách** (đúng thứ tự sẽ chạy) có tổng cộng dồn ≤ `availableBalance`.
Asset thiếu `duration_ms` → `VALIDATION_ERROR` (asset chưa xử lý xong metadata thì cũng không tạo batch được).

### 3.4 UI

`CreateBatchModal` gọi estimate (debounce) mỗi khi danh sách asset / cấu hình đổi. Hiển thị:
"Batch cần khoảng **340** credit, bạn có **100** — đủ cho khoảng **2** video."
Nếu thiếu: nút **Nạp thêm** (tới trang gói credit) và **Vẫn chạy**. Đủ thì nút tạo bình thường.
Bản mobile (`MobileBatch*`) hiển thị cùng dòng tóm tắt.

## 4. Giữ chỗ credit (Credit Hold)

### 4.1 Dữ liệu — migration `V8__credit_holds.sql`

```sql
CREATE TABLE credit_holds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_user_id   UUID NOT NULL REFERENCES users(id),
    media_job_id    UUID NOT NULL REFERENCES media_jobs(id) ON DELETE CASCADE,
    amount          NUMERIC(14,4) NOT NULL CHECK (amount >= 0),
    consumed        NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (consumed >= 0),
    status          VARCHAR NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RELEASED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_credit_holds_active_job ON credit_holds(media_job_id) WHERE status = 'ACTIVE';
CREATE INDEX ix_credit_holds_payer_active ON credit_holds(payer_user_id) WHERE status = 'ACTIVE';
```

+ thêm `'WAITING_CREDIT'` vào CHECK `media_jobs.status`. Một job tối đa 1 hold `ACTIVE`; hold cũ `RELEASED` giữ lại
làm lịch sử (rerun tạo hold mới).

Không có `credit_transactions` nào cho hold/release — tiền chỉ thật sự rời tài khoản qua `AI_USAGE` như hiện nay.

### 4.2 Số dư khả dụng

```
remaining(hold)  = max(0, amount − consumed)
available(payer) = balance − Σ remaining(hold ACTIVE của payer)
```

Payer theo `resolvePayer` hiện có (Lead khi `LEAD_PAYS_ALL`). `CreditBalanceResponse` thêm `heldAmount`,
`availableBalance` (giữ `balance` như cũ).

### 4.3 Interface `CreditHoldService` (module credit, công khai)

```java
enum HoldResult { HELD, INSUFFICIENT }
HoldResult acquire(UUID workspaceId, UUID performedByUserId, UUID jobId, BigDecimal amount);
void release(UUID jobId, boolean notify);       // idempotent; không có hold ACTIVE → no-op
BigDecimal available(UUID workspaceId, UUID performedByUserId);
BigDecimal remainingForJob(UUID jobId);         // 0 nếu không có hold ACTIVE
```

Mọi thao tác ghi khoá `credit_accounts` của payer `FOR UPDATE` trước (cùng thứ tự khoá với `chargeUsage`, tránh
deadlock). `acquire` khi job đã có hold ACTIVE → trả `HELD` không tạo thêm (idempotent).

### 4.4 Vòng đời

**Bắt đầu job** — trong `MediaPipelineDispatcher.dispatchNext`, ngay trước khi claim stage đầu tiên mà job chưa có
hold ACTIVE (lần chạy đầu, hoặc sau rerun / resume):
1. `amount = MediaJobCostEstimator.estimateRemaining(job)` — chỉ các stage chưa `COMPLETED`/`SKIPPED`.
2. `acquire(...)`. `HELD` → dispatch như cũ. `INSUFFICIENT` → `job.status = WAITING_CREDIT`, không publish,
   không đổi stage; thông báo `JOB_WAITING_CREDIT` (1 lần mỗi lần chuyển trạng thái).

Ước tính = 0 (toàn BYOK và giá x = 0) → không tạo hold, dispatch luôn.

**Sau mỗi stage** — `chargeUsage` giữ nguyên chữ ký và hành vi trừ balance; trong cùng giao dịch, nếu job có hold
ACTIVE thì `consumed += cost`. Để biết job, thêm overload nhận `UUID mediaJobId` (các call site trong
`MediaStageExecutionService.chargeAiUsage` và `MediaCallbackServiceImpl` truyền `job.getId()`).

Điều kiện trừ ở `chargeUsage`: `cost ≤ balance` (như cũ). Không đòi `cost ≤ available` vì provider đã chạy xong — phần
vượt hold lấy từ số dư tự do, có thể "lấn" hold của job khác. Không cho nợ: `cost > balance` vẫn `INSUFFICIENT_CREDIT`.

**Pre-flight `requireCredit`** (trước mỗi stage AI và trước RENDER) đổi điều kiện từ `balance ≥ cost` thành
`available + remainingForJob(job) ≥ cost`. Thiếu → thay vì ném `INSUFFICIENT_CREDIT` làm stage FAILED: stage về
`PENDING` (attempt không tính), job `WAITING_CREDIT`, `release(jobId, notify=false)` (để credit còn lại phục vụ job
khác), rồi dừng. **Không** phát event ở đây — nếu phát, resumer sẽ đánh thức lại chính job này, nó lại thiếu, lại release
→ vòng lặp vô hạn. Khi chạy tiếp, `dispatchNext` sẽ ước tính lại phần còn lại và giữ chỗ mới.

**Kết thúc** — `release(jobId, notify=true)` khi job chuyển sang `COMPLETED`, `FAILED`, `CANCELLED`, hoặc bị
`MediaJobExpiryService` dọn. Gọi trong cùng giao dịch đổi trạng thái. Chỉ khi phần remaining được trả > 0 mới phát
`CreditAvailableEvent`.

**Rerun-from-stage / batch retry** — job đã release hold khi FAILED; rerun đặt stage về PENDING rồi `dispatchNext`
ước tính lại phần còn lại → hold mới. Stage đã COMPLETED không bị tính lại (giữ đúng quy tắc rerun không trừ thêm).

**Manual checkpoint** — hold giữ nguyên khi job dừng chờ xác nhận. Giới hạn trên là retention 3 ngày (job hết hạn →
release).

**Huỷ** — job `WAITING_CREDIT` không có stage PROCESSING → huỷ ngay thành `CANCELLED`. Batch cancel xét cả
`WAITING_CREDIT`.

### 4.5 Tự chạy tiếp

`CreditAvailableEvent(payerUserId)` (Spring `ApplicationEvent`, xử lý `@TransactionalEventListener(AFTER_COMMIT)`)
được phát khi: `purchasePackage`, `adminAdjustCredit` với amount > 0, `grantInitialCredit`, `release(…, notify=true)` có remaining > 0.

Listener (module media_job, `CreditWaitingJobResumer`): lấy các job `WAITING_CREDIT` có payer đó, sắp theo
`created_at` tăng dần, lần lượt đặt `status = PENDING` và gọi `dispatchNext`. Dừng sớm ở job đầu tiên lại rơi về
`WAITING_CREDIT` (giữ đúng thứ tự FIFO: job sau không được nhảy lên trước job trước). Vì payer có thể là Lead của
nhiều workspace, truy vấn theo danh sách job đã lưu `payer_user_id` khi vào WAITING_CREDIT → thêm cột
`media_jobs.waiting_payer_user_id UUID NULL` (đặt khi vào WAITING_CREDIT, xoá khi rời).

Lưới an toàn: `@Scheduled` mỗi 60s chạy cùng logic cho mọi payer có job WAITING_CREDIT (bắt các trường hợp mất
event, ví dụ restart giữa commit và listener).

### 4.6 Ảnh hưởng chỗ khác

- `MediaJobServiceImpl` create/rerun: job lẻ đổi check `balance > 0` thành `available > 0` (vẫn báo
  `INSUFFICIENT_CREDIT` ngay, khỏi tạo job chờ vô ích). Job con của batch **không** check — thiếu thì vào WAITING_CREDIT.
- `BatchServiceImpl.recomputeStatus`: `WAITING_CREDIT` tính là đang chạy dở (`PROCESSING`).
- `MediaStageRecoveryService` / `BatchStatusReconciler`: bỏ qua job `WAITING_CREDIT`.
- Notification mới: `JOB_WAITING_CREDIT`.

## 5. Giới hạn song song theo batch

Cấu hình `app.batch.max-parallel-jobs` (env `BATCH_MAX_PARALLEL_JOBS`, mặc định 2).

Trong `dispatchNext`, khi job có `batchId` và đang định claim một stage:
1. Khoá dòng `localization_batches FOR UPDATE` (thứ tự khoá: batch → job, mọi chỗ khoá cả hai phải theo thứ tự này).
2. `running = số job trong batch có ≥1 stage PROCESSING hoặc CANCEL_REQUESTED`, không tính chính job này.
3. `running ≥ max` → không dispatch, job giữ `PENDING` (UI: "Đang xếp hàng"). Không tạo hold.
4. Ngược lại → hold (mục 4.4) rồi dispatch.

Khi một stage của job thuộc batch kết thúc (callback / execution xong, FAILED, CANCELLED, hoặc job vào
`WAITING_CREDIT`), sau commit gọi `BatchSlotScheduler.fillSlots(batchId)`: lấy các job `PENDING` của batch theo
`created_at` tăng dần, `dispatchNext` từng job cho tới khi hết suất. Job vừa xong stage thường cũng được xét — vì nó
tạo sớm nhất nên tự giành lại suất, giúp video đầu danh sách xong trọn trước.

Job đang dừng ở checkpoint Manual hoặc chờ QA không có stage PROCESSING → không chiếm suất.

`createBatch` vẫn tạo đủ job; vòng `dispatchNext` cho từng job tự dừng ở mức trần.

Thứ tự hai cổng: **song song trước, credit sau** — job phải có suất rồi mới giữ chỗ, để không giữ credit cho job chưa
được chạy.

## 6. Kiểu dữ liệu & API

- `MediaJob.JobStatus` thêm `WAITING_CREDIT`; frontend `MediaJobStatus`, `StatusBadge` (nhãn vi/en/ko).
- `CreditBalanceResponse` thêm `heldAmount`, `availableBalance`; trang credit hiển thị "Khả dụng / Đang giữ chỗ".
- Endpoint mới §3.3 + type `BatchEstimateResponse`.
- Không thêm `ErrorCode` mới (WAITING_CREDIT là trạng thái, không phải lỗi).

## 7. Tài liệu phải sửa

`docs/SRS.md` (business rules credit & batch), `docs/Database_Design.md` (bảng `credit_holds`, cột
`waiting_payer_user_id`, status mới), `docs/API_Contract.md` (endpoint estimate, balance fields, job status),
`docs/System_Architecture.md` (state machine thêm WAITING_CREDIT, cổng song song),
`docs/Credit_Coefficient_Calculation.md` (thay quyết định Phase 2).

## 8. Kiểm thử

**Unit**
- `MediaJobCostEstimator`: từng capability bật/tắt theo cấu hình; BYOK chỉ còn phí x; `affordableVideos` cộng dồn.
- `estimateCost` khớp `chargeUsage` với cùng đầu vào.
- `CreditHoldService`: acquire đủ/thiếu, idempotent, release idempotent, `available` trừ đúng remaining, consumed vượt
  amount → remaining = 0.

**Service-level (Mockito như test hiện có; repository mock, khẳng định thứ tự gọi khoá)**
- 100 credit, batch 5 video × ~34 credit, max-parallel 2: tối đa 2 hold ACTIVE; job thứ 3 vào WAITING_CREDIT khi
  hết khả dụng; không job nào FAILED vì credit.
- Nạp thêm → `CreditAvailableEvent` → job WAITING_CREDIT chạy tiếp đúng thứ tự `created_at`.
- Overrun: chi phí thực > hold → balance trừ đủ, job khác bị thiếu ở pre-flight → WAITING_CREDIT (không FAILED).
- `chargeUsage` và `acquire`/`release` đều lấy `findByUserIdForUpdate` trước khi đọc hold; cổng song song lấy
  `findWithLockById(batch)` trước khoá job (verify bằng `InOrder`). Tính đúng khi đồng thời dựa vào khoá này — không có
  test đa luồng thật vì môi trường test là H2/mock.
- Cổng song song: batch có 2 job đang PROCESSING, max 2 → job thứ 3 không publish; 1 job xong → `fillSlots` dispatch
  job PENDING sớm nhất.
- Resumer không lặp: job vào WAITING_CREDIT do pre-flight → không có event nào được phát.
- Huỷ job/batch đang WAITING_CREDIT → CANCELLED, hold released.
- Rerun job FAILED: hold mới chỉ cho stage còn lại.

**Frontend**: `tsc -b` sạch; test cho `CreateBatchModal` hiển thị dòng ước tính và hai nút khi thiếu credit.
