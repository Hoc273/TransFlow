// @vitest-environment jsdom
import type { ProviderConfig } from '@/types/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ workspaceId: 'ws', jobId: 'job-1' }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

const voiceChangeState = vi.hoisted(() => {
  const state = {
    jobQuery: {
      data: undefined as unknown,
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      dataUpdatedAt: 0,
      refetch: vi.fn(),
    },
    providersQuery: { data: undefined as unknown, isPending: false, isError: false },
    selectVoicePending: false,
    selectVoiceMutate: vi.fn(),
  }
  return state
})

const { jobQuery, providersQuery, selectVoicePending, selectVoiceMutate } = voiceChangeState

vi.mock('@/hooks/useMedia', () => ({
  useMediaJob: () => jobQuery,
  useMediaAsset: () => ({ data: undefined }),
  useMediaLinkedJob: () => ({ data: undefined as unknown, isLoading: false }),
  useMediaJobQaIssues: () => ({ data: [], isLoading: false }),
  useRenderConfig: () => ({ data: undefined, isLoading: false }),
  useCancelMediaJob: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useOverrideSourceLang: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSelectVoice: () => ({ isPending: selectVoicePending, mutateAsync: selectVoiceMutate }),
  useRerunStage: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useWorkflowContinue: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useWorkflowResume: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

const { voicesByProvider } = vi.hoisted(() => ({
  voicesByProvider: new Map<string, unknown[]>(),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => providersQuery,
  useTtsProviderOptions: () => ({
    data: ((providersQuery.data ?? []) as ProviderConfig[]).filter((p) => p.capabilities.includes('TTS')),
    isPending: providersQuery.isPending,
  }),
  useTtsVoices: (_ws: string, providerId: string | undefined) => ({
    data: providerId ? voicesByProvider.get(providerId) : undefined,
    isPending: false,
  }),
  useVoicePreview: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => ({ data: [], isPending: false, isError: false }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}))

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}))

// Keep the voice surface real (RenderAndVoiceSection + VoiceSelector); stub
// everything else so the test focuses on the voice-change interaction.
vi.mock('@/components/media-studio/ProposalPanel', () => ({
  ProposalPanel: () => <div data-testid="proposal-panel-stub" />,
}))
vi.mock('@/components/media-studio/MediaReviewSection', () => ({
  MediaReviewSection: () => (
    <>
      <div data-testid="qa-panel-stub" />
      <div data-testid="subtitles-stub" />
    </>
  ),
}))
vi.mock('@/components/media-studio/RenderPreparationPanel', () => ({
  // §1.8.2 redesign: the section passes the real VoiceSelector through the
  // panel's group ① slot — the stub must render the slot for the voice
  // interaction under test to exist.
  RenderPreparationPanel: ({ voiceSlot }: { voiceSlot?: React.ReactNode }) => (
    <div data-testid="render-prep-stub">{voiceSlot}</div>
  ),
  AudioPresentationConfig: () => <div data-testid="audio-config-stub" />,
  DEFAULT_AUDIO_PRESENTATION: {
    originalGainDb: 0,
    ttsGainDb: 0,
    duckingEnabled: true,
    duckingGainDb: -12,
    ttsTempo: 1,
  },
}))
vi.mock('@/components/media-studio/ExportPanel', () => ({
  ExportPanel: () => <div data-testid="export-panel-stub" />,
}))
const { MediaJobPage } = await import('./MediaJobPage')
import type { MediaJob } from '@/types/media'

function job(partial: Partial<MediaJob>): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: null,
    targetLang: 'vi',
    status: 'PROCESSING',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    ttsProviderId: 'piper',
    ttsVoiceId: 'piper-vi-1',
    voiceId: 'piper-vi-vais1000',
    createdAt: '2026-08-12T00:00:00Z',
    stages: [
      { id: 's1', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's2', stageName: 'TTS', stageOrder: 5, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
      { id: 's3', stageName: 'AUDIO_MIX', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
      { id: 's4', stageName: 'RENDER', stageOrder: 7, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
    ],
    ...partial,
  }
}

const voice = (id: string, displayName: string) => ({
  id,
  providerId: 'piper',
  voiceId: id,
  language: 'vi',
  gender: 'FEMALE',
  displayName,
  isActive: true,
  cachedAt: null,
})

function openState(container: HTMLElement, sectionId: string): string | null | undefined {
  const el = container.querySelector(`[data-section-id="${sectionId}"]`)
  return el?.getAttribute('data-open')
}

/**
 * W4-R4 — post-confirm voice change is a downstream rerun: rapid repeated
 * selection must not double-publish (synchronous operation lock), the REVIEW
 * checkpoint stays CONFIRMED (no re-open, no Confirm/resume actions).
 */
describe('MediaJobPage — W4-R4 voice change downstream rerun (docs/15 §5.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    providersQuery.data = undefined
    voicesByProvider.clear()
    voiceChangeState.selectVoicePending = false
    selectVoiceMutate.mockReset()
    selectVoiceMutate.mockReturnValue(new Promise(() => undefined))
    // jsdom has no scrollIntoView — stub it like the sibling interaction tests.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  it('rapid repeated selection while the mutation is in flight publishes once, then unlocks', async () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      workflowCheckpoints: [{ id: 'REVIEW', state: 'CONFIRMED', canContinue: false }],
    })
    providersQuery.data = [
      { id: 'piper', displayName: 'Piper (Local)', enabled: true, capabilities: ['TTS'], protocol: 'local_piper', baseUrl: 'system://piper', apiKeyHint: null, defaultModel: 'm', defaultFor: [] },
    ]
    voicesByProvider.set('piper', [voice('piper-vi-1', 'Vais'), voice('piper-vi-2', 'Amy'), voice('piper-vi-3', 'Joe')])

    let resolveFirst!: (v: unknown) => void
    selectVoiceMutate.mockImplementation(
      () => new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )

    const { container } = render(<MediaJobPage />)

    // Open the aggregated Finish & Render section (real VoiceSelector inside).
    fireEvent.click(
      container.querySelector('[data-tab-id="finish-render"]')!,
    )
    expect(openState(container, 'finish-render')).toBe('true')

    const voiceSelect = container.querySelector(
      '[data-testid="voice-voice-select"]',
    ) as HTMLSelectElement
    expect(voiceSelect).not.toBeNull()

    // Two rapid selections before the first mutation settles — the synchronous
    // operation lock must drop the second (no duplicate publish).
    fireEvent.change(voiceSelect, { target: { value: 'piper-vi-2' } })
    fireEvent.change(voiceSelect, { target: { value: 'piper-vi-3' } })

    expect(selectVoiceMutate).toHaveBeenCalledTimes(1)
    expect(selectVoiceMutate).toHaveBeenCalledWith({ providerId: 'piper', voiceId: 'piper-vi-2' })

    // The lock is released when the mutation settles — a later selection works.
    await act(async () => {
      resolveFirst(undefined)
      await Promise.resolve()
    })
    fireEvent.change(voiceSelect, { target: { value: 'piper-vi-3' } })
    await waitFor(() =>
      expect(selectVoiceMutate).toHaveBeenCalledWith({ providerId: 'piper', voiceId: 'piper-vi-3' }),
    )
    expect(selectVoiceMutate).toHaveBeenCalledTimes(2)
  })

  it('voice change keeps REVIEW CONFIRMED and never re-opens Review or offers Confirm actions', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      workflowCheckpoints: [{ id: 'REVIEW', state: 'CONFIRMED', canContinue: false }],
    })
    providersQuery.data = [
      { id: 'piper', displayName: 'Piper (Local)', enabled: true, capabilities: ['TTS'], protocol: 'local_piper', baseUrl: 'system://piper', apiKeyHint: null, defaultModel: 'm', defaultFor: [] },
    ]
    voicesByProvider.set('piper', [voice('piper-vi-1', 'Vais'), voice('piper-vi-2', 'Amy')])
    selectVoiceMutate.mockResolvedValue(undefined)

    const { container } = render(<MediaJobPage />)

    fireEvent.click(
      container.querySelector('[data-tab-id="finish-render"]')!,
    )
    const reviewOpenBefore = openState(container, 'review')

    const voiceSelect = container.querySelector(
      '[data-testid="voice-voice-select"]',
    ) as HTMLSelectElement
    fireEvent.change(voiceSelect, { target: { value: 'piper-vi-2' } })

    // Review section state is untouched by the voice change — no re-open.
    expect(openState(container, 'review')).toBe(reviewOpenBefore)
    // Post-confirm rerun: no "Action required" badge, no CUT continue, no resume.
    expect(container.textContent).not.toContain('media:renderPrep.actionRequired')
    expect(container.textContent).not.toContain('media:workflow.continueCut')
    expect(container.textContent).not.toContain('media:workflow.resume')
    // REVIEW stays CONFIRMED → no checkpoint action banner is raised.
    expect(container.querySelector('[data-testid="workflow-checkpoint-actions"]')).toBeNull()
  })
})
