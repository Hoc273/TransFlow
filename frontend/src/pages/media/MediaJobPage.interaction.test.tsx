// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

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

const { jobQuery, providersQuery, continueMutate } = vi.hoisted(() => ({
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
  continueMutate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaJob: () => jobQuery,
  useMediaLinkedJob: () => ({ data: undefined as unknown, isLoading: false }),
  useMediaJobQaIssues: () => ({ data: [], isLoading: false }),
  useCancelMediaJob: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useOverrideSourceLang: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSelectVoice: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRerunStage: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useWorkflowContinue: () => ({ isPending: false, mutateAsync: continueMutate }),
  useWorkflowResume: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/components/media-studio/WorkflowCheckpointStrip', () => ({
  WorkflowCheckpointStrip: () => null,
}))

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
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-08-12T00:00:00Z',
    stages: [],
    ...partial,
  }
}

const stage = (
  id: string,
  stageName: string,
  stageOrder: number,
  status: string,
) => ({
  id,
  stageName,
  stageOrder,
  status,
  progressPercent: status === 'PROCESSING' ? 40 : status === 'COMPLETED' ? 100 : 0,
  startedAt: null,
  completedAt: null,
})

function openState(container: HTMLElement, sectionId: string): string | null | undefined {
  const el = container.querySelector(`[data-section-id="${sectionId}"]`)
  return el?.getAttribute('data-open')
}

describe('MediaJobPage â€” R2 auto-scroll to Overview on STT COMPLETED', () => {
  const scrollSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    providersQuery.data = undefined
    scrollSpy.mockReset()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  it('scrolls to Overview exactly once when STT flips PENDING â†’ COMPLETED', () => {
    const { container, rerender } = render(<MediaJobPage />)

    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'PENDING'),
        stage('s3', 'TRANSLATE', 4, 'PENDING'),
        stage('s4', 'TTS', 5, 'PENDING'),
        stage('s5', 'RENDER', 6, 'PENDING'),
      ],
    })
    rerender(<MediaJobPage />)
    expect(openState(container, 'overview')).toBe('true')
    expect(scrollSpy).toHaveBeenCalledTimes(0)

    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'COMPLETED'),
        stage('s3', 'TRANSLATE', 4, 'PENDING'),
        stage('s4', 'TTS', 5, 'PENDING'),
        stage('s5', 'RENDER', 6, 'PENDING'),
      ],
    })
    rerender(<MediaJobPage />)
    expect(openState(container, 'overview')).toBe('true')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect((scrollSpy.mock.instances[0] as HTMLElement | undefined)?.id).toBe('studio-section-overview')

    // Same COMPLETED status on the next poll â€” no second scroll.
    rerender(<MediaJobPage />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('Overview contains data-recipe-id and omits CUT block for localization', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      workflowCheckpoints: [{ id: 'CUT', state: 'SKIPPED', canContinue: false }],
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'COMPLETED'),
        stage('s3', 'TRANSLATE', 4, 'PENDING'),
        stage('s4', 'TTS', 5, 'PENDING'),
        stage('s5', 'RENDER', 6, 'PENDING'),
      ],
    })
    const { container } = render(<MediaJobPage />)

    const overview = container.querySelector('[data-testid="job-overview-section"]')
    expect(overview).not.toBeNull()
    expect(overview?.getAttribute('data-recipe-id')).toBe('localization.full')
    expect(container.querySelector('[data-testid="overview-cut-block"]')).toBeNull()
    expect(container.querySelector('[data-testid="overview-continue-cut"]')).toBeNull()
  })
})

describe('MediaJobPage â€” R3 TRANSLATE opens the combined QA + Subtitles review', () => {
  const scrollSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    providersQuery.data = undefined
    scrollSpy.mockReset()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  it('opens the review section (QA + subtitles) when TRANSLATE completes', () => {
    const { container, rerender } = render(<MediaJobPage />)

    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'COMPLETED'),
        stage('s3', 'TRANSLATE', 4, 'PENDING'),
        stage('s4', 'TTS', 5, 'PENDING'),
        stage('s5', 'RENDER', 6, 'PENDING'),
      ],
    })
    rerender(<MediaJobPage />)

    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'COMPLETED'),
        stage('s3', 'TRANSLATE', 4, 'COMPLETED'),
        stage('s4', 'TTS', 5, 'PENDING'),
        stage('s5', 'RENDER', 6, 'PENDING'),
      ],
    })
    rerender(<MediaJobPage />)

    expect(openState(container, 'review')).toBe('true')
    expect((scrollSpy.mock.instances.at(-1) as HTMLElement | undefined)?.id).toBe('studio-section-review')
    // QA severity + subtitle editor render together inside the open review body.
    expect(screen.getByTestId('qa-panel-stub')).not.toBeNull()
    expect(screen.getByTestId('subtitles-stub')).not.toBeNull()
  })

  it('single-open still holds â€” opening another top-level section closes review', () => {
    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'COMPLETED'),
        stage('s3', 'TRANSLATE', 4, 'COMPLETED'),
        stage('s4', 'TTS', 5, 'PENDING'),
        stage('s5', 'RENDER', 6, 'PENDING'),
      ],
    })
    const { container } = render(<MediaJobPage />)

    // TRANSLATE already COMPLETED on first observation â†’ review auto-opens.
    expect(openState(container, 'review')).toBe('true')

    // Opening Finish & Render closes review â€” never two top-level sections open.
    fireEvent.click(screen.getByText('media:panels.finishRender'))
    expect(openState(container, 'review')).toBe('false')
    expect(openState(container, 'finish-render')).toBe('true')

    // Review can be reopened on demand.
    fireEvent.click(screen.getByText('media:panels.review'))
    expect(openState(container, 'review')).toBe('true')
    expect(openState(container, 'finish-render')).toBe('false')
  })
})

describe('MediaJobPage â€” R5 RENDER opens Export once', () => {
  const scrollSpy = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    jobQuery.data = undefined
    providersQuery.data = undefined
    scrollSpy.mockReset()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  it('scrolls to Export exactly once when RENDER flips PENDING â†’ COMPLETED', () => {
    const { container, rerender } = render(<MediaJobPage />)

    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'COMPLETED'),
        stage('s3', 'TRANSLATE', 4, 'COMPLETED'),
        stage('s4', 'TTS', 5, 'COMPLETED'),
        stage('s5', 'RENDER', 6, 'PENDING'),
      ],
    })
    rerender(<MediaJobPage />)
    scrollSpy.mockClear()

    jobQuery.data = job({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      stages: [
        stage('s1', 'EXTRACT_AUDIO', 1, 'COMPLETED'),
        stage('s2', 'STT', 2, 'COMPLETED'),
        stage('s3', 'TRANSLATE', 4, 'COMPLETED'),
        stage('s4', 'TTS', 5, 'COMPLETED'),
        stage('s5', 'RENDER', 6, 'COMPLETED'),
      ],
    })
    rerender(<MediaJobPage />)

    expect(openState(container, 'export')).toBe('true')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect((scrollSpy.mock.instances[0] as HTMLElement | undefined)?.id).toBe('studio-section-export')

    // Same COMPLETED status on the next poll â€” no second scroll.
    rerender(<MediaJobPage />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })
})
