import { beforeEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

const uploadMock = { mutateAsync: vi.fn(), isPending: false }
const consentMock = { mutateAsync: vi.fn(), isPending: false }
const termsQuery = { data: { termsVersion: '2026-01-01' }, isPending: false, isError: false }
const providersQuery = { data: undefined as unknown, isPending: false, isError: false }
const capabilitiesQuery = {
  data: undefined as unknown,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
  refetchAsync: vi.fn(),
}
const createJobMutate = vi.fn()
const createJobQuery = { isPending: false, mutateAsync: createJobMutate }
const selectVoiceMock = vi.fn()
const invalidateQueries = vi.fn()
const setQueryData = vi.fn()
const permissionMock = vi.fn(() => true)

vi.mock('@/hooks/useMedia', () => ({
  useConsentMedia: () => consentMock,
  useMediaTermsVersion: () => termsQuery,
  useTransformationCapabilities: () => capabilitiesQuery,
  useUploadMedia: () => uploadMock,
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => permissionMock(),
}))

const voicesMap = new Map<string, TtsVoice[]>()
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
  selectTransformationVoiceApi: (...args: unknown[]) => selectVoiceMock(...args),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: { mutationFn: (...a: unknown[]) => unknown }) => ({
    ...createJobQuery,
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

const { renderToStaticMarkup } = await import('react-dom/server')
const { UploadConsentPanel } = await import('./UploadConsentPanel')
const { defaultTtsProvider, isTtsProvider } = await import('@/lib/media/voiceSelection')

import type { ProviderConfig, TtsVoice } from '@/types/provider'
import type { AvailabilityProjection } from '@/types/transformation'

const PROJECTION: AvailabilityProjection = {
  protocolVersion: '1',
  supportedExecutionModes: ['FAST'],
  defaultExecutionMode: 'FAST',
  availability: { FAST: { available: true, unavailableReason: null } },
  workerCapability: { state: 'AVAILABLE', workerCount: 1, compatibleFastWorkers: 1, compatibleStudioWorkers: 0 },
  readiness: { status: 'READY', readyExecutionModes: ['FAST'], reasons: [], evaluatedAt: null },
}

function provider(partial: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'p1',
    displayName: 'Cloud TTS',
    protocol: 'azure_speech',
    capabilities: ['TTS'],
    defaultFor: [],
    baseUrl: 'https://example.test',
    apiKeyHint: null,
    defaultModel: 'm',
    enabled: true,
    ...partial,
  }
}

function voice(partial: Partial<TtsVoice>): TtsVoice {
  return {
    id: 'v1',
    voiceId: 'voice-1',
    language: 'vi',
    gender: 'FEMALE',
    displayName: 'Vais',
    isActive: true,
    cachedAt: null,
    ...partial,
  }
}

describe('UploadConsentPanel — Phase C voice binding at create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uploadMock.mutateAsync.mockReset()
    consentMock.mutateAsync.mockReset()
    createJobMutate.mockReset()
    selectVoiceMock.mockReset()
    invalidateQueries.mockClear()
    setQueryData.mockClear()
    capabilitiesQuery.refetch.mockReset().mockResolvedValue({ data: PROJECTION })
    capabilitiesQuery.data = PROJECTION
    uploadMock.mutateAsync.mockResolvedValue({
      assetId: 'asset-1',
      documentId: 'doc-1',
      fileName: 'clip.mp4',
      fileSizeBytes: 100,
      durationMs: 60000,
      consented: false,
    })
    consentMock.mutateAsync.mockResolvedValue({ id: 'c1' })
    createJobMutate.mockResolvedValue({ id: 'job-1' })
  })

  it('renders the provider selector through the provider API (Piper visible as a normal provider)', () => {
    providersQuery.data = [
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)', defaultFor: ['TTS'] }),
    ]
    voicesMap.set('piper', [voice({ id: 'v1' })])
    const html = renderToStaticMarkup(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    expect(html).toContain('media:voice.providerLabel')
    expect(html).toContain('media:voice.localPiper')
  })

  it('does not call selectVoice after create when provider+voice were chosen at create', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    await createMediaJobWithSelection({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      voiceSelection: { providerId: 'piper', voiceId: 'v1' },
      deps: {
        createJob: { mutateAsync: mutate },
        onCreated: () => {},
        navigate: () => {},
      },
    })

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        ttsProviderId: 'piper',
        ttsVoiceId: 'v1',
      }),
    )
    // Requirement 10: no post-create selectVoice call.
    expect(selectVoiceMock).not.toHaveBeenCalled()
  })

  it('sends null binding when the user keeps the original audio', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    await createMediaJobWithSelection({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      voiceSelection: { providerId: null, voiceId: null },
      keepOriginalAudio: true,
      deps: {
        createJob: { mutateAsync: mutate },
        onCreated: () => {},
        navigate: () => {},
      },
    })

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        ttsProviderId: null,
        ttsVoiceId: null,
        keepOriginalAudio: true,
      }),
    )
    expect(selectVoiceMock).not.toHaveBeenCalled()
  })

  it('never sends a provider without a voice (partial pair)', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    await expect(
      createMediaJobWithSelection({
        documentId: 'doc-1',
        recipeId: 'localization.full',
        targetLang: 'vi',
        requestedDurationSeconds: null,
        requestedMode: 'FAST',
        voiceSelection: { providerId: 'p1', voiceId: null },
        deps: {
          createJob: { mutateAsync: mutate },
          onCreated: () => {},
          navigate: () => {},
        },
      }),
    ).rejects.toThrow(/partial TTS binding/)

    expect(mutate).not.toHaveBeenCalled()
  })

  it('C2: preset-provided voice pair suppresses the explicit pair (preset pair wins)', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    await createMediaJobWithSelection({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      voiceSelection: { providerId: 'piper', voiceId: 'v1' },
      presetProvidesVoice: true,
      deps: {
        createJob: { mutateAsync: mutate },
        onCreated: () => {},
        navigate: () => {},
      },
    })

    // JOB explicit fields would win over the preset pair at bindTtsProviderAndVoice
    // — the FE must send null/null so the backend applies the preset pair.
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ttsProviderId: null, ttsVoiceId: null }),
    )
    expect(selectVoiceMock).not.toHaveBeenCalled()
  })

  // ─── C2 bugfix (live repro 2026-08-15): generative create crashed with a
  //     partial auto-default pair (provider synced, voice never picked —
  //     generative hides the VoiceSelector) ────────────────────────────────

  it('generative create tolerates the partial auto-default pair and sends null/null', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    // The workspace-default sync effect fills providerId but never voiceId —
    // a partial pair that used to throw "partial TTS binding" before the fix.
    await createMediaJobWithSelection({
      documentId: 'doc-1',
      recipeId: 'summary.generative',
      targetLang: 'vi',
      requestedDurationSeconds: 60,
      requestedMode: 'FAST',
      voiceSelection: { providerId: 'piper', voiceId: null },
      deps: {
        createJob: { mutateAsync: mutate },
        onCreated: () => {},
        navigate: () => {},
      },
    })

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ttsProviderId: null, ttsVoiceId: null }),
    )
  })

  it('generative create with a preset-provided voice pair still sends null/null', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    await createMediaJobWithSelection({
      documentId: 'doc-1',
      recipeId: 'summary.generative',
      targetLang: 'vi',
      requestedDurationSeconds: 60,
      requestedMode: 'FAST',
      voiceSelection: { providerId: 'piper', voiceId: null },
      presetProvidesVoice: true,
      deps: {
        createJob: { mutateAsync: mutate },
        onCreated: () => {},
        navigate: () => {},
      },
    })

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ttsProviderId: null, ttsVoiceId: null }),
    )
  })

  it('non-generative partial pair still fails closed (regression)', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    await expect(
      createMediaJobWithSelection({
        documentId: 'doc-1',
        recipeId: 'localization.full',
        targetLang: 'vi',
        requestedDurationSeconds: null,
        requestedMode: 'FAST',
        voiceSelection: { providerId: 'piper', voiceId: null },
        deps: {
          createJob: { mutateAsync: mutate },
          onCreated: () => {},
          navigate: () => {},
        },
      }),
    ).rejects.toThrow(/partial TTS binding/)
    expect(mutate).not.toHaveBeenCalled()
  })

  // ─── Bugfix live v2 (2026-08-15, user repro: Full localization + preset
  //     "duckziec test" — VoiceSelector hidden, auto-default provider fills
  //     providerId only → partial guard used to throw) ────────────────────

  it('localization + preset-provided voice tolerates the partial auto-default pair (preset binds)', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    // Preset hides the VoiceSelector → voiceId stays null while the auto-default
    // effect filled providerId. The preset pair must bind — never a throw.
    await createMediaJobWithSelection({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      voiceSelection: { providerId: 'piper', voiceId: null },
      presetProvidesVoice: true,
      deps: {
        createJob: { mutateAsync: mutate },
        onCreated: () => {},
        navigate: () => {},
      },
    })

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ttsProviderId: null, ttsVoiceId: null }),
    )
  })

  it('localization + preset + complete explicit pair still sends null/null (preset wins)', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')
    const mutate = vi.fn().mockResolvedValue({ id: 'job-1' })

    await createMediaJobWithSelection({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      voiceSelection: { providerId: 'piper', voiceId: 'v1' },
      presetProvidesVoice: true,
      deps: {
        createJob: { mutateAsync: mutate },
        onCreated: () => {},
        navigate: () => {},
      },
    })

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ttsProviderId: null, ttsVoiceId: null }),
    )
  })

  it('pins the workspace default provider after an async provider load', async () => {
    // First render: providers still loading (data undefined) — the create
    // button must not be enabled with a stale selection.
    providersQuery.isPending = true
    providersQuery.data = undefined
    let html = renderToStaticMarkup(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    expect(html).not.toContain('value="piper"')

    // Providers resolve with a default — the VoiceSelector receives the
    // default provider id and renders it as the selected option.
    providersQuery.isPending = false
    providersQuery.data = [
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)', defaultFor: ['TTS'] }),
    ]
    voicesMap.set('piper', [voice({ id: 'v1' })])
    html = renderToStaticMarkup(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    expect(html).toContain('value="piper"')
    expect(html).toContain('media:voice.localPiper')
  })

  it('defaults the panel to the workspace default provider (no selection yet)', () => {
    // With providers already resolved, the initial state carries the default.
    providersQuery.isPending = false
    providersQuery.data = [
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)', defaultFor: ['TTS'] }),
    ]
    voicesMap.set('piper', [voice({ id: 'v1' })])
    const html = renderToStaticMarkup(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    expect(html).toContain('value="piper"')
  })

  it('helper defaults the provider to the workspace TTS default', () => {
    const providers = [
      provider({ id: 'pA', defaultFor: [] }),
      provider({ id: 'pB', defaultFor: ['TTS'] }),
    ]
    expect(defaultTtsProvider(providers)?.id).toBe('pB')
    expect(isTtsProvider(providers[0])).toBe(true)
  })

  it('createVoiceGate blocks create whenever the pair is incomplete', async () => {
    const { createVoiceGate } = await import('./UploadConsentPanel')

    // Provider change in flight / no compatible voice / reset → gate closed.
    expect(createVoiceGate('localization.full', { providerId: null, voiceId: null })).toBe(
      'missing-voice-pair',
    )
    expect(createVoiceGate('localization.full', { providerId: 'p1', voiceId: null })).toBe(
      'missing-voice-pair',
    )
    expect(createVoiceGate('localization.full', { providerId: null, voiceId: 'v1' })).toBe(
      'missing-voice-pair',
    )
    // Complete pair → gate open.
    expect(createVoiceGate('localization.full', { providerId: 'p1', voiceId: 'v1' })).toBe('ok')
    // Generative defers voice selection to render prep — always open.
    expect(createVoiceGate('summary.generative', { providerId: null, voiceId: null })).toBe('ok')
    // C2: a preset-provided voice pair satisfies the gate with no FE pair.
    expect(
      createVoiceGate('localization.full', { providerId: null, voiceId: null }, true),
    ).toBe('ok')
  })

  it('exposes voice fixtures used by the panel tests', () => {
    expect(voice({ id: 'x' }).language).toBe('vi')
  })
})

