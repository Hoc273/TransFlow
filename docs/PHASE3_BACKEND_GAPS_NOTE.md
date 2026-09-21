# Phase 3 — Ghi chú lỗi / thiếu phía Backend (Job Orchestration & Pipeline Execution)

> **Ngày:** 21/09/2026
> **Căn cứ:** `docs/BACKEND_MISSING_IMPLEMENTATION_AND_INTEGRATION_PLAN.md` Phase 3 (§3.1–3.4), `backend-main/src/main/java/com/app/modules/media_job/controller/MediaJobController.java`, `dto/CreateMediaJobRequest.java`, `dto/VoiceRequest.java`, `service/impl/MediaJobServiceImpl.java:94-178,301-315`, `entity/MediaJob.java:28-29,114-120`
> **Kết luận chung:** Backend Phase 3 **đã có đủ 4 endpoint** (không còn missing như tài liệu v2.0 mô tả). Các lỗi còn lại là **contract drift**: FE gửi nhiều field mà BE lặng lẽ bỏ qua (Spring Boot ignore unknown properties), và 2 mismatch về `recipe` + `voice response`.

---

## 1. Tổng quan endpoint (đều ĐÃ CÓ)

| Endpoint | Backend | Trạng thái |
|---|---|---|
| `POST /api/workspaces/{wsId}/media/jobs` | `MediaJobController.java:48-55` → `MediaJobServiceImpl.createJobInternal:94-178` | ✅ Có, validation đầy đủ |
| `GET /api/workspaces/{wsId}/media/jobs/{jobId}` | `MediaJobController.java:69-75` | ✅ Có |
| `POST .../media/jobs/{jobId}/voice` | `MediaJobController.java:85-92` | ✅ Có nhưng thiếu `ttsProviderId` |
| `POST .../media/jobs/{jobId}/stages/{stageName}/rerun` | `MediaJobController.java:103-110` | ✅ Có |

---

## 2. Gap B1 (quan trọng): `VoiceRequest` thiếu `ttsProviderId`

- **Hiện trạng BE:** `dto/VoiceRequest.java:6` → `record VoiceRequest(UUID ttsVoiceId)` — chỉ 1 field.
- **FE gửi:** `frontend/src/api/transformation.ts:193-209` gửi `{ ttsProviderId, ttsVoiceId }` both-or-neither (Phase C).
- **Hậu quả:** `ttsProviderId` bị BE bỏ qua. Job mất thông tin provider, FE phải tự resolve display name qua catalog (`MediaJobPage.tsx:resolveJobVoiceProviderId`). Logic `bindTtsProviderAndVoice` phía BE không thể phân biệt 2 provider cùng voice id.
- **Đề xuất BE:**
  ```java
  public record VoiceRequest(UUID ttsProviderId, UUID ttsVoiceId) {}
  ```
  + validate both-or-neither (422 nếu partial pair như FE comment), `null/null` = deselect (yêu cầu `outputAudioMode == ORIGINAL_ONLY` đã có ở `MediaJobServiceImpl:305-309`).

## 3. Gap B2 (quan trọng): `Voice` trả `200 + MediaJob`, mock/FE cũ expect `204`

- **BE:** `setVoice` trả `ApiResponse<MediaJobResponse> 200`.
- **Mock:** `frontend/mock/index.cjs:1030-1037` trả `204 No Content`.
- **FE cũ:** `selectTransformationVoiceApi` typed `void`.
- **Hậu quả:** FE discard `MediaJob` mới, phải `invalidateQueries` + refetch thêm 1 round-trip. Đã fix phía FE (typed `MediaJob | void`, `useSelectVoice` set query data nếu có).
- **Đề xuất:** Giữ BE `200 + MediaJob` (đúng REST), cập nhật `API_Contract.md §5` và mock trả `200 + job` để khớp.

## 4. Gap B3 (trung bình): `CreateMediaJobRequest` thiếu nhiều field FE đang gửi

BE `CreateMediaJobRequest.java:13-27` hiện có:
`projectId, rootAssetId, recipeId, processingMode, targetLang, requestedDurationSeconds, subtitleMode, outputAudioMode, sourceSeparationEnabled, ttsVoiceId, visualContextEnabled, workflowMode, presetId`

FE `CreateMediaJobBody` (`types/media.ts:464-526`, `batchJobPayload.ts:67-83`, `transformation.ts:110-129`) gửi thêm và BE **lặng lẽ ignore**:

