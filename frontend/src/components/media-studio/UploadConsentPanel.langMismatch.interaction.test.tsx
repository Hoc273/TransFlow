// @vitest-environment jsdom
// BA review v1 P2 — direct interaction coverage of the WORKFLOW_PRESET_VOICE_LANG_MISMATCH
// mapping: the create-job submit rejects with that code → the panel surfaces the
// friendly Vietnamese message, never the raw backend exception.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

const { uploadMutate, consentMutate, createJobMutate, invalidateQueries, setQueryData, permissionMock } =
  vi.hoisted(() => ({
    uploadMutate: vi.fn(),
    consentMutate: vi.fn(),
    createJobMutate: vi.fn(),
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    permissionMock: vi.fn(() => true),
  }))

const termsQuery = { data: { termsVersion: '2026-01-01' }, isPending: false, isError: false }
const capabilitiesQuery = {
  data: undefined as unknown,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
  refetchAsync: vi.fn(),
}
const providersQuery = { data: undefined as unknown, isPending: false, isError: false }
const voicesMap = new Map<string, unknown[]>()

vi.mock('@/hooks/useMedia', () => ({
  useConsentMedia: () => ({ mutateAsync: consentMutate, isPending: false }),
  useMediaTermsVersion: () => termsQuery,
  useTransformationCapabilities: () => capabilitiesQuery,
  useUploadMedia: () => ({ mutateAsync: uploadMutate, isPending: false }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => permissionMock(),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => providersQuery,
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? voicesMap.get(providerId) : undefined,
    isPending: false,
  }),
  useVoicePreview: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/api/transformation', () => ({
  createTransformationJobApi: (...args: unknown[]) => createJobMutate(...args),
  selectTransformationVoiceApi: (...args: unknown[]) => vi.fn()(...args),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: { mutationFn: (...a: unknown[]) => unknown }) => ({
    isPending: false,
    mutateAsync: (...args: unknown[]) => opts.mutationFn(...args),
  }),
  useQueryClient: () => ({ invalidateQueries, setQueryData }),
}))

vi.mock('@/lib/queryClient', () => ({
  queryKeys: {
    mediaJobs: (ws: string, projectId: string) => ['mediaJobs', ws, projectId],
    mediaJob: (ws: string, jobId: string) => ['mediaJob', ws, jobId],
  },
}))

vi.mock('@/components/media-studio/WorkflowPresetPicker', () => ({
  WorkflowPresetPicker: () => null,
  presetById: (_presets: unknown, id: string | null) => (id ? { id } : null),
}))

vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => ({ data: [] as unknown[], isPending: false, isError: false }),
}))

vi.mock('@/config/featureFlags', () => ({
  featureFlags: { narrativeReviewAi: false },
}))

vi.mock('@/components/media-studio/VoiceSelector', () => ({
  VoiceSelector: (props: {
    onChange: (s: { providerId: string; voiceId: string }) => void
    onPendingChange?: (s: unknown) => void
  }) => (
    <button
      type="button"
      data-testid="voice-selector-stub"
      onClick={() => props.onChange({ providerId: 'p1', voiceId: 'v1' })}
    >
      stub
    </button>
  ),
}))

const { UploadConsentPanel } = await import('./UploadConsentPanel')

const PROJECTION = {
  protocolVersion: '1',
  supportedExecutionModes: ['FAST'],
  defaultExecutionMode: 'FAST',
  availability: { FAST: { available: true, unavailableReason: null } },
  workerCapability: { state: 'AVAILABLE', workerCount: 1, compatibleFastWorkers: 1, compatibleStudioWorkers: 0 },
  readiness: { status: 'READY', readyExecutionModes: ['FAST'], reasons: [], evaluatedAt: null },
}