describe('UploadConsentPanel — M-C workflow preset id in the create payload (docs/16 §7.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createJobMutate.mockReset().mockResolvedValue({ id: 'job-1' })
  })

  const selection = (
    partial: { workflowPresetId?: string; recipeId?: string; enableVlm?: boolean } = {},
  ) => ({
    documentId: 'doc-1',
    recipeId: 'localization.full',
    targetLang: 'vi',
    requestedDurationSeconds: null,
    requestedMode: 'FAST' as const,
    voiceSelection: { providerId: 'piper', voiceId: 'v1' },
    ...partial,
    deps: {
      createJob: { mutateAsync: createJobMutate },
      onCreated: () => {},
      navigate: () => {},
    },
  })

  it('sends workflowPresetId when a preset was picked', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')

    await createMediaJobWithSelection(selection({ workflowPresetId: 'preset-1' }))

    expect(createJobMutate).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPresetId: 'preset-1', skipPresetResolution: false }),
    )
  })

  it('sends workflowPresetId null when no preset is selected (recipe default)', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')

    await createMediaJobWithSelection(selection())

    // No pin opts OUT of backend default resolution — the workspace/system
    // default preset must not auto-apply.
    expect(createJobMutate).toHaveBeenCalledWith(
      expect.objectContaining({ workflowPresetId: null, skipPresetResolution: true }),
    )
  })

  it('createJobApiBody maps workflow fields into the HTTP body (BLOCKER M-C-01 fix)', async () => {
    const { createJobApiBody } = await import('./UploadConsentPanel')

    const body = createJobApiBody({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      workflowMode: 'MANUAL',
      workflowPresetId: 'preset-1',
      skipPresetResolution: false,
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      ttsProviderId: 'piper',
      ttsVoiceId: 'v1',
    })

    expect(body.workflowMode).toBe('MANUAL')
    expect(body.workflowPresetId).toBe('preset-1')
    expect(body.skipPresetResolution).toBe(false)
    // C2 (docs/19 §1.8.2): subtitleMode is never sent from the create form —
    // the backend resolves it (preset → SOFT_SUB default).
    expect(body.subtitleMode).toBeUndefined()
  })

  it('createJobApiBody never fabricates workflow fields when absent', async () => {
    const { createJobApiBody } = await import('./UploadConsentPanel')

    const body = createJobApiBody({
      documentId: 'doc-1',
      recipeId: 'summary.extractive',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      ttsProviderId: null,
      ttsVoiceId: null,
    })

    expect(body.workflowMode).toBeUndefined()
    expect(body.workflowPresetId).toBeUndefined()
  })

  it('createJobApiBody maps enableVlm flag into the HTTP body', async () => {
    const { createJobApiBody } = await import('./UploadConsentPanel')

    const bodyOn = createJobApiBody({
      documentId: 'doc-1',
      recipeId: 'summary.generative',
      targetLang: 'vi',
      requestedDurationSeconds: 120,
      requestedMode: 'FAST',
      enableVlm: true,
    })
    expect(bodyOn.enableVlm).toBe(true)

    const bodyOff = createJobApiBody({
      documentId: 'doc-1',
      recipeId: 'summary.generative',
      targetLang: 'vi',
      requestedDurationSeconds: 120,
      requestedMode: 'FAST',
      enableVlm: false,
    })
    expect(bodyOff.enableVlm).toBe(false)
  })

  it('createJobApiBody maps keepOriginalAudio flag into the HTTP body', async () => {
    const { createJobApiBody } = await import('./UploadConsentPanel')

    const bodyOriginal = createJobApiBody({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      keepOriginalAudio: true,
    })
    expect(bodyOriginal.keepOriginalAudio).toBe(true)

    const bodyDubbed = createJobApiBody({
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      requestedDurationSeconds: null,
      requestedMode: 'FAST',
      keepOriginalAudio: false,
    })
    expect(bodyDubbed.keepOriginalAudio).toBe(false)
  })

  it('sends enableVlm when specified in selection', async () => {
    const { createMediaJobWithSelection } = await import('./UploadConsentPanel')

    await createMediaJobWithSelection(
      selection({ recipeId: 'summary.generative', enableVlm: false }),
    )

    expect(createJobMutate).toHaveBeenCalledWith(
      expect.objectContaining({ recipeId: 'summary.generative', enableVlm: false }),
    )
  })
})
