import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createProviderApi,
  deleteProviderApi,
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
  ProviderPreset,
  ProviderPresetCategory,
  ProviderTestResult,
  UpsertTtsVoiceRequest,
  UpdateProviderRequest,
} from '@/types/provider'

/** @deprecated No backend endpoint — always empty. Kept so unmounted ProvidersPage still compiles. */
export function usePresets(_workspaceId: string | undefined, _category?: ProviderPresetCategory) {
  return useQuery({
    queryKey: queryKeys.providerPresets('me', _category),
    queryFn: (): Promise<ProviderPreset[]> => Promise.resolve([]),
    enabled: false,
    staleTime: STALE.static,
    initialData: [] as ProviderPreset[],
  })
}

export function useProviders(_workspaceId?: string | undefined) {
  void _workspaceId
  return useQuery({
    queryKey: queryKeys.providers('me'),
    queryFn: () => listProvidersApi(),
    staleTime: STALE.static,
  })
}

export function useTtsVoices(
  workspaceIdOrProviderId: string | undefined,
  providerId?: string | undefined,
) {
  // Old style: (workspaceId, providerId). New style: (providerId).
  const resolvedProviderId = providerId ?? workspaceIdOrProviderId
  return useQuery({
    queryKey: queryKeys.ttsVoices('me', resolvedProviderId ?? ''),
    queryFn: () => listTtsVoicesApi(resolvedProviderId!),
    enabled: !!resolvedProviderId,
  })
}

/**
 * Languages available in a provider's ACTIVE cached voice catalog
 * (aggregated client-side from the voice list — no dedicated backend endpoint).
 */
export function useTtsVoiceLanguages(
  workspaceIdOrProviderId: string | undefined,
  providerId?: string | undefined,
) {
  const resolvedProviderId = providerId ?? workspaceIdOrProviderId
  return useQuery({
    queryKey: queryKeys.ttsVoiceLanguages('me', resolvedProviderId ?? ''),
    queryFn: async () => {
      const response = await listTtsVoiceLanguagesApi(resolvedProviderId!)
      return response.languages
    },
    enabled: !!resolvedProviderId,
    placeholderData: [],
  })
}

function invalidateTtsVoices(
  qc: ReturnType<typeof useQueryClient>,
  _workspaceId?: string,
  providerId?: string,
) {
  if (providerId) {
    void qc.invalidateQueries({ queryKey: queryKeys.ttsVoices('me', providerId) })
    // Refresh/upsert changes the catalog → the language aggregation follows.
    void qc.invalidateQueries({ queryKey: queryKeys.ttsVoiceLanguages('me', providerId) })
  }
}

export function useRefreshTtsVoices(_workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (providerId: string) => refreshTtsVoicesApi(providerId),
    onSuccess: (_voices, providerId) => invalidateTtsVoices(qc, undefined, providerId),
  })
}

/** @deprecated No backend endpoint — always fails. Kept for compilation. */
export function useUpsertTtsVoice(_workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, body }: { providerId: string; body: UpsertTtsVoiceRequest }) =>
      upsertTtsVoiceApi('me', providerId, body),
    onSuccess: (_voice, variables) =>
      invalidateTtsVoices(qc, undefined, variables.providerId),
  })
}

let activePreviewAudio: HTMLAudioElement | null = null

export function defaultVoicePreviewText(language?: string | null) {
  return language?.toLowerCase().startsWith('vi')
    ? 'Xin chào, đây là giọng đọc mẫu.'
    : 'Hello, this is a sample voice preview.'
}

export function useVoicePreview(_workspaceId?: string | undefined) {
  void _workspaceId
  return useMutation({
    mutationFn: async ({
      providerId,
      voiceRowId,
      language,
    }: {
      providerId: string
      voiceRowId: string
      language?: string | null
    }) => {
      void providerId
      const result = await previewTtsVoiceApi({
        voiceId: voiceRowId,
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

function invalidateProviders(qc: ReturnType<typeof useQueryClient>, _workspaceId?: string) {
  void qc.invalidateQueries({ queryKey: queryKeys.providers('me') })
}

export function useCreateProvider(_workspaceId?: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProviderRequest) => createProviderApi(body),
    onSuccess: () => invalidateProviders(qc),
  })
}

export function useUpdateProvider(_workspaceId?: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ providerId, body }: { providerId: string; body: UpdateProviderRequest }) =>
      updateProviderApi(providerId, body),
    onSuccess: () => invalidateProviders(qc),
  })
}

/** @deprecated No backend endpoint — always fails. Kept for compilation. */
export function useSetDefaultProvider(_workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability: ProviderCapability
    }) => setDefaultProviderApi('me', providerId, { capability }),
    onSuccess: () => invalidateProviders(qc),
  })
}

/** @deprecated No backend endpoint — always fails. Kept for compilation. */
export function useUnsetDefaultProvider(_workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability: ProviderCapability
    }) => unsetDefaultProviderApi('me', providerId, { capability }),
    onSuccess: () => invalidateProviders(qc),
  })
}

export function useTestProvider(_workspaceId?: string | undefined) {
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability?: ProviderCapability
    }) => testProviderApi(providerId, capability),
  })
}

/** @deprecated No backend endpoint — always fails. Kept for compilation. */
export function useValidateProvider(_workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({
      providerId,
      capability,
    }: {
      providerId: string
      capability?: ProviderCapability
    }): Promise<ProviderTestResult> =>
      validateProviderApi('me', providerId, capability),
  })
}

export function useDeleteProvider(_workspaceId?: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (providerId: string) => deleteProviderApi(providerId),
    onSuccess: () => invalidateProviders(qc),
  })
}
