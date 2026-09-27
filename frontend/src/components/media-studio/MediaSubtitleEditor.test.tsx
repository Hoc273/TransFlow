import { describe, expect, it, vi } from 'vitest'
import type { MediaJob, MediaJobStage, SegmentItem } from '@/types/media'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key),
  }),
}))

vi.mock('@/hooks/useMedia', () => ({
  useMediaLinkedJob: () => ({ data: { segments: linkedSegments }, isLoading: false }),
  useMediaSubtitles: () => ({ data: cuesOf(linkedSegments), isLoading: false }),
  useMediaJobQaIssues: () => ({ data: issuesOf(linkedSegments), isLoading: false }),
  useEditMediaSegment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useBatchEditMediaSegments: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useRerunTtsRender: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

// The editor/QA panel read cues from useMediaSubtitles and issues from
// useMediaJobQaIssues; derive both from the SegmentItem fixtures. Results are
// cached by fixture content so the mocked hooks return stable references while the
// data is unchanged (like react-query) — a fresh array on every render would loop
// the component's effects — yet still reflect tests that mutate a fixture.
const cueCache = new Map<string, unknown[]>()
const issueCache = new Map<string, unknown[]>()

function cached(cache: Map<string, unknown[]>, items: SegmentItem[], build: () => unknown[]) {
  const key = JSON.stringify(items)
  if (!cache.has(key)) cache.set(key, build())
  return cache.get(key)
}

function cuesOf(items: SegmentItem[]) {
  return cached(cueCache, items, () =>
    items.map((s) => ({
      id: s.id,
      seq: s.seq,
      sourceText: s.sourceText,
      targetText: s.targetText,
      startMs: s.startMs ?? 0,
      endMs: s.endMs ?? 0,
    })),
  )
}

function issuesOf(items: SegmentItem[]) {
  return cached(issueCache, items, () =>
    items.flatMap((s) => (s.qaIssues ?? []).map((q) => ({ ...q, subtitleSegmentId: s.id }))),
  )
}

const linkedSegments: SegmentItem[] = [
  {
    id: 'seg-1',
    seq: 1,
    sourceText: 'Hello',
    targetText: 'Xin chào',
    status: 'TRANSLATED',
    tmScore: null,
    qaIssues: [],
    startMs: 0,
    endMs: 4000,
  },
]

// Dynamic import after fixtures: the mocked useMedia factory references
// `linkedSegments` lazily (resolved on module load), so it must be initialized first.
const { renderToStaticMarkup } = await import('react-dom/server')
const { MediaSubtitleEditor } = await import('./MediaSubtitleEditor')

function stage(partial: Partial<MediaJobStage>): MediaJobStage {
  return {
    id: 's-render',
    stageName: 'RENDER',
    stageOrder: 6,
    status: 'FAILED',
    progressPercent: 0,
    startedAt: null,
    completedAt: null,
    ...partial,
  }
}

function job(stages: MediaJobStage[]): MediaJob {
  return {
    id: 'job-1',
    documentId: 'document-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'FAILED',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    translationJobId: 'tj-1',
    createdAt: '2026-08-11T00:00:00Z',
    stages,
  }
}

describe('MediaSubtitleEditor — W3 structured recovery (docs/19 §1.8.2)', () => {
  it('EMPTY_CUES: renders structured guidance without inspecting errorMessage', () => {
    const renderStage = stage({
      status: 'FAILED',
      failureReason: 'EMPTY_CUES',
      failureDiagnostics: null,
      errorMessage: 'Render aborted: subtitle timeline is empty',
    })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )

    // Guidance key renders (t mock returns the key verbatim) — derived from
    // failureReason only, never from the errorMessage text.
    expect(html).toContain('media:subtitles.recovery.emptyCuesTitle')
    expect(html).toContain('media:subtitles.recovery.emptyCuesBody')
    expect(html).toContain('media:subtitles.recovery.action')
    // Structured reason also re-enables Reprocess (dead-end fix).
    expect(html).toContain('media:subtitles.rerun')
  })

  it('DURATION_MISMATCH: renders banner and diagnostics chips', () => {
    const renderStage = stage({
      status: 'FAILED',
      failureReason: 'DURATION_MISMATCH',
      failureDiagnostics: {
        expectedDurationMs: 12000,
        subtitleTimelineSpanMs: 4000,
        lastCueEndMs: 4000,
        missingTailMs: 8000,
        deltaMs: 8000,
        toleranceMs: 2000,
      },
      errorMessage:
        'Render aborted: duration mismatch — subtitle timeline span 4000 ms vs cut ranges duration 12000 ms (delta 8000 ms exceeds tolerance 2000 ms)',
    })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )

    expect(html).toContain('media:subtitles.recovery.durationMismatchTitle')
    expect(html).toContain('media:subtitles.recovery.durationMismatchBody')
    // Chips: only present numeric values, formatted with the shared ms formatter.
    expect(html).toContain('media:subtitles.diag.expectedDuration')
    expect(html).toContain('media:subtitles.diag.timelineSpan')
    expect(html).toContain('media:subtitles.diag.lastCueEnd')
    expect(html).toContain('media:subtitles.diag.missingTail')
    expect(html).toContain('media:subtitles.diag.delta')
    expect(html).toContain('media:subtitles.diag.tolerance')
    expect(html).toContain('00:12')
    expect(html).toContain('00:04')
    expect(html).toContain('00:08')
    expect(html).toContain('00:02')
  })

  it('GENERATIVE_TTS_TARGET: explains that measured TTS owns the timeline', () => {
    const renderStage = stage({
      status: 'FAILED',
      failureReason: 'DURATION_MISMATCH',
      failureDiagnostics: {
        durationMismatchKind: 'GENERATIVE_TTS_TARGET',
        durationAuthority: 'TTS',
        actualTtsDurationMs: 172018,
        targetDurationMs: 300000,
        missingTailMs: 127982,
        deltaMs: 127982,
        toleranceMs: 30000,
      },
      errorMessage: 'Render aborted: generative TTS duration is outside target',
    })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )

    expect(html).toContain('media:subtitles.recovery.generativeTtsTitle')
    expect(html).toContain('media:subtitles.recovery.generativeTtsBody')
    expect(html).toContain('media:subtitles.recovery.generativeTtsAction')
    expect(html).toContain('media:subtitles.diag.actualTtsDuration')
    expect(html).toContain('media:subtitles.diag.targetDuration')
    expect(html).not.toContain('media:subtitles.recovery.durationMismatchTitle')
    expect(html).not.toContain('media:subtitles.diag.lastCueEnd')
  })

  it('absent diagnostics: no crash and no fake chips', () => {
    const renderStage = stage({
      status: 'FAILED',
      failureReason: 'DURATION_MISMATCH',
      failureDiagnostics: null,
    })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )

    expect(html).toContain('media:subtitles.recovery.durationMismatchTitle')
    expect(html).not.toContain('media:subtitles.diag.expectedDuration')
    expect(html).not.toContain('media:subtitles.diag.missingTail')
  })

  it('missingTailMs <= 0: never presented as missing', () => {
    const renderStage = stage({
      status: 'FAILED',
      failureReason: 'DURATION_MISMATCH',
      failureDiagnostics: {
        expectedDurationMs: 12000,
        subtitleTimelineSpanMs: 15000,
        lastCueEndMs: 15000,
        missingTailMs: -3000,
        deltaMs: 3000,
        toleranceMs: 2000,
      },
    })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )

    expect(html).toContain('media:subtitles.diag.delta')
    // Negative missingTail must not produce a "missing" chip.
    expect(html).not.toContain('media:subtitles.diag.missingTail')
  })

  it('unrelated RENDER FAILED: no W3 banner, no W3 rerun path', () => {
    const renderStage = stage({
      status: 'FAILED',
      failureReason: null,
      failureDiagnostics: null,
      errorMessage: 'Attempt 1 failed: provider unavailable',
    })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )

    expect(html).not.toContain('media:subtitles.recovery.emptyCuesTitle')
    expect(html).not.toContain('media:subtitles.recovery.durationMismatchTitle')
    expect(html).not.toContain('media:subtitles.rerun')
  })

  it('dead-end fix: TTS SKIPPED + RENDER FAILED + structured reason keeps Reprocess', () => {
    const ttsStage = {
      id: 's-tts',
      stageName: 'TTS',
      stageOrder: 5,
      status: 'SKIPPED',
      progressPercent: 0,
      startedAt: null,
      completedAt: null,
    } as MediaJobStage
    const renderStage = stage({
      status: 'FAILED',
      failureReason: 'EMPTY_CUES',
    })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([ttsStage, renderStage])} />,
    )

    expect(html).toContain('media:subtitles.rerun')
  })

  it('negative case: TTS SKIPPED + RENDER FAILED without reason keeps old UX (no button)', () => {
    const ttsStage = {
      id: 's-tts',
      stageName: 'TTS',
      stageOrder: 5,
      status: 'SKIPPED',
      progressPercent: 0,
      startedAt: null,
      completedAt: null,
    } as MediaJobStage
    const renderStage = stage({ status: 'FAILED', failureReason: null })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([ttsStage, renderStage])} />,
    )

    expect(html).not.toContain('media:subtitles.rerun')
  })

  it('existing editor behavior: collapsed cue row expands into the editor via selectedCueId', () => {
    const renderStage = stage({ status: 'PENDING' })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} selectedCueId="seg-1" />,
    )

    // Collapsed row keeps seq + target preview…
    expect(html).toContain('#1')
    expect(html).toContain('Xin chào')
    // …and the selected cue opens the inline editor (source, textarea, timing, save).
    expect(html).toContain('media:subtitles.save')
    expect(html).toContain('media:subtitles.sourceLabel')
    expect(html).toContain('Hello')
    expect(html).not.toContain('media:subtitles.recovery.emptyCuesTitle')
  })

  it('QA cross-check: cue with open QA issues shows a chip and card highlight', () => {
    const previous = linkedSegments[0].qaIssues
    linkedSegments[0].qaIssues = [
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
    ]
    const renderStage = stage({ status: 'PENDING' })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )
    linkedSegments[0].qaIssues = previous

    expect(html).toContain('data-testid="subtitle-qa-chip-1"')
    expect(html).toContain('media:subtitles.qaIssues')
    expect(html).toContain('has-qa')
    expect(html).toContain('qa-tone-critical')
  })

  it('QA cross-check: resolved-only issues never flag the cue', () => {
    const previous = linkedSegments[0].qaIssues
    linkedSegments[0].qaIssues = [
      {
        id: 'qa-1',
        type: 'terminology',
        severity: 'HIGH',
        message: 'mismatch',
        sourceSpan: null,
        targetSpan: null,
        suggestion: null,
        resolved: true,
      },
    ]
    const renderStage = stage({ status: 'PENDING' })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )
    linkedSegments[0].qaIssues = previous

    expect(html).not.toContain('data-testid="subtitle-qa-chip-1"')
    expect(html).not.toContain('has-qa')
  })

  it('Next step bridge: renders next step button in manual and auto modes when onProceedToNextStep is provided', () => {
    const renderStage = stage({ status: 'PENDING' })
    const manualJob: MediaJob = {
      ...job([renderStage]),
      workflowMode: 'MANUAL',
    }
    const onNext = vi.fn()
    const htmlManual = renderToStaticMarkup(
      <MediaSubtitleEditor
        workspaceId="ws"
        job={manualJob}
        onProceedToNextStep={onNext}
      />,
    )

    // Manual mode uses nextStepManual label inside footer bar
    expect(htmlManual).toContain('data-testid="subtitle-next-step"')
    expect(htmlManual).toContain('data-testid="subtitle-footer-bar"')
    expect(htmlManual).toContain('media:subtitles.nextStepManual')
    expect(htmlManual).toContain('media:subtitles.readyToProceedHint')

    const autoJob: MediaJob = {
      ...job([renderStage]),
      workflowMode: 'AUTO',
    }
    const htmlAuto = renderToStaticMarkup(
      <MediaSubtitleEditor
        workspaceId="ws"
        job={autoJob}
        onProceedToNextStep={onNext}
      />,
    )

    // Auto mode uses nextStep label
    expect(htmlAuto).toContain('data-testid="subtitle-next-step"')
    expect(htmlAuto).toContain('media:subtitles.nextStep')
  })

  it('Next step bridge: hides next step buttons when onProceedToNextStep is not provided', () => {
    const renderStage = stage({ status: 'PENDING' })
    const html = renderToStaticMarkup(
      <MediaSubtitleEditor workspaceId="ws" job={job([renderStage])} />,
    )

    expect(html).not.toContain('data-testid="subtitle-next-step"')
    expect(html).not.toContain('data-testid="subtitle-footer-bar"')
  })
})
