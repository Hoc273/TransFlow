import { beforeEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ workspaceId: 'ws', jobId: 'job-1' }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

const jobQuery = {
  data: undefined as unknown,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  dataUpdatedAt: 0,
  refetch: vi.fn(),
}
const linkedJobQuery = { data: undefined as unknown, isLoading: false }
const providersQuery = { data: undefined as unknown, isPending: false, isError: false }
const presetsQuery = { data: [] as unknown[], isPending: false, isError: false }
const selectVoiceMutate = vi.fn()
const selectVoiceQuery = { isPending: false, mutateAsync: selectVoiceMutate }
const cancelQuery = { isPending: false, mutateAsync: vi.fn() }
const overrideQuery = { isPending: false, mutateAsync: vi.fn() }
const rerunStageMutate = vi.fn()
const rerunStageQuery = { isPending: false, mutateAsync: rerunStageMutate }
const voicesMap = new Map<string, unknown[]>()

vi.mock('@/hooks/useMedia', () => ({
  useMediaJob: () => jobQuery,
  useMediaAsset: () => ({ data: undefined }),
  useMediaLinkedJob: () => linkedJobQuery,
  useMediaJobQaIssues: () => ({ data: [], isLoading: false }),
  useCancelMediaJob: () => cancelQuery,
  useOverrideSourceLang: () => overrideQuery,
  useSelectVoice: () => selectVoiceQuery,
  useRerunStage: () => rerunStageQuery,
  useWorkflowContinue: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useWorkflowResume: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/components/media-studio/WorkflowCheckpointActions', () => ({
  WorkflowCheckpointActions: () => null,
}))

// Child panels pull extra hooks; stub them so page layout tests stay focused.
vi.mock('@/components/media-studio/ProposalPanel', () => ({
  ProposalPanel: () => <div data-testid="proposal-panel-stub" />,
}))
vi.mock('@/components/media-studio/RenderAndVoiceSection', () => ({
  RenderAndVoiceSection: () => <div data-testid="render-and-voice-stub" />,
}))
vi.mock('@/components/media-studio/RenderPreparationPanel', () => ({
  RenderPreparationPanel: () => <div data-testid="render-prep-stub" />,
}))
vi.mock('@/components/media-studio/MediaReviewSection', () => ({
  MediaReviewSection: () => (
    <>
      <div data-testid="qa-panel-stub" />
      <div data-testid="subtitles-stub" />
    </>
  ),
}))
vi.mock('@/components/media-studio/ExportPanel', () => ({
  ExportPanel: () => <div data-testid="export-panel-stub" />,
}))
vi.mock('@/components/media-studio/SubtitleStylePanel', () => ({
  SubtitleStylePanel: () => <div data-testid="style-panel-stub" />,
}))
vi.mock('@/components/media-studio/VoiceSelector', () => ({
  VoiceSelector: () => <div data-testid="voice-selector-stub" />,
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => providersQuery,
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? voicesMap.get(providerId) : undefined,
    isPending: false,
  }),
}))

vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => presetsQuery,
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}))

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}))

const { renderToStaticMarkup } = await import('react-dom/server')
const pageModule = await import('./MediaJobPage')
const { MediaJobPage } = pageModule
const MediaJobPageExports = pageModule

import type { MediaJob } from '@/types/media'
import type { ProviderConfig, TtsVoice } from '@/types/provider'

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

function job(partial: Partial<MediaJob>): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: null,
    targetLang: 'vi',
    status: 'PENDING',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    voiceId: null,
    createdAt: '2026-08-08T00:00:00Z',
    stages: [
      { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's2', stageName: 'TTS', stageOrder: 5, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
      { id: 's3', stageName: 'RENDER', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
    ],
    ...partial,
  }
}

