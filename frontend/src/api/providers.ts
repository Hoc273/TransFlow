import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
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

export function listPresetsApi(workspaceId: string, category?: ProviderPresetCategory) {
  const query = category ? `?category=${encodeURIComponent(category)}` : ''
  return apiRequest<ProviderPreset[]>(
    buildWorkspacePath(workspaceId, `/providers/presets${query}`),
  )
}

export function listProvidersApi(workspaceId?: string) {
  return apiRequest<ProviderConfig[]>('/users/me/providers').catch(() =>
    apiRequest<ProviderConfig[]>(buildWorkspacePath(workspaceId || '', '/providers')),
  )
}

export function createProviderApi(workspaceId: string, body: CreateProviderRequest) {
  return apiRequest<ProviderConfig>('/users/me/providers', {
    method: 'POST',
    body,
  }).catch(() =>
    apiRequest<ProviderConfig>(buildWorkspacePath(workspaceId, '/providers'), {
      method: 'POST',
      body,
    }),
  )
}

export function updateProviderApi(
  workspaceId: string,
  providerId: string,
  body: UpdateProviderRequest,
) {
  return apiRequest<ProviderConfig>(`/users/me/providers/${providerId}`, {
    method: 'PUT',
    body,
  }).catch(() =>
    apiRequest<ProviderConfig>(buildWorkspacePath(workspaceId, `/providers/${providerId}`), {
      method: 'PUT',
      body,
    }),
  )
}

export function deleteProviderApi(workspaceId: string, providerId: string) {
  return apiRequest<void>(`/users/me/providers/${providerId}`, {
    method: 'DELETE',
  }).catch(() =>
    apiRequest<void>(buildWorkspacePath(workspaceId, `/providers/${providerId}`), {
      method: 'DELETE',
    }),
  )
}

export function setDefaultProviderApi(
  workspaceId: string,
  providerId: string,
  body: ProviderDefaultRequest,
) {
  return apiRequest<ProviderConfig>(
    buildWorkspacePath(workspaceId, `/providers/${providerId}/default`),
    { method: 'POST', body },
  )
}

export function unsetDefaultProviderApi(
  workspaceId: string,
  providerId: string,
  body: ProviderDefaultRequest,
) {
  return apiRequest<ProviderConfig>(
    buildWorkspacePath(workspaceId, `/providers/${providerId}/default`),
    { method: 'DELETE', body },
  )
}

export function testProviderApi(
  workspaceId: string,
  providerId: string,
  capability?: ProviderCapability,
) {
  const query = capability ? `?capability=${encodeURIComponent(capability)}` : ''
  return apiRequest<TestConnectionResponse>(
    `/users/me/providers/${providerId}/test${query}`,
    { method: 'POST' },
  ).catch(() =>
    apiRequest<TestConnectionResponse>(
      buildWorkspacePath(workspaceId, `/providers/${providerId}/test${query}`),
      { method: 'POST' },
    ),
  )
}

export function listTtsVoicesApi(workspaceId: string, providerId: string) {
  return apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices`).catch(() =>
    apiRequest<TtsVoice[]>(buildWorkspacePath(workspaceId, `/providers/${providerId}/voices`)),
  )
}

/** Languages available in this provider's ACTIVE cached voice catalog. */
export function listTtsVoiceLanguagesApi(workspaceId: string, providerId: string) {
  return apiRequest<{ languages: TtsVoiceLanguage[] }>(
    buildWorkspacePath(workspaceId, `/providers/${providerId}/voice-languages`),
  )
}

export function upsertTtsVoiceApi(
  workspaceId: string,
  providerId: string,
  body: UpsertTtsVoiceRequest,
) {
  return apiRequest<TtsVoice>(
    buildWorkspacePath(workspaceId, `/providers/${providerId}/voices`),
    { method: 'POST', body },
  )
}

export function refreshTtsVoicesApi(workspaceId: string, providerId: string) {
  // Spring Boot uses /users/me/providers/{id}/voices/refresh
  return apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices/refresh`, {
    method: 'POST',
  }).catch(() =>
    apiRequest<TtsVoice[]>(
      buildWorkspacePath(workspaceId, `/providers/${providerId}/refresh-voices`),
      { method: 'POST' },
    ),
  )
}

export function previewTtsVoiceApi(
  workspaceId: string,
  providerId: string,
  body: { voiceId: string; text: string },
) {
  return apiRequest<VoicePreviewResponse>(
    buildWorkspacePath(workspaceId, `/providers/${providerId}/voices/preview`),
    { method: 'POST', body },
  )
}

/** 4-phase provider validation (docs/07 §L, Q-PV-12). */
export function validateProviderApi(
  workspaceId: string,
  providerId: string,
  capability?: ProviderCapability,
) {
  const query = capability ? `?capability=${encodeURIComponent(capability)}` : ''
  return apiRequest<ProviderTestResult>(
    buildWorkspacePath(workspaceId, `/providers/${providerId}/validate${query}`),
    { method: 'POST' },
  )
}

/** GET /api/tts-voices?language=&providerSource= (TtsVoiceController) */
export function listPlatformTtsVoicesApi(params: { language?: string; providerSource?: string } = {}) {
  const search = new URLSearchParams()
  if (params.language) search.set('language', params.language)
  if (params.providerSource) search.set('providerSource', params.providerSource)
  const qs = search.toString()
  return apiRequest<TtsVoice[]>(`/tts-voices${qs ? `?${qs}` : ''}`)
}

