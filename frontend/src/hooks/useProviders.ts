import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createProviderApi,
  deleteProviderApi,
  listPresetsApi,
  listProvidersApi,
  listTtsVoiceLanguagesApi,
  listTtsVoicesApi,
  previewTtsVoiceApi,
  refreshTtsVoicesApi,
  setDefaultProviderApi,
  testProviderApi,
  unsetDefaultProviderApi,
  upsertTtsVoiceApi,
  updateProviderApi,
  validateProviderApi,
} from '@/api/providers'
import { STALE, queryKeys } from '@/lib/queryClient'
import type {
  CreateProviderRequest,
  ProviderCapability,
  ProviderPresetCategory,
  ProviderTestResult,
  UpsertTtsVoiceRequest,
  UpdateProviderRequest,
} from '@/types/provider'

export function usePresets(workspaceId: string | undefined, category?: ProviderPresetCategory) {
  return useQuery({
    queryKey: queryKeys.providerPresets(workspaceId ?? '', category),
    queryFn: () => listPresetsApi(workspaceId!, category),
    enabled: !!workspaceId,
    staleTime: STALE.static,
  })
}

export function useProviders(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.providers(workspaceId ?? ''),
    queryFn: () => listProvidersApi(workspaceId!),
    enabled: !!workspaceId,
    staleTime: STALE.static,
  })
}

export function useTtsVoices(
  workspaceId: string | undefined,
  providerId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.ttsVoices(workspaceId ?? '', providerId ?? ''),
    queryFn: () => listTtsVoicesApi(workspaceId!, providerId!),
    enabled: !!workspaceId && !!providerId,
  })
}

/**
 * Languages available in a provider's ACTIVE cached voice catalog
 * (aggregated from tts_voices.languages). Read-only cache view — a stale
 * EN-only catalog reports only EN until an explicit refresh.
 */
export function useTtsVoiceLanguages(
  workspaceId: string | undefined,
  providerId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.ttsVoiceLanguages(workspaceId ?? '', providerId ?? ''),
    queryFn: async () => {
      const response = await listTtsVoiceLanguagesApi(workspaceId!, providerId!)
      return response.languages
    },
    enabled: !!workspaceId && !!providerId,
    placeholderData: [],
  })
}

function invalidateTtsVoices(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId?: string,
  providerId?: string,
) {
  if (workspaceId && providerId) {
    void qc.invalidateQueries({ queryKey: queryKeys.ttsVoices(workspaceId, providerId) })
    // Refresh/upsert changes the catalog → the language aggregation follows.
    void qc.invalidateQueries({ queryKey: queryKeys.ttsVoiceLanguages(workspaceId, providerId) })
  }
}

export function useRefreshTtsVoices(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (providerId: string) => refreshTtsVoicesApi(workspaceId!, providerId),
    onSuccess: (_voices, providerId) => invalidateTtsVoices(qc, workspaceId, providerId),
  })
}

export function useUpsertTtsVoice(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, body }: { providerId: string; body: UpsertTtsVoiceRequest }) =>
      upsertTtsVoiceApi(workspaceId!, providerId, body),
    onSuccess: (_voice, variables) =>
      invalidateTtsVoices(qc, workspaceId, variables.providerId),
  })
}

let activePreviewAudio: HTMLAudioElement | null = null

export function defaultVoicePreviewText(language?: string | null) {
  return language?.toLowerCase().startsWith('vi')
    ? 'Xin chào, đây là giọng đọc mẫu.'
    : 'Hello, this is a sample voice preview.'
}

export function useVoicePreview(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async ({
      providerId,
      voiceId,
      language,
    }: {
      providerId: string
      voiceId: string
      language?: string | null
    }) => {
      const result = await previewTtsVoiceApi(workspaceId!, providerId, {
        voiceId,
        text: defaultVoicePreviewText(language),
      })
      activePreviewAudio?.pause()
      const audio = new Audio(result.audioUrl)
      activePreviewAudio = audio
      audio.addEventListener('ended', () => {
        if (activePreviewAudio === audio) activePreviewAudio = null
      }, { once: true })
      await audio.play()
      return result
    },
  })
}

function invalidateProviders(qc: ReturnType<typeof useQueryClient>, workspaceId?: string) {
  if (workspaceId) void qc.invalidateQueries({ queryKey: queryKeys.providers(workspaceId) })
}

export function useCreateProvider(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProviderRequest) => createProviderApi(workspaceId!, body),
    onSuccess: () => invalidateProviders(qc, workspaceId),
  })
}

export function useUpdateProvider(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, body }: { providerId: string; body: UpdateProviderRequest }) =>
      updateProviderApi(workspaceId!, providerId, body),
    onSuccess: () => invalidateProviders(qc, workspaceId),
  })
}

export function useSetDefaultProvider(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability: ProviderCapability
    }) => setDefaultProviderApi(workspaceId!, providerId, { capability }),
    onSuccess: () => invalidateProviders(qc, workspaceId),
  })
}

export function useUnsetDefaultProvider(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability: ProviderCapability
    }) => unsetDefaultProviderApi(workspaceId!, providerId, { capability }),
    onSuccess: () => invalidateProviders(qc, workspaceId),
  })
}

export function useTestProvider(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability?: ProviderCapability
    }) => testProviderApi(workspaceId!, providerId, capability),
  })
}

/** 4-phase provider validation hook (docs/07 §L, Q-PV-12). */
export function useValidateProvider(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability?: ProviderCapability
    }): Promise<ProviderTestResult> =>
      validateProviderApi(workspaceId!, providerId, capability),
  })
}

export function useDeleteProvider(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (providerId: string) => deleteProviderApi(workspaceId!, providerId),
    onSuccess: () => invalidateProviders(qc, workspaceId),
  })
}