describe('MediaJobPage — Phase C Job Studio voice binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    providersQuery.data = undefined
    presetsQuery.data = []
    voicesMap.clear()
    selectVoiceMutate.mockReset().mockResolvedValue(undefined)
  })

  it('shows the frozen preset name in the overview when the job references a preset', () => {
    jobQuery.data = job({ workflowPresetId: 'preset-1' })
    presetsQuery.data = [
      {
        id: 'preset-1',
        scope: 'WORKSPACE',
        workspaceId: 'ws',
        projectId: null,
        name: 'Studio standard',
        description: null,
        config: null,
        schemaVersion: 1,
        active: true,
        isDefault: false,
        createdAt: '2026-08-11T00:00:00Z',
        updatedAt: '2026-08-11T00:00:00Z',
      },
    ]

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:workflowPreset.label')
    expect(html).toContain('Studio standard')
  })

  it('shows "Không" in the overview when the job has no preset', () => {
    jobQuery.data = job({ workflowPresetId: null })
    presetsQuery.data = []

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:workflowPreset.label')
    expect(html).toContain('media:workflowPreset.noPreset')
  })

  it('shows "Không" instead of the id when the referenced preset name cannot be resolved', () => {
    // BA review v1 P2: never render raw/reduced UUIDs — the row falls back
    // to the none value instead of being hidden.
    jobQuery.data = job({ workflowPresetId: 'preset-1' })
    presetsQuery.data = []

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:workflowPreset.label')
    expect(html).toContain('media:workflowPreset.noPreset')
    expect(html).not.toContain('preset-1')
  })

  it('displays the job-bound provider and voice (never the workspace default)', () => {
    jobQuery.data = job({
      ttsProviderId: 'piper',
      ttsVoiceId: 'piper-vi-1',
      ttsProviderName: 'Piper (Local)',
      ttsProviderProtocol: 'local_piper',
      ttsVoiceLanguage: 'vi',
      ttsVoiceGender: 'FEMALE',
      ttsVoiceDisplayName: 'Vais',
    })
    // A different provider is the workspace default — must NOT replace the binding.
    providersQuery.data = [
      provider({ id: 'cloud', displayName: 'Cloud TTS', defaultFor: ['TTS'] }),
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)' }),
    ]
    voicesMap.set('piper', [voice({ id: 'piper-vi-1', voiceId: 'piper-vi-vais1000' })])

    const html = renderToStaticMarkup(<MediaJobPage />)

    // No crash; the page renders the pipeline. The binding resolution itself
    // is asserted via resolveJobVoiceProviderId below (accordion bodies are
    // not SSR-rendered while closed).
    expect(html).toContain('studio-tabs')
  })

  it('resolveJobVoiceProviderId prefers the job binding over the workspace default', () => {
    const { resolveJobVoiceProviderId } = MediaJobPageExports
    const providers = [
      provider({ id: 'cloud', displayName: 'Cloud TTS', defaultFor: ['TTS'] }),
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)' }),
    ]
    expect(resolveJobVoiceProviderId({ ttsProviderId: 'piper' }, providers)).toBe('piper')
    // Legacy job → workspace default for display.
    expect(resolveJobVoiceProviderId({ ttsProviderId: null }, providers)).toBe('cloud')
    // Dangling binding → kept, never silently replaced.
    expect(resolveJobVoiceProviderId({ ttsProviderId: 'gone' }, providers)).toBe('gone')
  })

  it('changes provider and voice together through selectVoice', async () => {
    jobQuery.data = job({
      ttsProviderId: 'piper',
      ttsVoiceId: 'piper-vi-1',
    })
    providersQuery.data = [
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)' }),
    ]
    voicesMap.set('piper', [voice({ id: 'piper-vi-1' }), voice({ id: 'piper-vi-2', voiceId: 'other' })])

    const { runJobVoiceChange } = await import('./MediaJobPage')

    await runJobVoiceChange({
      providerId: 'piper',
      voiceId: 'piper-vi-2',
      deps: {
        selectVoice: selectVoiceQuery,
        onError: () => {},
      },
    })

    expect(selectVoiceMutate).toHaveBeenCalledWith({
      providerId: 'piper',
      voiceId: 'piper-vi-2',
    })
  })

  it('jobVoiceChangePayload allows only complete pairs — provider-only is refused', () => {
    const { jobVoiceChangePayload } = MediaJobPageExports
    expect(jobVoiceChangePayload({ providerId: 'p', voiceId: 'v' })).toEqual({
      providerId: 'p',
      voiceId: 'v',
    })
    expect(jobVoiceChangePayload({ providerId: null, voiceId: null })).toEqual({
      providerId: null,
      voiceId: null,
    })
    // P1 fix: a mid-switch provider-only emission is never sent to the API —
    // the provider change can no longer cause a deselect.
    expect(jobVoiceChangePayload({ providerId: 'p', voiceId: null })).toBeNull()
    expect(jobVoiceChangePayload({ providerId: null, voiceId: 'v' })).toBeNull()
  })

  it('runJobVoiceChange skips the API call for a provider-only emission', async () => {
    const { runJobVoiceChange } = MediaJobPageExports

    await runJobVoiceChange({
      providerId: 'p2',
      voiceId: null,
      deps: {
        selectVoice: selectVoiceQuery,
        onError: () => {},
      },
    })

    expect(selectVoiceMutate).not.toHaveBeenCalled()
  })

  it('deselects by sending both null through selectVoice', async () => {
    jobQuery.data = job({ ttsProviderId: 'piper', ttsVoiceId: 'piper-vi-1' })
    providersQuery.data = [
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)' }),
    ]
    voicesMap.set('piper', [voice({ id: 'piper-vi-1' })])

    const { runJobVoiceChange } = await import('./MediaJobPage')

    await runJobVoiceChange({
      providerId: null,
      voiceId: null,
      deps: {
        selectVoice: selectVoiceQuery,
        onError: () => {},
      },
    })

    expect(selectVoiceMutate).toHaveBeenCalledWith({ providerId: null, voiceId: null })
  })

  it('W4-R4: rapid repeated selection while a request is in flight is dropped', async () => {
    const { runJobVoiceChange } = MediaJobPageExports

    // First request is pending — a second emission must not double-fire.
    await runJobVoiceChange({
      providerId: 'piper',
      voiceId: 'piper-vi-2',
      deps: {
        selectVoice: { isPending: true, mutateAsync: selectVoiceMutate },
        onError: () => {},
      },
    })

    expect(selectVoiceMutate).not.toHaveBeenCalled()
  })

  it('W4-R4: isSameVoiceBinding — same pair is a no-op, others trigger', () => {
    const { isSameVoiceBinding } = MediaJobPageExports
    const bound = { ttsProviderId: 'piper', ttsVoiceId: 'piper-vi-1', voiceId: 'vais' }
    expect(isSameVoiceBinding(bound, { providerId: 'piper', voiceId: 'piper-vi-1' })).toBe(true)
    expect(isSameVoiceBinding(bound, { providerId: 'piper', voiceId: 'piper-vi-2' })).toBe(false)
    expect(isSameVoiceBinding(bound, { providerId: null, voiceId: null })).toBe(false)
    // Already unbound → deselect is a no-op.
    const unbound = { ttsProviderId: null, ttsVoiceId: null, voiceId: null }
    expect(isSameVoiceBinding(unbound, { providerId: null, voiceId: null })).toBe(true)
    // Legacy-only binding (voiceId string, no authoritative pair).
    const legacy = { ttsProviderId: null, ttsVoiceId: null, voiceId: 'legacy-voice' }
    expect(isSameVoiceBinding(legacy, { providerId: null, voiceId: null })).toBe(false)
    expect(isSameVoiceBinding(undefined, { providerId: 'piper', voiceId: 'piper-vi-1' })).toBe(false)
  })

  it('W4-R4: re-selecting the current voice does not call selectVoice', async () => {
    jobQuery.data = job({
      ttsProviderId: 'piper',
      ttsVoiceId: 'piper-vi-1',
      voiceId: 'vais',
    })
    providersQuery.data = [
      provider({ id: 'piper', protocol: 'local_piper', displayName: 'Piper (Local)' }),
    ]
    voicesMap.set('piper', [voice({ id: 'piper-vi-1' })])

    const { runJobVoiceChange } = await import('./MediaJobPage')

    await runJobVoiceChange({
      providerId: 'piper',
      voiceId: 'piper-vi-1',
      job: { ttsProviderId: 'piper', ttsVoiceId: 'piper-vi-1', voiceId: 'vais' },
      deps: {
        selectVoice: selectVoiceQuery,
        onError: () => {},
      },
    })

    expect(selectVoiceMutate).not.toHaveBeenCalled()
  })

  it('renders a legacy job (null binding) safely', () => {
    jobQuery.data = job({ ttsProviderId: null, ttsVoiceId: null, voiceId: 'legacy-voice' })
    providersQuery.data = [
      provider({ id: 'cloud', displayName: 'Cloud TTS', defaultFor: ['TTS'] }),
    ]
    voicesMap.set('cloud', [voice({ id: 'c1', voiceId: 'legacy-voice' })])

    const html = renderToStaticMarkup(<MediaJobPage />)

    // No crash; the voice panel falls back to the workspace default for display only.
    expect(html).toContain('studio-tabs')
  })

  it('W3: stage failureReason flows through to the pipeline stepper guidance', () => {
    // Structured reason from the backend stage response reaches the UI via the
    // stepper (t mock returns the key verbatim) — no errorMessage string matching.
    jobQuery.data = job({
      status: 'FAILED',
      stages: [
        { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's2', stageName: 'TTS', stageOrder: 5, status: 'SKIPPED', progressPercent: 0, startedAt: null, completedAt: null },
        {
          id: 's3',
          stageName: 'RENDER',
          stageOrder: 6,
          status: 'FAILED',
          progressPercent: 0,
          failureReason: 'EMPTY_CUES',
          failureDiagnostics: null,
          errorMessage: 'Render aborted: subtitle timeline is empty',
          startedAt: null,
          completedAt: null,
        },
      ],
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('pipeline.recovery.emptyCues')
    expect(html).toContain('Render aborted: subtitle timeline is empty')
    expect(html).toContain('studio-tabs')
  })
})

