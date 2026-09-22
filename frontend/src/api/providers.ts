import { apiRequest } from '@/lib/api/client'
import type {
  CreateProviderRequest,
  ProviderCapability,
  ProviderConfig,
  ProviderDefaultRequest,
  ProviderPreset,
  ProviderPresetCategory,
  ProviderTestResult,
  TestConnectionResponse,
  TtsVoice,
  TtsVoiceLanguage,
  UpdateProviderRequest,
  UpsertTtsVoiceRequest,
  VoicePreviewResponse,
} from '@/types/provider'

/**
 * Provider API — user-scoped BYOK (API_Contract §11).
 * Backend duy nhất: UserAiProviderController (/users/me/providers)
 * + TtsVoiceController (/tts-voices). Không tồn tại endpoint workspace
 * providers nào — mọi fallback workspace cũ đều 404 nên đã xóa.
 * Các tham số `workspaceId` còn lại chỉ để tương thích
 * chữ ký cũ (@deprecated, bị bỏ qua).
 */

// ── Presets: không có backend (chỉ có Media PresetTemplate, không phải provider preset).
/** @deprecated No backend endpoint — always resolves []. */
export function listPresetsApi(
  _workspaceId: string,
  _category?: ProviderPresetCategory,
): Promise<ProviderPreset[]> {
  return Promise.resolve([])
}

// ── CRUD providers ────────────────────────────────────────────────

export function listProvidersApi(workspaceId?: string): Promise<ProviderConfig[]> {
  void workspaceId
  return apiRequest<ProviderConfig[]>('/users/me/providers')
}

export function createProviderApi(body: CreateProviderRequest): Promise<ProviderConfig>
/** @deprecated Pass body only — workspaceId is ignored. */
export function createProviderApi(
  workspaceId: string,
  body: CreateProviderRequest,
): Promise<ProviderConfig>
export function createProviderApi(
  workspaceIdOrBody: string | CreateProviderRequest,
  body?: CreateProviderRequest,
): Promise<ProviderConfig> {
  const payload = (body ?? workspaceIdOrBody) as CreateProviderRequest
  return apiRequest<ProviderConfig>('/users/me/providers', {
    method: 'POST',
    body: payload,
  })
}

export function updateProviderApi(
  providerId: string,
  body: UpdateProviderRequest,
): Promise<ProviderConfig>
/** @deprecated Pass (providerId, body) — workspaceId is ignored. */
export function updateProviderApi(
  workspaceId: string,
  providerId: string,
  body: UpdateProviderRequest,
): Promise<ProviderConfig>
export function updateProviderApi(
  workspaceIdOrId: string,
  providerIdOrBody: string | UpdateProviderRequest,
  body?: UpdateProviderRequest,
): Promise<ProviderConfig> {
  const providerId =
    typeof providerIdOrBody === 'string' ? providerIdOrBody : (workspaceIdOrId as string)
  const payload = (body ?? providerIdOrBody) as UpdateProviderRequest
  void workspaceIdOrId
  return apiRequest<ProviderConfig>(`/users/me/providers/${providerId}`, {
    method: 'PUT',
    body: payload,
  })
}

export function deleteProviderApi(providerId: string): Promise<void>
/** @deprecated Pass providerId only — workspaceId is ignored. */
export function deleteProviderApi(workspaceId: string, providerId: string): Promise<void>
export function deleteProviderApi(
  workspaceIdOrId: string,
  maybeId?: string,
): Promise<void> {
  const providerId = maybeId ?? workspaceIdOrId
  return apiRequest<void>(`/users/me/providers/${providerId}`, {
    method: 'DELETE',
  })
}

// ── Default provider: không có backend ───────────────────────────

/** @deprecated No backend endpoint — provider `defaultFor` is set via create/update `defaultForCapabilities`. */
export function setDefaultProviderApi(
  _workspaceId: string,
  _providerId: string,
  _body: ProviderDefaultRequest,
): Promise<ProviderConfig> {
  return Promise.reject(new Error('setDefaultProvider is not supported by the backend (API_Contract §11)'))
}

/** @deprecated No backend endpoint. */
export function unsetDefaultProviderApi(
  _workspaceId: string,
  _providerId: string,
  _body: ProviderDefaultRequest,
): Promise<ProviderConfig> {
  return Promise.reject(new Error('unsetDefaultProvider is not supported by the backend (API_Contract §11)'))
}

// ── Test connection ─────────────────────────────────────────────
// Backend `POST /users/me/providers/{id}/test` không nhận `capability`
// (param thừa sẽ bị Spring bỏ qua) — giữ param để tương thích chữ ký cũ.

export function testProviderApi(
  providerId: string,
  _capability?: ProviderCapability,
): Promise<TestConnectionResponse>
/** @deprecated Pass (providerId, capability?) — workspaceId is ignored. */
export function testProviderApi(
  workspaceId: string,
  providerId: string,
  capability?: ProviderCapability,
): Promise<TestConnectionResponse>
export function testProviderApi(
  workspaceIdOrId: string,
  providerIdOrCapability?: string | ProviderCapability,
  _capability?: ProviderCapability,
): Promise<TestConnectionResponse> {
  const providerId =
    typeof providerIdOrCapability === 'string' &&
    (providerIdOrCapability.length > 16 || providerIdOrCapability.includes('-'))
      ? providerIdOrCapability
      : workspaceIdOrId
  void workspaceIdOrId
  void _capability
  return apiRequest<TestConnectionResponse>(`/users/me/providers/${providerId}/test`, {
    method: 'POST',
  })
}

