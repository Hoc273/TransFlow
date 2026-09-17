// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'

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

const langState = vi.hoisted(() => {
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
    overrideLangMutate: vi.fn(),
  }
  return state
})

const { jobQuery, providersQuery, overrideLangMutate } = langState

vi.mock('@/hooks/useMedia', () => ({
  useMediaJob: () => jobQuery,
  useMediaLinkedJob: () => ({ data: undefined as unknown, isLoading: false }),
  useRenderConfig: () => ({ data: undefined, isLoading: false }),
  useCancelMediaJob: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useOverrideSourceLang: () => ({ isPending: false, mutateAsync: overrideLangMutate }),
  useSelectVoice: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRerunStage: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useWorkflowContinue: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useWorkflowResume: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => providersQuery,
  useTtsVoices: () => ({ data: undefined, isPending: false }),
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
  RenderPreparationPanel: () => <div data-testid="render-prep-stub" />,
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
vi.mock('@/components/media-studio/SubtitleStylePanel', () => ({
  SubtitleStylePanel: () => <div data-testid="style-panel-stub" />,
}))

const { MediaJobPage } = await import('./MediaJobPage')
import type { MediaJob } from '@/types/media'

function job(partial: Partial<MediaJob>): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'COMPLETED',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    ttsProviderId: null,
    ttsVoiceId: null,
    voiceId: null,
    createdAt: '2026-08-14T00:00:00Z',
    stages: [
      { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's2', stageName: 'STT', stageOrder: 2, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's3', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's4', stageName: 'TTS', stageOrder: 5, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's5', stageName: 'RENDER', stageOrder: 6, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
    ],
    ...partial,
  }
}

/**
 * Source-language override (2026-08-14): changing the language of a job that
 * already ran re-runs TRANSLATE → TTS → RENDER — the UI must ask for explicit
 * confirmation first; a brand-new all-PENDING job applies directly.
 */
describe('MediaJobPage — source language override confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    providersQuery.data = undefined
    overrideLangMutate.mockReset()
    overrideLangMutate.mockResolvedValue(undefined)
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

  it('asks for confirmation when the pipeline already ran, then applies on confirm', async () => {
    jobQuery.data = job({ recipeId: 'localization.full', workflowMode: 'AUTO' })

    const { container } = render(<MediaJobPage />)

    const langSelect = container.querySelector(
      '[data-testid="job-overview-section"] select',
    ) as HTMLSelectElement
    fireEvent.change(langSelect, { target: { value: 'vi' } })
    fireEvent.click(container.querySelector('[data-testid="job-overview-section"] button')!)

    // Confirm row appears; nothing published yet.
    expect(container.querySelector('[data-testid="lang-override-confirm"]')).not.toBeNull()
    expect(overrideLangMutate).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('[data-testid="lang-override-confirm-apply"]')!)

    await waitFor(() =>
      expect(overrideLangMutate).toHaveBeenCalledWith({ sourceLang: 'vi' }),
    )
    expect(container.querySelector('[data-testid="lang-override-confirm"]')).toBeNull()
  })

  it('cancel dismisses the confirmation without publishing', () => {
    jobQuery.data = job({ recipeId: 'localization.full', workflowMode: 'AUTO' })

    const { container } = render(<MediaJobPage />)

    const langSelect = container.querySelector(
      '[data-testid="job-overview-section"] select',
    ) as HTMLSelectElement
    fireEvent.change(langSelect, { target: { value: 'vi' } })
    fireEvent.click(container.querySelector('[data-testid="job-overview-section"] button')!)

    expect(container.querySelector('[data-testid="lang-override-confirm"]')).not.toBeNull()

    const cancelButton = container.querySelector(
      '[data-testid="lang-override-confirm"] button',
    ) as HTMLButtonElement
    fireEvent.click(cancelButton)

    expect(container.querySelector('[data-testid="lang-override-confirm"]')).toBeNull()
    expect(overrideLangMutate).not.toHaveBeenCalled()
  })

  it('applies immediately on a fresh job that has not run anything', async () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      status: 'PENDING',
      stages: [
        { id: 's1', stageName: 'EXTRACT_AUDIO', stageOrder: 1, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
        { id: 's2', stageName: 'STT', stageOrder: 2, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
        { id: 's3', stageName: 'TRANSLATE', stageOrder: 4, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
      ],
    })

    const { container } = render(<MediaJobPage />)

    const langSelect = container.querySelector(
      '[data-testid="job-overview-section"] select',
    ) as HTMLSelectElement
    fireEvent.change(langSelect, { target: { value: 'vi' } })
    fireEvent.click(container.querySelector('[data-testid="job-overview-section"] button')!)

    expect(container.querySelector('[data-testid="lang-override-confirm"]')).toBeNull()
    await waitFor(() =>
      expect(overrideLangMutate).toHaveBeenCalledWith({ sourceLang: 'vi' }),
    )
  })
})