describe('UploadConsentPanel — WORKFLOW_PRESET_VOICE_LANG_MISMATCH mapping (BA review v1 P2)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('surfaces the friendly message when the preset voice language mismatches the job target', async () => {
    const { ApiError } = await import('@/types/api')
    uploadMutate.mockResolvedValueOnce({
      assetId: 'asset-1',
      documentId: 'doc-1',
      fileName: 'movie.mp4',
      fileSizeBytes: 1024,
      durationMs: 60000,
      consented: false,
    })
    consentMutate.mockResolvedValueOnce({})
    capabilitiesQuery.data = PROJECTION
    capabilitiesQuery.refetch.mockResolvedValue({ data: PROJECTION })
    providersQuery.data = [
      {
        id: 'p1',
        displayName: 'Cloud TTS',
        protocol: 'openai_compatible',
        capabilities: ['TTS'],
        defaultFor: ['TTS'],
        baseUrl: 'https://example.test',
        apiKeyHint: null,
        defaultModel: 'm',
        enabled: true,
      },
    ]
    voicesMap.set('p1', [
      {
        id: 'v1',
        voiceId: 'voice-1',
        language: 'vi',
        gender: 'FEMALE',
        displayName: 'Vais',
        isActive: true,
        cachedAt: null,
      },
    ])
    createJobMutate.mockRejectedValueOnce(
      new ApiError({
        status: 422,
        code: 'WORKFLOW_PRESET_VOICE_LANG_MISMATCH',
        message: 'Voice language does not match job target language: en vs vi',
      }),
    )

    const { container } = render(<UploadConsentPanel workspaceId="ws" projectId="prj" onCreated={() => {}} />)

    const file = new File(['x'], 'movie.mp4', { type: 'video/mp4' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => {
      expect(uploadMutate).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(container.querySelector('.media-consent-box input[type="checkbox"]')!)
    fireEvent.click(screen.getByText('media:consentButton'))
    await waitFor(() => {
      expect(consentMutate).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByTestId('voice-selector-stub'))
    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('media:createJobSubmit'),
    )!
    fireEvent.click(createBtn)

    await waitFor(() => {
      expect(createJobMutate).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText('media:workflowPreset.voiceLangMismatch')).toBeTruthy()
    })
    // The raw backend exception must never be shown for this code.
    expect(screen.queryByText(/Voice language does not match/)).toBeNull()
  })

  it('falls back to the raw message for unrelated create failures (unchanged)', async () => {
    const { ApiError } = await import('@/types/api')
    uploadMutate.mockResolvedValueOnce({
      assetId: 'asset-1',
      documentId: 'doc-1',
      fileName: 'movie.mp4',
      fileSizeBytes: 1024,
      durationMs: 60000,
      consented: false,
    })
    consentMutate.mockResolvedValueOnce({})
    capabilitiesQuery.data = PROJECTION
    capabilitiesQuery.refetch.mockResolvedValue({ data: PROJECTION })
    providersQuery.data = [
      {
        id: 'p1',
        displayName: 'Cloud TTS',
        protocol: 'openai_compatible',
        capabilities: ['TTS'],
        defaultFor: ['TTS'],
        baseUrl: 'https://example.test',
        apiKeyHint: null,
        defaultModel: 'm',
        enabled: true,
      },
    ]
    voicesMap.set('p1', [
      {
        id: 'v1',
        voiceId: 'voice-1',
        language: 'vi',
        gender: 'FEMALE',
        displayName: 'Vais',
        isActive: true,
        cachedAt: null,
      },
    ])
    createJobMutate.mockRejectedValueOnce(
      new ApiError({ status: 422, code: 'WORKFLOW_PRESET_CONFIG_INVALID', message: 'raw config error' }),
    )

    const { container } = render(<UploadConsentPanel workspaceId="ws" projectId="prj" onCreated={() => {}} />)

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['x'], 'movie.mp4', { type: 'video/mp4' })] },
    })
    await waitFor(() => {
      expect(uploadMutate).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(container.querySelector('.media-consent-box input[type="checkbox"]')!)
    fireEvent.click(screen.getByText('media:consentButton'))
    await waitFor(() => {
      expect(consentMutate).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(screen.getByTestId('voice-selector-stub'))
    const createBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('media:createJobSubmit'),
    )!
    fireEvent.click(createBtn)

    await waitFor(() => {
      expect(screen.getByText('raw config error')).toBeTruthy()
    })
  })
})