describe('MediaJobPage — M-A workflow panel visibility (docs/19 §1.8.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
  })

  const localizedStages = [
    { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
    { id: 's2', stageName: 'STT', stageOrder: 2, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
    { id: 's3', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
    { id: 's4', stageName: 'TTS', stageOrder: 5, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
    { id: 's5', stageName: 'RENDER', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
  ]

  it('MANUAL CP-B localization shows QA, Subtitles and aggregated Finish & Render (no badge)', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      subtitleMode: 'HARD_SUB',
      stages: localizedStages,
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:panels.review')
    expect(html).toContain('media:panels.review')
    expect(html).toContain('media:panels.finishRender')
    // The action-required pill was removed from the render panels (2026-08-14) —
    // the panel's own state is enough to recognize the pending confirmation.
    expect(html).not.toContain('media:renderPrep.actionRequired')
    // No standalone CUT accordion for localization
    expect(html).not.toContain('data-section-id="proposals"')
    expect(html).not.toContain('data-section-id="voice"')
    expect(html).not.toContain('data-section-id="render-preparation"')
  })

  it('W4-R4: post-confirm voice rerun (REVIEW CONFIRMED) shows no action badge', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      subtitleMode: 'HARD_SUB',
      stages: localizedStages,
      workflowCheckpoints: [{ id: 'REVIEW', state: 'CONFIRMED', canContinue: false }],
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:panels.finishRender')
    expect(html).not.toContain('media:renderPrep.actionRequired')
  })

  it('MANUAL non-CP-B job (SOFT_SUB) keeps QA + Subtitles + Finish & Render, no action badge', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      subtitleMode: 'SOFT_SUB',
      stages: localizedStages,
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:panels.review')
    expect(html).toContain('media:panels.review')
    expect(html).toContain('media:panels.finishRender')
    expect(html).not.toContain('media:renderPrep.actionRequired')
  })

  it('AUTO localization shows Finish & Render with QA and Subtitles intact', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      subtitleMode: 'SOFT_SUB',
      stages: localizedStages,
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:panels.finishRender')
    expect(html).toContain('media:panels.review')
    expect(html).toContain('media:panels.review')
    expect(html).not.toContain('media:renderPrep.actionRequired')
  })

  it('workflowMode NULL derives the recipe default — localization.full stays AUTO, finish panel still visible', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: null,
      subtitleMode: 'SOFT_SUB',
      stages: localizedStages,
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media:panels.finishRender')
    expect(html).toContain('media:panels.review')
    expect(html).not.toContain('media:renderPrep.actionRequired')
  })
})

