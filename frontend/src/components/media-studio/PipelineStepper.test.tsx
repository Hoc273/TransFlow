import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PipelineStepper } from './PipelineStepper'
import type { MediaJob, MediaJobStage } from '@/types/media'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key),
  }),
}))

const legacySixStages: MediaJobStage[] = [
  'EXTRACT_AUDIO',
  'STT',
  'SUMMARIZE',
  'TRANSLATE',
  'TTS',
  'RENDER',
].map((stageName, index) => ({
  id: `stage-${index + 1}`,
  stageName,
  stageOrder: index + 1,
  status: 'COMPLETED',
  progressPercent: 100,
  startedAt: null,
  completedAt: null,
}))

const eightStages: MediaJobStage[] = [
  'EXTRACT_AUDIO',
  'SOURCE_SEPARATION',
  'STT',
  'SUMMARIZE',
  'TRANSLATE',
  'TTS',
  'AUDIO_MIX',
  'RENDER',
].map((stageName, index) => ({
  id: `stage-${index + 1}`,
  stageName,
  stageOrder: index + 1,
  status: stageName === 'SOURCE_SEPARATION' || stageName === 'AUDIO_MIX' ? 'SKIPPED' : 'COMPLETED',
  progressPercent: stageName === 'SOURCE_SEPARATION' || stageName === 'AUDIO_MIX' ? 0 : 100,
  startedAt: null,
  completedAt: null,
}))

function job(status: MediaJob['status'], stages: MediaJobStage[]): MediaJob {
  return {
    id: 'job-1',
    documentId: 'document-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status,
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-07-26T00:00:00Z',
    stages,
  }
}

function stagesWith(
  overrides: Partial<Record<string, MediaJobStage['status']>>,
  base: MediaJobStage[] = eightStages,
): MediaJobStage[] {
  return base.map((s) => {
    const status = overrides[s.stageName]
    if (!status) return { ...s }
    return {
      ...s,
      status,
      progressPercent: status === 'PROCESSING' ? 40 : status === 'COMPLETED' ? 100 : 0,
    }
  })
}

