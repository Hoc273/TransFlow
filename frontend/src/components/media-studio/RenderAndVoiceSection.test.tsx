import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RenderAndVoiceSection } from './RenderAndVoiceSection'
import type { MediaJob, MediaJobStage } from '@/types/media'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key),
  }),
}))

vi.mock('@/hooks/useMedia', () => ({
  useRenderConfig: () => ({ data: undefined, isLoading: false }),
}))

// The workbench redesign (§1.8.2) moved the group shells INTO the panel; the
// section's job is to wire the voice/style slots through it. The stub renders
// the slots so the SSR output proves the wiring end to end.
vi.mock('@/components/media-studio/RenderPreparationPanel', () => ({
  RenderPreparationPanel: ({ voiceSlot, styleSlot }: { voiceSlot?: React.ReactNode; styleSlot?: React.ReactNode }) => (
    <div data-testid="render-prep-stub">
      {voiceSlot}
      {styleSlot}
    </div>
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
vi.mock('@/components/media-studio/SubtitleStylePanel', () => ({
  SubtitleStylePanel: () => <div data-testid="style-stub" />,
}))
vi.mock('@/components/media-studio/VoiceSelector', () => ({
  VoiceSelector: (props: { allowOriginal?: boolean }) => (
    <div data-testid="voice-stub" data-allow-original={String(props.allowOriginal)} />
  ),
}))

function stage(
  stageName: string,
  status: MediaJobStage['status'],
  order: number,
): MediaJobStage {
  return {
    id: `s-${stageName}`,
    stageName,
    stageOrder: order,
    status,
    progressPercent: status === 'COMPLETED' ? 100 : status === 'PROCESSING' ? 40 : 0,
    startedAt: null,
    completedAt: null,
  }
}

function job(stages: MediaJobStage[]): MediaJob {
  return {
    id: 'job-1',
    documentId: 'd1',
    rootAssetId: 'a1',
    processingMode: 'TRANSLATE_ONLY',
    recipeId: 'localization.full',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'PROCESSING',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-08-12T00:00:00Z',
    stages,
  }
}

function renderSection(jobOverride: MediaJob) {
  return renderToStaticMarkup(
    <RenderAndVoiceSection
      workspaceId="ws"
      job={jobOverride}
      providers={[]}
      voices={[]}
      selectedProviderId={null}
      canEdit
      selectVoicePending={false}
      onVoiceChange={() => undefined}
    />,
  )
}

describe('RenderAndVoiceSection', () => {
  it('wires voice + subtitle style slots through the render workbench without inventing stages', () => {
    const html = renderSection(
      job([
        stage('TTS', 'COMPLETED', 5),
        stage('AUDIO_MIX', 'PROCESSING', 6),
        stage('RENDER', 'PENDING', 7),
      ]),
    )

    expect(html).toContain('data-testid="render-and-voice-section"')
    expect(html).toContain('data-testid="render-prep-stub"')
    // VoiceSelector + SubtitleStylePanel ride the panel's group ①/② slots.
    expect(html).toContain('data-testid="voice-stub"')
    expect(html).toContain('data-testid="finish-voice-block"')
    expect(html).toContain('data-testid="style-stub"')
    expect(html).toContain('data-testid="finish-style-block"')
    // The downstream stage strip is not duplicated inside the section — the
    // pinned pipeline stepper above already shows stage progress.
    expect(html).not.toContain('data-testid="finish-stage-progress"')
    expect(html).not.toContain('data-finish-stage')
  })

  it('keeps the regen hint next to the voice slot', () => {
    const html = renderSection(
      job([
        stage('TTS', 'COMPLETED', 5),
        stage('RENDER', 'PENDING', 6),
      ]),
    )
    expect(html).toContain('voice.regenHint')
  })

  it('disables allowOriginal on VoiceSelector for generative recap recipes', () => {
    const locHtml = renderSection(
      job([stage('TTS', 'PENDING', 5)]),
    )
    expect(locHtml).toContain('data-allow-original="true"')

    const genJob = {
      ...job([stage('TTS', 'PENDING', 5)]),
      recipeId: 'summary.generative',
    }
    const genHtml = renderSection(genJob)
    expect(genHtml).toContain('data-allow-original="false"')
  })
})