| Field FE gửi | BE hiện tại | Ảnh hưởng |
|---|---|---|
| `sourceLang` | Không có | Mất hint STT, BE luôn autodetect. `MediaJob.sourceLanguage` chỉ set sau STT |
| `ttsProviderId` | Không có | Như B1 — mất provider binding lúc create |
| `keepOriginalAudio` (bool) | Không có (`grep 0 hit`) | BE chỉ suy từ `outputAudioMode == ORIGINAL_ONLY`. FE phải tự map `keepOriginalAudio → outputAudioMode` ở `transformation.ts:120-122`. Nếu FE quên map → `VALIDATION_ERROR` ở `MediaJobServiceImpl:141` |
| `requestedMode` (`FAST`/`STUDIO`) | Không có | Execution mode user chọn bị mất. BE không có `ExecutionDecision` như comment FE `types/media.ts:484-489` |
| `workflowPresetId` (string) | Chỉ có `presetId` (UUID) | FE phải map `presetId ?? workflowPresetId` ở `transformation.ts:123`. `skipPresetResolution` cũng không có → opt-out "no preset" của FE không có tác dụng BE-side |
| `skipPresetResolution` | Không có | Xem trên |
| `enableVlm` | Không có (chỉ `visualContextEnabled`) | VLM toggle của generative summary bị mất |
| `documentId` (legacy alias `rootAssetId`) | Không có | BE yêu cầu `rootAssetId` bắt buộc. FE map `rootAssetId \|\| documentId`. OK nhưng nên document |
| `aspectRatio` | Không có | Reframe ratio chỉ có ở `render-config`, không có lúc create — đúng, nhưng FE type còn lẫn lộn |

**Đề xuất BE:** bổ sung `ttsProviderId, sourceLang, requestedMode, keepOriginalAudio (hoặc accept và map), workflowPresetId alias, skipPresetResolution, enableVlm alias visualContextEnabled`. Trước mắt giữ backward-compat: unknown fields hiện được ignore nên FE vẫn chạy.

## 5. Gap B4 (trung bình): Recipe `summary.generative` vs `summary.script_match`

- **BE:** `MediaJob.java:28-29` → `RECIPE_LOCALIZATION_FULL = "localization.full"`, `RECIPE_SUMMARY_SCRIPT_MATCH = "summary.script_match"`. `createJobInternal:107-111` chỉ accept 2 giá trị này, còn lại `VALIDATION_ERROR`.
- **FE:** `batchJobPayload.ts:104,172` dùng `summary.generative`, `resolveRecipeId` fallback `processingMode HYBRID → summary.extractive`.
- **Hậu quả:** Job generative summary của FE bị BE từ chối `400 VALIDATION_ERROR` khi chuyển mock → BE thật.
- **Đề xuất:** BE accept alias `summary.generative` (map về `summary.script_match`) hoặc FE chuyển sang `summary.script_match`. Cần thống nhất trong `API_Contract.md`.

## 6. Không phải lỗi BE (ghi để tránh tái phát)

- `processingMode` **bắt buộc** với localization (`MediaJobServiceImpl:115-117`). FE fallback `recipeId === 'localization.full' → 'TRANSLATE_ONLY'` ở `transformation.ts:117-119` là **đúng và phải giữ**. Comment cũ "Do not dual-send processingMode" là sai, đã sửa.
- `outputAudioMode` + `ttsVoiceId` consistency check (`MediaJobServiceImpl:140-143`): `ORIGINAL_ONLY ⟺ ttsVoiceId == null`. FE fallback ở `transformation.ts:120-122` là **đúng và phải giữ**.
- `STAGE_NOT_READY`, `VOICE_LANGUAGE_MISMATCH(2900)`, `TERMS_NOT_ACCEPTED(2800)` đã có đầy đủ.
- `rerun` BE accept enum `EXTRACT_AUDIO,SOURCE_SEPARATION,STT,SUMMARIZE,TRANSLATE,TTS,AUDIO_MIX,RENDER`. FE generic (trừ `SKIPPED`, `<= currentOrder`, block khi có `PROCESSING`) là tương thích.

---

## 7. Checklist chuyển mock → BE thật (Phase 3)

1. [ ] BE thêm `ttsProviderId` vào `CreateMediaJobRequest` + `VoiceRequest`
2. [ ] Thống nhất recipe summary (`summary.generative` alias)
3. [ ] Cập nhật `API_Contract.md §5`: voice `200 + MediaJob`, create liệt kê FE-only fields là ignored
4. [ ] Cập nhật mock `voice → 200 + job` (đã làm phía FE handle cả 204/200)
5. [ ] FE đã fix: `selectTransformationVoiceApi → MediaJob | void`, header comment canonical `/media/jobs`, giữ fallback `processingMode/outputAudioMode` với comment đúng