// ── TTS voices ──────────────────────────────────────────────────

export function listTtsVoicesApi(providerId: string, language?: string): Promise<TtsVoice[]>
/** @deprecated Pass (providerId, language?) — workspaceId is ignored. */
export function listTtsVoicesApi(
  workspaceId: string,
  providerId: string,
): Promise<TtsVoice[]>
export function listTtsVoicesApi(
  workspaceIdOrId: string,
  providerIdOrLang?: string,
): Promise<TtsVoice[]> {
  // Old style: (workspaceId, providerId). New style: (providerId, language?).
  // Heuristic: old-style 2nd arg is a provider id; new-style 2nd arg is a language code or undefined.
  const looksLikeOldStyle =
    providerIdOrLang !== undefined &&
    (providerIdOrLang.includes('-') || providerIdOrLang.length > 16)
  if (looksLikeOldStyle) {
    return apiRequest<TtsVoice[]>(`/users/me/providers/${providerIdOrLang}/voices`)
  }
  const providerId = workspaceIdOrId
  const query = providerIdOrLang ? `?language=${encodeURIComponent(providerIdOrLang)}` : ''
  return apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices${query}`)
}

/**
 * Languages available in this provider's ACTIVE cached voice catalog.
 * Không có endpoint backend riêng — aggregate client-side từ voice list.
 */
export function listTtsVoiceLanguagesApi(
  providerId: string,
): Promise<{ languages: TtsVoiceLanguage[] }>
/** @deprecated Pass providerId only — workspaceId is ignored. */
export function listTtsVoiceLanguagesApi(
  workspaceId: string,
  providerId: string,
): Promise<{ languages: TtsVoiceLanguage[] }>
export async function listTtsVoiceLanguagesApi(
  workspaceIdOrId: string,
  maybeId?: string,
): Promise<{ languages: TtsVoiceLanguage[] }> {
  const providerId = maybeId ?? workspaceIdOrId
  const voices = await apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices`)
  const counts = new Map<string, number>()
  for (const v of voices) {
    if (!v.isActive) continue
    const codes = v.languages?.length ? v.languages : [v.language]
    for (const c of codes) {
      const code = c.split('-')[0]?.toLowerCase() || c
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
  }
  return {
    languages: [...counts.entries()].map(([code, voiceCount]) => ({ code, voiceCount })),
  }
}

/** @deprecated No backend endpoint — voices refresh via refreshTtsVoicesApi. */
export function upsertTtsVoiceApi(
  _workspaceId: string,
  _providerId: string,
  _body: UpsertTtsVoiceRequest,
): Promise<TtsVoice> {
  return Promise.reject(new Error('upsertTtsVoice is not supported by the backend (API_Contract §11)'))
}

export function refreshTtsVoicesApi(providerId: string): Promise<TtsVoice[]>
/** @deprecated Pass providerId only — workspaceId is ignored. */
export function refreshTtsVoicesApi(
  workspaceId: string,
  providerId: string,
): Promise<TtsVoice[]>
export function refreshTtsVoicesApi(
  workspaceIdOrId: string,
  maybeId?: string,
): Promise<TtsVoice[]> {
  const providerId = maybeId ?? workspaceIdOrId
  return apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices/refresh`, {
    method: 'POST',
  })
}

export function previewTtsVoiceApi(body: { voiceId: string; text: string }): Promise<VoicePreviewResponse>
/** @deprecated Pass body only — workspaceId/providerId are ignored. */
export function previewTtsVoiceApi(
  workspaceId: string,
  providerId: string,
  body: { voiceId: string; text: string },
): Promise<VoicePreviewResponse>
export function previewTtsVoiceApi(
  workspaceIdOrBody: string | { voiceId: string; text: string },
  _providerId?: string,
  maybeBody?: { voiceId: string; text: string },
): Promise<VoicePreviewResponse> {
  const payload = (maybeBody ?? (typeof workspaceIdOrBody === 'object' ? workspaceIdOrBody : undefined)) as {
    voiceId: string
    text: string
  }
  return apiRequest<VoicePreviewResponse>('/tts-voices/preview', {
    method: 'POST',
    body: payload,
  })
}

/** 4-phase provider validation — không có backend. @deprecated Always rejects. */
export function validateProviderApi(
  _workspaceId: string,
  _providerId: string,
  _capability?: ProviderCapability,
): Promise<ProviderTestResult> {
  return Promise.reject(new Error('validateProvider is not supported by the backend (API_Contract §11)'))
}

/** GET /api/tts-voices?language=&providerSource= (TtsVoiceController) */
export function listPlatformTtsVoicesApi(params: { language?: string; providerSource?: string } = {}) {
  const search = new URLSearchParams()
  if (params.language) search.set('language', params.language)
  if (params.providerSource) search.set('providerSource', params.providerSource)
  const qs = search.toString()
  return apiRequest<TtsVoice[]>(`/tts-voices${qs ? `?${qs}` : ''}`)
}