describe('PipelineStepper dynamic stage order', () => {
  it('renders legacy 6-stage jobs without inventing extra steps', () => {
    const html = renderToStaticMarkup(<PipelineStepper job={job('COMPLETED', legacySixStages)} />)

    // t() mock falls back to defaultValue = stageName with underscores → spaces
    expect(html).toContain('EXTRACT AUDIO')
    expect(html).toContain('RENDER')
    expect(html).not.toContain('SOURCE SEPARATION')
    expect(html).not.toContain('AUDIO MIX')
    expect(html.match(/media-pipeline-stage/g)?.length).toBe(6)
  })

  it('renders CT6.1 8-stage jobs with skipped optional audio stages', () => {
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', eightStages)} />)

    expect(html).toContain('SOURCE SEPARATION')
    expect(html).toContain('AUDIO MIX')
    expect(html).toContain('pipeline.skippedAudioOptional')
    expect(html.match(/media-pipeline-stage/g)?.length).toBe(8)
  })

  it('renders fail-closed when stages are empty — never invents placeholder statuses', () => {
    const empty = job('COMPLETED', [])
    const html = renderToStaticMarkup(<PipelineStepper job={empty} />)

    // No fabricated PENDING/SKIPPED nodes — a neutral no-data state instead.
    expect(html).toContain('data-testid="pipeline-no-stages"')
    expect(html).toContain('pipeline.noStages')
    expect(html.match(/media-pipeline-stage/g)).toBeNull()
    expect(html).not.toContain('data-status="PENDING"')
    expect(html).not.toContain('data-status="SKIPPED"')
  })

  it('keeps SKIPPED node badge while painting outgoing connector green', () => {
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', eightStages)} />)

    // SOURCE_SEPARATION is SKIPPED — node status stays SKIPPED
    expect(html).toMatch(/data-stage="SOURCE_SEPARATION"[^>]*data-status="SKIPPED"/)
    expect(html).toContain('media-stage-SKIPPED')
    // Outgoing connector from SKIPPED is the completed-path (green)
    expect(html).toMatch(/data-stage="SOURCE_SEPARATION"[^>]*data-connector="connector-done"/)
    expect(html).toMatch(/data-stage="AUDIO_MIX"[^>]*data-connector="connector-done"/)
  })

  it('pre-marked SKIPPED stage keeps neutral connector until the workflow reaches it', () => {
    // SOURCE_SEPARATION / SUMMARIZE are SKIPPED at creation, everything after is
    // still PENDING — the workflow has not passed them yet (job at EXTRACT_AUDIO).
    const stages = stagesWith({
      EXTRACT_AUDIO: 'PROCESSING',
      SOURCE_SEPARATION: 'SKIPPED',
      STT: 'PENDING',
      SUMMARIZE: 'SKIPPED',
      TRANSLATE: 'PENDING',
      TTS: 'PENDING',
      AUDIO_MIX: 'PENDING',
      RENDER: 'PENDING',
    })
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).toMatch(/data-stage="SOURCE_SEPARATION"[^>]*data-status="SKIPPED"/)
    expect(html).toMatch(/data-stage="SOURCE_SEPARATION"[^>]*data-connector="connector-pending"/)
    expect(html).toMatch(/data-stage="SUMMARIZE"[^>]*data-connector="connector-pending"/)
  })

  it('SKIPPED connector turns green once a later stage has started', () => {
    // Workflow passed SOURCE_SEPARATION (STT now running) but SUMMARIZE is still
    // ahead of the pipeline — only the passed SKIPPED connector is green.
    const stages = stagesWith({
      EXTRACT_AUDIO: 'COMPLETED',
      SOURCE_SEPARATION: 'SKIPPED',
      STT: 'PROCESSING',
      SUMMARIZE: 'SKIPPED',
      TRANSLATE: 'PENDING',
      TTS: 'PENDING',
      AUDIO_MIX: 'PENDING',
      RENDER: 'PENDING',
    })
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).toMatch(/data-stage="SOURCE_SEPARATION"[^>]*data-connector="connector-done"/)
    expect(html).toMatch(/data-stage="SUMMARIZE"[^>]*data-connector="connector-pending"/)
  })

  it('a PROCESSING stage keeps its outgoing connector gray until it completes', () => {
    // The node itself shows the spinner/progress — the line to the next stage
    // stays neutral (connector-pending) instead of painting accent.
    const stages = stagesWith({
      EXTRACT_AUDIO: 'COMPLETED',
      SOURCE_SEPARATION: 'SKIPPED',
      STT: 'PROCESSING',
      SUMMARIZE: 'SKIPPED',
      TRANSLATE: 'PENDING',
      TTS: 'PENDING',
      AUDIO_MIX: 'PENDING',
      RENDER: 'PENDING',
    })
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).toMatch(/data-stage="STT"[^>]*data-connector="connector-pending"/)
    expect(html).not.toContain('connector-active')
  })

  it('a rewound pipeline (downstream STALE) does NOT paint SKIPPED connectors green', () => {
    // Source language override rewinds the job: STT reset to PENDING, downstream
    // COMPLETED → STALE. STALE must not count as "the workflow passed the SKIPPED
    // stage" — the green path would lie about where the workflow is.
    const stages = stagesWith({
      EXTRACT_AUDIO: 'COMPLETED',
      SOURCE_SEPARATION: 'SKIPPED',
      STT: 'PENDING',
      SUMMARIZE: 'SKIPPED',
      TRANSLATE: 'STALE',
      TTS: 'STALE',
      AUDIO_MIX: 'PENDING',
      RENDER: 'STALE',
    })
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).toMatch(/data-stage="SOURCE_SEPARATION"[^>]*data-connector="connector-pending"/)
    expect(html).toMatch(/data-stage="SUMMARIZE"[^>]*data-connector="connector-pending"/)
  })

  it('COMPLETED stages also use green connector-done path', () => {
    const html = renderToStaticMarkup(<PipelineStepper job={job('COMPLETED', legacySixStages)} />)
    expect(html).toMatch(/data-stage="EXTRACT_AUDIO"[^>]*data-connector="connector-done"/)
    expect(html).toMatch(/data-stage="STT"[^>]*data-connector="connector-done"/)
  })

  it('PENDING stages keep gray connector-pending path', () => {
    const stages = stagesWith({
      EXTRACT_AUDIO: 'COMPLETED',
      SOURCE_SEPARATION: 'SKIPPED',
      STT: 'PENDING',
      SUMMARIZE: 'PENDING',
      TRANSLATE: 'PENDING',
      TTS: 'PENDING',
      AUDIO_MIX: 'PENDING',
      RENDER: 'PENDING',
    })
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)
    expect(html).toMatch(/data-stage="STT"[^>]*data-connector="connector-pending"/)
    expect(html).toMatch(/data-stage="RENDER"[^>]*data-status="PENDING"/)
  })

  it.each([
    'EXTRACT_AUDIO',
    'STT',
    'SUMMARIZE',
    'TRANSLATE',
    'TTS',
    'AUDIO_MIX',
    'RENDER',
  ] as const)('renders unified PROCESSING treatment for %s (not RENDER-only)', (name) => {
    const stages = stagesWith(
      Object.fromEntries(
        eightStages.map((s) => [
          s.stageName,
          s.stageName === name
            ? 'PROCESSING'
            : s.stageName === 'SOURCE_SEPARATION' || s.stageName === 'AUDIO_MIX'
              ? name === 'AUDIO_MIX'
                ? 'PROCESSING'
                : 'SKIPPED'
              : 'PENDING',
        ]),
      ) as Partial<Record<string, MediaJobStage['status']>>,
    )
    // Force the named stage to PROCESSING even if AUDIO_MIX was SKIPPED in base.
    const idx = stages.findIndex((s) => s.stageName === name)
    stages[idx] = {
      ...stages[idx],
      status: 'PROCESSING',
      progressPercent: 25,
    }

    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).toMatch(new RegExp(`data-stage="${name}"[^>]*data-status="PROCESSING"`))
    expect(html).toContain(`data-testid="stage-progress-${name}"`)
    expect(html).toContain('media-stage-PROCESSING')
    expect(html).toContain('animate-spin')
  })

  it('renders each API stage status verbatim — status is never inferred or rewritten', () => {
    const apiStatuses = [
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'STALE',
      'SKIPPED',
      'CANCEL_REQUESTED',
      'CANCELLED',
    ]
    const stages: MediaJobStage[] = eightStages.map((s, i) => ({
      ...s,
      status: apiStatuses[i % apiStatuses.length],
    }))
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    for (const [i, s] of stages.entries()) {
      const stage = stages[i]
      expect(html).toMatch(
        new RegExp(`data-stage="${s.stageName}"[^>]*data-status="${stage.status}"`),
      )
    }
  })

  it('FAILED does not invent recovery guidance without structured reason', () => {
    const stages = stagesWith({ TTS: 'FAILED' })
    const tts = stages.find((s) => s.stageName === 'TTS')!
    tts.errorMessage = 'Attempt 1 failed: provider unavailable'
    tts.failureReason = null
    const html = renderToStaticMarkup(<PipelineStepper job={job('FAILED', stages)} />)

    expect(html).toMatch(/data-stage="TTS"[^>]*data-status="FAILED"/)
    expect(html).toContain('Attempt 1 failed: provider unavailable')
    expect(html).not.toContain('pipeline.recovery.emptyCues')
  })

  it('W3: EMPTY_CUES FAILED RENDER shows recovery guidance plus existing errorMessage', () => {
    const stages = [...eightStages]
    stages[stages.length - 1] = {
      id: 'stage-render',
      stageName: 'RENDER',
      stageOrder: 8,
      status: 'FAILED',
      progressPercent: 0,
      failureReason: 'EMPTY_CUES',
      errorMessage: 'Render aborted: subtitle timeline is empty',
      startedAt: null,
      completedAt: null,
    }
    const html = renderToStaticMarkup(<PipelineStepper job={job('FAILED', stages)} />)

    // Guidance derived from structured reason (t mock returns the key).
    expect(html).toContain('pipeline.recovery.emptyCues')
    // Existing errorMessage still renders verbatim.
    expect(html).toContain('Render aborted: subtitle timeline is empty')
    expect(html).not.toContain('pipeline.recovery.durationMismatch')
  })

  it('W3: DURATION_MISMATCH FAILED RENDER shows its own guidance', () => {
    const stages = [...eightStages]
    stages[stages.length - 1] = {
      id: 'stage-render',
      stageName: 'RENDER',
      stageOrder: 8,
      status: 'FAILED',
      progressPercent: 0,
      failureReason: 'DURATION_MISMATCH',
      errorMessage: 'Render aborted: duration mismatch — …',
      startedAt: null,
      completedAt: null,
    }
    const html = renderToStaticMarkup(<PipelineStepper job={job('FAILED', stages)} />)

    expect(html).toContain('pipeline.recovery.durationMismatch')
    expect(html).toContain('Render aborted: duration mismatch — …')
    expect(html).not.toContain('pipeline.recovery.emptyCues')
  })

  it('W3: generative TTS discriminator selects measured narration guidance', () => {
    const stages = [...eightStages]
    stages[stages.length - 1] = {
      id: 'stage-render',
      stageName: 'RENDER',
      stageOrder: 8,
      status: 'FAILED',
      progressPercent: 0,
      failureReason: 'DURATION_MISMATCH',
      failureDiagnostics: {
        durationMismatchKind: 'GENERATIVE_TTS_TARGET',
        durationAuthority: 'TTS',
        actualTtsDurationMs: 172018,
        targetDurationMs: 300000,
      },
      errorMessage: 'Render aborted: generative TTS duration is outside target',
      startedAt: null,
      completedAt: null,
    }
    const html = renderToStaticMarkup(<PipelineStepper job={job('FAILED', stages)} />)

    expect(html).toContain('pipeline.recovery.generativeTtsDurationMismatch')
    expect(html).not.toContain('pipeline.recovery.durationMismatch')
  })

  it('W3: unrelated FAILED RENDER shows no recovery guidance', () => {
    const stages = [...eightStages]
    stages[stages.length - 1] = {
      id: 'stage-render',
      stageName: 'RENDER',
      stageOrder: 8,
      status: 'FAILED',
      progressPercent: 0,
      failureReason: null,
      errorMessage: 'Attempt 1 failed: provider unavailable',
      startedAt: null,
      completedAt: null,
    }
    const html = renderToStaticMarkup(<PipelineStepper job={job('FAILED', stages)} />)

    expect(html).toContain('Attempt 1 failed: provider unavailable')
    expect(html).not.toContain('pipeline.recovery.emptyCues')
    expect(html).not.toContain('pipeline.recovery.durationMismatch')
  })

  it('shows the attempt badge from the very first retry (attemptCount=1)', () => {
    const stages = stagesWith({ STT: 'PROCESSING' })
    const stt = stages.find((s) => s.stageName === 'STT')!
    stt.attemptCount = 1
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).toContain('data-testid="stage-attempt-STT"')
    expect(html).toContain('pipeline.attempt')
  })

  it('PENDING with an Attempt errorMessage surfaces the retry reason (no silent re-run)', () => {
    const stages = stagesWith({ STT: 'PENDING' })
    const stt = stages.find((s) => s.stageName === 'STT')!
    stt.attemptCount = 1
    stt.errorMessage = 'Attempt 1 failed: DashScope STT response requires detected_lang'
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).toContain('data-testid="stage-attempt-STT"')
    expect(html).toContain('Attempt 1 failed: DashScope STT response requires detected_lang')
  })

  it('hides the attempt badge before any retry (attemptCount=0)', () => {
    const stages = stagesWith({ STT: 'PROCESSING' })
    const stt = stages.find((s) => s.stageName === 'STT')!
    stt.attemptCount = 0
    const html = renderToStaticMarkup(<PipelineStepper job={job('PROCESSING', stages)} />)

    expect(html).not.toContain('data-testid="stage-attempt-STT"')
  })
})