describe('MediaJobPage — localization UX grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    providersQuery.data = undefined
  })

  it('localization has clean overview with data-recipe-id without cut block or proposals section', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      processingMode: 'TRANSLATE_ONLY',
      stages: [
        { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's2', stageName: 'STT', stageOrder: 2, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's3', stageName: 'TRANSLATE', stageOrder: 4, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
      ],
      workflowCheckpoints: [
        { id: 'CUT', state: 'SKIPPED', canContinue: false },
        { id: 'REVIEW', state: 'PENDING', canContinue: false },
        { id: 'EXPORT', state: 'PENDING', canContinue: false },
      ],
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('data-testid="job-overview-section"')
    expect(html).toContain('data-recipe-id="localization.full"')
    expect(html).not.toContain('data-testid="overview-cut-block"')
    expect(html).not.toContain('data-testid="overview-continue-cut"')
    expect(html).not.toContain('data-section-id="proposals"')
    expect(html).toContain('data-section-id="finish-render"')
    expect(html).toContain('data-section-id="export"')
  })

  it('summary recipe keeps standalone proposals panel and unified finish-render section', () => {
    jobQuery.data = job({
      recipeId: 'summary.extractive',
      processingMode: 'HYBRID',
      workflowMode: 'MANUAL',
      stages: [
        { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's2', stageName: 'STT', stageOrder: 2, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's3', stageName: 'SUMMARIZE', stageOrder: 3, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      ],
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('data-section-id="proposals"')
    expect(html).not.toContain('data-testid="overview-cut-block"')
    expect(html).toContain('data-section-id="finish-render"')
    expect(html).not.toContain('data-section-id="render-preparation"')
    expect(html).not.toContain('data-section-id="voice"')
  })
})

describe('MediaJobPage — header badge de-duplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    linkedJobQuery.data = undefined
    providersQuery.data = undefined
  })

  it('hides the gray domain-phase badge when it duplicates the terminal status', () => {
    jobQuery.data = job({
      status: 'COMPLETED',
      domainPhase: 'COMPLETED',
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).not.toContain('media-domain-phase-badge')
    expect(html).toContain('media-mode-badge')
  })

  it('keeps the domain-phase badge while the job is running', () => {
    jobQuery.data = job({
      status: 'PROCESSING',
      domainPhase: 'UNDERSTANDING',
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
    })

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('media-domain-phase-badge')
  })

  it('shows the QA count pill on the review accordion trigger when issues exist', () => {
    jobQuery.data = job({
      translationJobId: 'tj-1',
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      stages: [
        { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's2', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's3', stageName: 'TTS', stageOrder: 5, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
      ],
    })
    linkedJobQuery.data = {
      id: 'tj-1',
      documentId: 'doc-1',
      projectId: 'p-1',
      sourceLang: 'en',
      targetLang: 'vi',
      status: 'TRANSLATED',
      createdAt: '2026-08-12T00:00:00Z',
      segments: [
        {
          id: 'seg-1',
          seq: 1,
          sourceText: 'Hello',
          targetText: 'Xin chào',
          status: 'TRANSLATED',
          tmScore: null,
          qaIssues: [
            {
              id: 'qa-1',
              type: 'terminology',
              severity: 'HIGH',
              message: 'mismatch',
              sourceSpan: null,
              targetSpan: null,
              suggestion: null,
              resolved: false,
            },
          ],
          startMs: 0,
          endMs: 4000,
        },
      ],
    }

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).toContain('data-testid="review-qa-badge"')
    expect(html).toContain('qa-seg-critical')
  })

  it('renders without a QA pill when the linked job has no data yet', () => {
    jobQuery.data = job({
      translationJobId: 'tj-1',
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      stages: [
        { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's2', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      ],
    })
    linkedJobQuery.data = undefined

    const html = renderToStaticMarkup(<MediaJobPage />)

    expect(html).not.toContain('data-testid="review-qa-badge"')
  })

  describe('resolveJobVoiceDisplay (Overview voice name display)', () => {
    const { resolveJobVoiceDisplay } = MediaJobPageExports

    it('prefers authoritative ttsVoiceDisplayName from backend job response', () => {
      const res = resolveJobVoiceDisplay(
        { ttsVoiceDisplayName: 'VAIS1000 (Piper)', ttsVoiceId: 'v1', voiceId: 'piper-vi-vais1000' },
        [voice({ id: 'v1', displayName: 'Other Voice' })],
      )
      expect(res).toEqual({ text: 'VAIS1000 (Piper)', isMono: false })
    })

    it('falls back to looking up displayName by ttsVoiceId in voices catalog', () => {
      const res = resolveJobVoiceDisplay(
        { ttsVoiceDisplayName: null, ttsVoiceId: 'v-found', voiceId: 'piper-vi-vais1000' },
        [voice({ id: 'v-found', displayName: 'Hoài My' })],
      )
      expect(res).toEqual({ text: 'Hoài My', isMono: false })
    })

    it('falls back to looking up displayName by matching voice row UUID in voiceId', () => {
      const res = resolveJobVoiceDisplay(
        { ttsVoiceDisplayName: null, ttsVoiceId: null, voiceId: 'v-uuid' },
        [voice({ id: 'v-uuid', displayName: 'Nam Minh' })],
      )
      expect(res).toEqual({ text: 'Nam Minh', isMono: false })
    })

    it('falls back to raw voiceId with monospace font when unresolved in catalog', () => {
      const res = resolveJobVoiceDisplay(
        { ttsVoiceDisplayName: null, ttsVoiceId: null, voiceId: 'legacy-raw-id' },
        [voice({ id: 'other-id', displayName: 'Other' })],
      )
      expect(res).toEqual({ text: 'legacy-raw-id', isMono: true })
    })

    it('returns fallbackOriginal with normal font when job has no voice bound', () => {
      const res = resolveJobVoiceDisplay(
        { ttsVoiceDisplayName: null, ttsVoiceId: null, voiceId: null },
        [],
        'Giọng gốc',
      )
      expect(res).toEqual({ text: 'Giọng gốc', isMono: false })
    })

    it('renders the friendly voice name in the Job Studio overview HTML', () => {
      jobQuery.data = job({
        ttsVoiceDisplayName: 'VAIS1000 (Piper)',
        ttsVoiceId: 'v1',
        voiceId: 'piper-vi-vais1000',
      })
      const html = renderToStaticMarkup(<MediaJobPage />)
      expect(html).toContain('VAIS1000 (Piper)')
      expect(html).not.toContain('font-mono text-xs break-all">piper-vi-vais1000')
    })
  })
})
