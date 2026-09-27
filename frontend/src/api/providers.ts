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

// ── Wire mapping ──────────────────────────────────────────────────
// Backend (UserAiProviderResponse) dùng `isActive`, capability `TRANSLATE`
// và không có displayName/defaultFor. FE dùng vocabulary `TEXT` + `enabled`
// như ProvidersPage gốc — map tại đây để mọi consumer nhận shape thống nhất.

type UserAiProviderDto = {
  id: string
  protocol: ProviderConfig['protocol']
  capabilities: string[] | null
  baseUrl: string
  apiKeyHint: string | null
  defaultModel: string | null
  defaultForCapabilities?: string[] | null
  healthStatus?: 'UNKNOWN' | 'HEALTHY' | 'DOWN' | null
  isActive?: boolean
  enabled?: boolean
  displayName?: string | null
  defaultFor?: ProviderCapability[] | null
}

type TestConnectionDto = {
  success?: boolean
  ok?: boolean
  message?: string | null
  model?: string | null
  authSuccess?: boolean
  capabilityResults?: TestConnectionResponse['capabilityResults']
}

function capabilityFromWire(capability: string): ProviderCapability {
  const upper = capability.toUpperCase()
  return (upper === 'TRANSLATE' ? 'TEXT' : upper) as ProviderCapability
}

function capabilitiesToWire(capabilities: ProviderCapability[]): string[] {
  return capabilities.map((capability) => (capability === 'TEXT' ? 'TRANSLATE' : capability))
}

export function normalizeProvider(dto: UserAiProviderDto): ProviderConfig {
  const defaultModel = dto.defaultModel ?? ''
  return {
    id: dto.id,
    displayName: dto.displayName || defaultModel || dto.protocol,
    protocol: dto.protocol,
    capabilities: (dto.capabilities ?? []).map(capabilityFromWire),
    defaultFor: (dto.defaultForCapabilities ?? dto.defaultFor ?? []).map(capabilityFromWire),
    baseUrl: dto.baseUrl,
    apiKeyHint: dto.apiKeyHint,
    defaultModel,
    enabled: dto.enabled ?? dto.isActive ?? true,
    keyHealth: dto.healthStatus ?? 'UNKNOWN',
  }
}

// ── CRUD providers ────────────────────────────────────────────────

export async function listProvidersApi(workspaceId?: string): Promise<ProviderConfig[]> {
  void workspaceId
  const rows = await apiRequest<UserAiProviderDto[]>('/users/me/providers')
  return (rows ?? []).map(normalizeProvider)
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
  return apiRequest<UserAiProviderDto>('/users/me/providers', {
    method: 'POST',
    body: {
      protocol: payload.protocol,
      capabilities: capabilitiesToWire(payload.capabilities),
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      defaultModel: payload.defaultModel,
      defaultForCapabilities: capabilitiesToWire(payload.defaultForCapabilities),
    },
  }).then(normalizeProvider)
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
  return apiRequest<UserAiProviderDto>(`/users/me/providers/${providerId}`, {
    method: 'PUT',
    body: {
      protocol: payload.protocol,
      capabilities: payload.capabilities ? capabilitiesToWire(payload.capabilities) : undefined,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey || undefined,
      defaultModel: payload.defaultModel,
      isActive: payload.enabled,
      defaultForCapabilities: payload.defaultForCapabilities
        ? capabilitiesToWire(payload.defaultForCapabilities)
        : undefined,
    },
  }).then(normalizeProvider)
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

// ── Default provider ──────────────────────────────────────────────
// Không có endpoint /default riêng: PUT `defaultForCapabilities` thay thế toàn bộ
// capability default của provider này (API_Contract §11). Backend tự chuyển
// default (user + capability) từ provider cũ sang provider mới, nên chỉ cần đọc
// danh sách hiện tại rồi thêm/bớt đúng capability.

async function replaceProviderDefaults(
  providerId: string,
  change: (current: ProviderCapability[]) => ProviderCapability[],
): Promise<ProviderConfig> {
  const current = normalizeProvider(
    await apiRequest<UserAiProviderDto>(`/users/me/providers/${providerId}`),
  )
  return updateProviderApi(providerId, {
    defaultForCapabilities: change(current.defaultFor),
  })
}

/** Make this provider the user's default for `capability`. `workspaceId` is ignored. */
export function setDefaultProviderApi(
  _workspaceId: string,
  providerId: string,
  body: ProviderDefaultRequest,
): Promise<ProviderConfig> {
  return replaceProviderDefaults(providerId, (current) =>
    current.includes(body.capability) ? current : [...current, body.capability],
  )
}

/** Clear this provider's default for `capability`. `workspaceId` is ignored. */
export function unsetDefaultProviderApi(
  _workspaceId: string,
  providerId: string,
  body: ProviderDefaultRequest,
): Promise<ProviderConfig> {
  return replaceProviderDefaults(providerId, (current) =>
    current.filter((capability) => capability !== body.capability),
  )
}

// ── Test connection ─────────────────────────────────────────────
// The provider test endpoint is user-scoped and accepts the capability to probe.
export function testProviderApi(
  providerId: string,
  capability?: ProviderCapability,
): Promise<TestConnectionResponse> {
  const query = capability
    ? `?capability=${encodeURIComponent(capabilitiesToWire([capability])[0])}`
    : ''
  return apiRequest<TestConnectionDto>(`/users/me/providers/${providerId}/test${query}`, {
    method: 'POST',
  }).then((res) => ({
    ok: res.ok ?? res.success ?? false,
    model: res.model ?? null,
    message: res.message ?? null,
    authSuccess: res.authSuccess ?? res.success ?? res.ok ?? false,
    capabilityResults: res.capabilityResults ?? [],
  }))
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

/** GET /api/tts-voices?language=&platformProviderId= (TtsVoiceController) — platform voices only. */
export function listPlatformTtsVoicesApi(params: { language?: string; platformProviderId?: string } = {}) {
  const search = new URLSearchParams()
  if (params.language) search.set('language', params.language)
  if (params.platformProviderId) search.set('platformProviderId', params.platformProviderId)
  const qs = search.toString()
  return apiRequest<TtsVoice[]>(`/tts-voices${qs ? `?${qs}` : ''}`)
}

type PlatformTtsProviderDto = {
  id: string
  name: string | null
  protocol: ProviderConfig['protocol']
}

/**
 * GET /api/tts-voices/providers — shared platform TTS keys, so a user without
 * BYOK can still pick a voice. Mapped to ProviderConfig with source=PLATFORM.
 */
export async function listPlatformTtsProvidersApi(): Promise<ProviderConfig[]> {
  const rows = await apiRequest<PlatformTtsProviderDto[]>('/tts-voices/providers')
  return (rows ?? []).map((row) => ({
    id: row.id,
    displayName: row.name || row.protocol,
    protocol: row.protocol,
    capabilities: ['TTS'],
    defaultFor: [],
    baseUrl: '',
    apiKeyHint: null,
    defaultModel: '',
    enabled: true,
    source: 'PLATFORM',
  }))
}
