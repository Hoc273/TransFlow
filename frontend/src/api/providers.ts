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

function normalizeProvider(p: any): ProviderConfig {
  return {
    ...p,
    displayName: p.displayName || p.defaultModel || p.protocol || 'Provider',
    enabled: p.enabled ?? p.isActive ?? true,
    defaultFor: p.defaultFor ?? p.capabilities ?? [],
  }
}

function normalizeVoice(v: any): TtsVoice {
  return {
    ...v,
    displayName: v.displayName || v.voiceId,
    languages: v.languages || (v.language ? [v.language] : ['vi']),
  }
}

export async function listProvidersApi(_workspaceId?: string) {
  try {
    const list = await apiRequest<any[]>('/users/me/providers')
    return (list || []).map(normalizeProvider)
  } catch {
    return []
  }
}

export async function createProviderApi(_workspaceId: string, body: CreateProviderRequest) {
  const res = await apiRequest<any>('/users/me/providers', {
    method: 'POST',
    body,
  })
  return normalizeProvider(res)
}

export async function updateProviderApi(
  _workspaceId: string,
  providerId: string,
  body: UpdateProviderRequest,
) {
  const res = await apiRequest<any>(`/users/me/providers/${providerId}`, {
    method: 'PUT',
    body,
  })
  return normalizeProvider(res)
}

export function deleteProviderApi(_workspaceId: string, providerId: string) {
  return apiRequest<void>(`/users/me/providers/${providerId}`, {
    method: 'DELETE',
  })
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
  _workspaceId: string,
  providerId: string,
  _capability?: ProviderCapability,
) {
  return apiRequest<TestConnectionResponse>(`/users/me/providers/${providerId}/test`, {
    method: 'POST',
  })
}

export async function listTtsVoicesApi(_workspaceId?: string, providerId?: string) {
  try {
    const path = providerId && providerId !== 'platform' && providerId !== 'undefined'
      ? `/users/me/providers/${providerId}/voices`
      : '/tts-voices'
    const list = await apiRequest<any[]>(path)
    return (list || []).map(normalizeVoice)
  } catch {
    return []
  }
}

/** Languages available in this provider's ACTIVE cached voice catalog. */
export async function listTtsVoiceLanguagesApi(workspaceId?: string, providerId?: string) {
  const voices = await listTtsVoicesApi(workspaceId, providerId)
  const langSet = new Set<string>()
  voices.forEach((v) => {
    ;(v.languages || []).forEach((l) => langSet.add(l))
    if (v.language) langSet.add(v.language)
  })
  const languages: TtsVoiceLanguage[] = Array.from(langSet).map((code) => ({
    code,
    voiceCount: voices.filter((v) => v.languages?.includes(code) || v.language === code).length,
  }))
  return { languages }
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

export function refreshTtsVoicesApi(_workspaceId: string, providerId: string) {
  return apiRequest<TtsVoice[]>(`/users/me/providers/${providerId}/voices/refresh`, {
    method: 'POST',
  })
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
