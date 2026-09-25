// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

const configQuery = { data: undefined as unknown, isPending: false, isError: false }
const updateConfig = { isPending: false, mutateAsync: vi.fn() }
const confirmRender = { isPending: false, mutateAsync: vi.fn() }
const rerunRender = { isPending: false, mutateAsync: vi.fn() }
const selectVoiceMutate = vi.fn()
const selectVoice = { isPending: false, mutateAsync: selectVoiceMutate }
const preview = {
  isPending: false as boolean,
  variables: undefined as { voiceRowId: string } | undefined,
  mutateAsync: vi.fn(),
}

vi.mock('@/hooks/useMedia', () => ({
  useRenderConfig: () => configQuery,
  useUpdateRenderConfig: () => updateConfig,
  useConfirmRender: () => confirmRender,
  useRerunRender: () => rerunRender,
  useSelectVoice: () => selectVoice,
}))

vi.mock('@/hooks/useProviders', () => ({
  useVoicePreview: () => preview,
}))

// Phase 6 V2: the panel consumes the job's assigned style through this hook —
// SSR tests here run with nothing assigned (chip hidden, controls enabled).
vi.mock('@/hooks/useSubtitleStyle', () => ({
  useJobSubtitleStyle: () => ({ data: null }),
  deriveStyleAssignment: () => ({ styleAssigned: false, snapshot: null, styledBoxMode: false }),
}))

vi.mock('@/components/media-studio/MediaSubtitleEditor', () => ({
  MediaSubtitleEditor: () => null,
}))

const { renderToStaticMarkup } = await import('react-dom/server')
const {
  AudioPresentationConfig,
  RenderPreparationPanel,
  buildPresentationPayload,
  typographyMaskBlockClass,
} = await import('./RenderPreparationPanel')
import type { RenderPresentationDraft } from './RenderPreparationPanel'
import type { AudioPresentationValues } from './RenderPreparationPanel'

import type { MediaJob, RenderConfig } from '@/types/media'
import type { ProviderConfig, TtsVoice } from '@/types/provider'

afterEach(() => {
  cleanup()
})

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
    voiceId: 'legacy-voice-id',
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
    processingMode: 'HYBRID',
    sourceLanguage: null,
    targetLang: 'vi',
    status: 'PROCESSING',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: 60,
    selectedProposalId: null,
    voiceId: null,
    recipeId: 'summary.generative',
    createdAt: '2026-08-08T00:00:00Z',
    stages: [
      { id: 's1', stageName: 'TRANSLATE', stageOrder: 5, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's2', stageName: 'TTS', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
    ],
    ...partial,
  }
}

describe('RenderPreparationPanel — Phase C authoritative voice binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configQuery.data = { confirmed: false }
    selectVoiceMutate.mockReset().mockResolvedValue(undefined)
    preview.isPending = false
    preview.variables = undefined
    preview.mutateAsync.mockReset().mockResolvedValue({ audioUrl: 'x', expiresInSeconds: 60 })
  })

  it('selects the voice ROW id (ttsVoiceId) as the current draft, not the legacy voice_id string', () => {
    const html = renderToStaticMarkup(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job({ ttsProviderId: 'p1', ttsVoiceId: 'v1', voiceId: 'legacy-voice-id' })}
        provider={provider({ id: 'p1' })}
        voices={[voice({ id: 'v1', voiceId: 'legacy-voice-id' })]}
        canEdit
      />,
    )
    // The selected item is keyed on the voice ROW id (v1) — the legacy
    // voice_id string is never used for the selection state (C5 P1 fix).
    expect(html).toContain('media-voice-item selected')
    // The card still shows the display name from the catalog.
    expect(html).toContain('Vais')
  })

  it('sends the authoritative provider + voice pair on change', async () => {
    const { runRenderPrepVoiceChange } = await import('./RenderPreparationPanel')

    await runRenderPrepVoiceChange({
      provider: provider({ id: 'p1' }),
      voiceRowId: 'v2',
      deps: { selectVoice },
    })

    // P1 fix: never the legacy voice_id string — the row UUID + provider id.
    expect(selectVoiceMutate).toHaveBeenCalledWith({ providerId: 'p1', voiceId: 'v2' })
  })

  it('refuses to emit a partial pair when the provider is unknown', async () => {
    const { runRenderPrepVoiceChange } = await import('./RenderPreparationPanel')

    await expect(
      runRenderPrepVoiceChange({
        provider: undefined,
        voiceRowId: 'v2',
        deps: { selectVoice },
      }),
    ).rejects.toThrow(/provider is required/)

    expect(selectVoiceMutate).not.toHaveBeenCalled()
  })

  it('previews the voice row UUID instead of the provider voice key', () => {
    const providerRowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const voiceRowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    render(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job({ targetLang: 'en', ttsProviderId: providerRowId, ttsVoiceId: voiceRowId })}
        provider={provider({ id: providerRowId })}
        voices={[voice({ id: voiceRowId, voiceId: 'Kai', language: 'vi', languages: ['vi', 'en'] })]}
        canEdit
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'media:voice.preview.action' }))

    expect(preview.mutateAsync).toHaveBeenCalledWith({
      providerId: providerRowId,
      voiceRowId,
      language: 'en',
    })
  })

  it('matches the preview spinner against the voice row UUID', () => {
    const voiceRowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    preview.isPending = true
    preview.variables = { voiceRowId }
    render(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job({ targetLang: 'en' })}
        provider={provider({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })}
        voices={[voice({ id: voiceRowId, voiceId: 'Kai', language: 'en' })]}
        canEdit
      />,
    )

    const button = screen.getByRole('button', { name: 'media:voice.preview.action' })
    expect(button.querySelector('svg')?.classList.contains('animate-spin')).toBe(true)
  })
})

describe('RenderPreparationPanel — Phase 6 presentation section', () => {
  const baseConfig = {
    confirmed: false,
    subtitleMode: 'HARD_SUB',
    subtitlePosition: 'BOTTOM',
    verticalOffsetPercent: 0,
    backgroundBox: true,
  } as RenderConfig

  beforeEach(() => {
    vi.clearAllMocks()
    configQuery.data = baseConfig
  })

  it('renders presentation controls with initial-state defaults', () => {
    const html = renderToStaticMarkup(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job({
          stages: [
            { id: 's1', stageName: 'TRANSLATE', stageOrder: 5, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
            { id: 's2', stageName: 'TTS', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
            { id: 's3', stageName: 'AUDIO_MIX', stageOrder: 7, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
          ],
        })}
        provider={provider({ id: 'p1' })}
        voices={[voice({ id: 'v1' })]}
        canEdit
      />,
    )

    // Default display mode is SENTENCE; words-per-phrase input is hidden.
    expect(html).toContain('value="SENTENCE" selected')
    expect(html).not.toContain('wordsPerPhrase')
    // Typography/mask block present with default (empty = keep snapshot) font.
    expect(html).toContain('presentation-typography-mask')
    expect(html).toContain('placeholder="media:renderPrep.typographyDefault"')
    // Audio controls visible when the AUDIO_MIX stage runs — unity defaults.
    expect(html).toContain('value="0"')
    expect(html).toContain('value="1"')
  })

  it('hides audio controls when the AUDIO_MIX stage is skipped', () => {
    configQuery.data = {
      ...baseConfig,
      presentation: {
        audio: { schemaVersion: 1, originalGainDb: -3 },
      },
    } as RenderConfig

    const html = renderToStaticMarkup(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job({
          stages: [
            { id: 's1', stageName: 'TRANSLATE', stageOrder: 5, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
            { id: 's2', stageName: 'TTS', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
            { id: 's3', stageName: 'AUDIO_MIX', stageOrder: 7, status: 'SKIPPED', progressPercent: 0, startedAt: null, completedAt: null },
          ],
        })}
        provider={provider({ id: 'p1' })}
        voices={[voice({ id: 'v1' })]}
        canEdit
      />,
    )

    expect(html).toContain('audioMixSkippedNote')
    expect(html).not.toContain('originalGain')
  })
})

describe('Phase 6 presentation wiring — pure helpers', () => {
  it('dimms typography/mask for SOFT_SUB and keeps them active for HARD_SUB', () => {
    expect(typographyMaskBlockClass('SOFT_SUB')).toBe('pointer-events-none opacity-50')
    expect(typographyMaskBlockClass('HARD_SUB')).toBe('')
  })
})

describe('buildPresentationPayload — Phase 6 payload builder', () => {
  const firstLayer = () => ({
    id: 'cover-1',
    type: 'SOLID' as const,
    enabled: true,
    zIndex: 0,
    anchor: 'SUBTITLE' as const,
    geometry: { widthPercent: 85, heightPercent: 12 },
    style: { color: '#000000', opacityPercent: 60 },
  })
  const draft = (partial: Partial<RenderPresentationDraft>): RenderPresentationDraft => ({
    subtitleMode: 'HARD_SUB',
    displayMode: 'SENTENCE',
    wordsPerPhrase: 3,
    maxCharactersPerCue: 40,
    fontSize: null,
    bold: null,
    coverEnabled: false,
    coverLayers: [firstLayer()],
    originalGainDb: 0,
    ttsGainDb: 0,
    duckingEnabled: true,
    duckingGainDb: -12,
    ttsTempo: 1,
    ...partial,
  })

  it('HARD_SUB with typography and cover layers emits the full envelope', () => {
    const payload = buildPresentationPayload(
      draft({
        displayMode: 'PHRASE',
        wordsPerPhrase: 4,
        fontSize: 52,
        bold: true,
        coverEnabled: true,
        coverLayers: [
          { ...firstLayer(), geometry: { widthPercent: 90, heightPercent: 12 } },
        ],
      }),
    )

    expect(payload.subtitle?.schemaVersion).toBe(1)
    expect(payload.subtitle?.displayMode).toBe('PHRASE')
    expect(payload.subtitle?.wordsPerPhrase).toBe(4)
    expect(payload.subtitle?.typography).toEqual({ fontSize: 52, bold: true })
    // V2 layers are authoritative; the legacy v1 mask is never written again.
    expect(payload.subtitle?.layers).toEqual([
      {
        id: 'cover-1',
        type: 'SOLID',
        enabled: true,
        zIndex: 0,
        anchor: 'SUBTITLE',
        geometry: { widthPercent: 90, heightPercent: 12 },
        style: { color: '#000000', opacityPercent: 60 },
      },
    ])
    expect(payload.subtitle?.mask).toBeNull()
    expect(payload.audio?.ducking).toEqual({ enabled: true, gainDb: -12 })
  })

  it('BLUR layers carry only the radius — the SOLID group never leaks', () => {
    const payload = buildPresentationPayload(
      draft({
        coverEnabled: true,
        coverLayers: [
          {
            id: 'cover-1',
            type: 'BLUR',
            enabled: true,
            zIndex: 0,
            anchor: 'CENTER',
            geometry: { widthPercent: 84, heightPercent: 8 },
            style: { blurRadius: 14 },
          },
        ],
      }),
    )

    expect(payload.subtitle?.layers).toEqual([
      {
        id: 'cover-1',
        type: 'BLUR',
        enabled: true,
        zIndex: 0,
        anchor: 'CENTER',
        geometry: { widthPercent: 84, heightPercent: 8 },
        style: { blurRadius: 14 },
      },
    ])
    expect(payload.subtitle?.mask).toBeNull()
  })

  it('SOFT_SUB never carries typography, layers or mask', () => {
    const payload = buildPresentationPayload(
      draft({ subtitleMode: 'SOFT_SUB', fontSize: 52, coverEnabled: true }),
    )

    expect(payload.subtitle?.typography).toBeNull()
    expect(payload.subtitle?.layers).toBeNull()
    expect(payload.subtitle?.mask).toBeNull()
  })

  it('disabled cover toggle sends explicit nulls (full-replacement clears stored covers)', () => {
    const payload = buildPresentationPayload(draft({}))

    expect(payload.subtitle?.layers).toBeNull()
    expect(payload.subtitle?.mask).toBeNull()
  })

  it('defaults are never synthesized as overrides', () => {
    const payload = buildPresentationPayload(draft({}))

    expect(payload.subtitle?.displayMode).toBe('SENTENCE')
    expect(payload.subtitle?.wordsPerPhrase).toBeNull()
    expect(payload.subtitle?.maxCharactersPerCue).toBeNull()
    expect(payload.subtitle?.typography).toBeNull()
    expect(payload.audio?.ttsTempo).toBe(1)
  })

  it('CHARACTERS sends maxCharactersPerCue and never wordsPerPhrase', () => {
    const payload = buildPresentationPayload(
      draft({ displayMode: 'CHARACTERS', wordsPerPhrase: 7, maxCharactersPerCue: 40 }),
    )

    expect(payload.subtitle?.displayMode).toBe('CHARACTERS')
    expect(payload.subtitle?.maxCharactersPerCue).toBe(40)
    expect(payload.subtitle?.wordsPerPhrase).toBeNull()
  })

  it('PHRASE never sends maxCharactersPerCue — no stale value after switching from CHARACTERS', () => {
    const payload = buildPresentationPayload(
      draft({ displayMode: 'PHRASE', wordsPerPhrase: 4, maxCharactersPerCue: 40 }),
    )

    expect(payload.subtitle?.wordsPerPhrase).toBe(4)
    expect(payload.subtitle?.maxCharactersPerCue).toBeNull()
  })

  it('SENTENCE/WORD send neither wordsPerPhrase nor maxCharactersPerCue', () => {
    const sentence = buildPresentationPayload(draft({ displayMode: 'SENTENCE', maxCharactersPerCue: 40 }))
    expect(sentence.subtitle?.maxCharactersPerCue).toBeNull()
    expect(sentence.subtitle?.wordsPerPhrase).toBeNull()

    const word = buildPresentationPayload(draft({ displayMode: 'WORD', maxCharactersPerCue: 40 }))
    expect(word.subtitle?.maxCharactersPerCue).toBeNull()
    expect(word.subtitle?.wordsPerPhrase).toBeNull()
  })
})

describe('AudioPresentationConfig — PRESET-VIZ FE follow-up (docs/97 §19.16)', () => {
  const audio: AudioPresentationValues = {
    originalGainDb: 0,
    ttsGainDb: 0,
    duckingEnabled: true,
    duckingGainDb: -12,
    ttsTempo: 1,
  }

  it('renders a collapsible details by default (historical behavior)', () => {
    const html = renderToStaticMarkup(
      <AudioPresentationConfig audio={audio} locked={false} onChange={() => {}} />,
    )
    expect(html).toContain('<details')
    expect(html).toContain('<summary>')
  })

  it('renders always-expanded without details/summary when collapsible=false', () => {
    const html = renderToStaticMarkup(
      <AudioPresentationConfig
        audio={audio}
        locked={false}
        collapsible={false}
        onChange={() => {}}
      />,
    )
    expect(html).not.toContain('<details')
    expect(html).not.toContain('<summary>')
    expect(html).toContain('data-testid="audio-config-expanded"')
    expect(html).toContain('media:renderPrep.originalGain')
    expect(html).toContain('media:renderPrep.ttsTempo')
  })

  it('PRESET-VIZ: shows background color + alpha + text color pickers for HARD_SUB with box on', () => {
    const html = renderToStaticMarkup(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job({ subtitleMode: 'HARD_SUB' })}
        provider={provider({ id: 'p1' })}
        voices={[voice({ id: 'v1' })]}
        canEdit
      />,
    )
    expect(html).toContain('data-testid="render-prep-background-color"')
    expect(html).toContain('data-testid="render-prep-background-alpha"')
    expect(html).toContain('data-testid="render-prep-text-color"')
    // §1.8.2 redesign: the live sample mirrors the UNSAVED draft — with the
    // 2026-09 defaults (yellow box @ 100% alpha, black text) the sample shows it.
    const sample = /<div[^>]*render-prep-draft-sample[^>]*>/.exec(html)![0]
    expect(sample).toContain('background:rgba(255, 255, 0, 1)')
    expect(sample).toContain('color:#000000')
  })
})

describe('RenderPreparationPanel — M-B CHARACTERS display mode (docs/16 §7.4, W2)', () => {
  const baseConfig = {
    confirmed: false,
    subtitleMode: 'HARD_SUB',
    subtitlePosition: 'BOTTOM',
    verticalOffsetPercent: 0,
    backgroundBox: true,
  } as RenderConfig

  const charsStages = [
    { id: 's1', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
    { id: 's2', stageName: 'TTS', stageOrder: 5, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
  ]

  const renderPanel = (jobOverrides: Partial<MediaJob> = {}) =>
    renderToStaticMarkup(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job(jobOverrides)}
        provider={provider({ id: 'p1' })}
        voices={[voice({ id: 'v1' })]}
        canEdit
      />,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    configQuery.data = baseConfig
  })

  it('offers CHARACTERS in the display mode selector', () => {
    const html = renderPanel({ stages: charsStages })

    expect(html).toContain('value="CHARACTERS"')
    expect(html).toContain('media:renderPrep.displayModeCharacters')
  })

  it('MaxCharactersPerCueField renders the input, help text and no error for valid values', async () => {
    const { MaxCharactersPerCueField } = await import('./RenderPreparationPanel')

    const html = renderToStaticMarkup(
      <MaxCharactersPerCueField value={40} locked={false} invalid={false} onChange={() => {}} />,
    )

    expect(html).toContain('media:renderPrep.maxCharactersPerCue')
    expect(html).toContain('media:renderPrep.maxCharactersPerCueHint')
    expect(html).toContain('value="40"')
    expect(html).not.toContain('media:renderPrep.maxCharactersInvalid')
  })

  it('MaxCharactersPerCueField shows the validation state for <10, >80 and non-integers', async () => {
    const { MaxCharactersPerCueField, isMaxCharactersPerCueValid } = await import('./RenderPreparationPanel')

    for (const value of [9, 81, 40.5]) {
      const html = renderToStaticMarkup(
        <MaxCharactersPerCueField value={value} locked={false} invalid={!isMaxCharactersPerCueValid(value)} onChange={() => {}} />,
      )
      expect(html).toContain('media:renderPrep.maxCharactersInvalid')
    }
  })

  it('MaxCharactersPerCueField accepts boundary values 10 and 80', async () => {
    const { MaxCharactersPerCueField, isMaxCharactersPerCueValid } = await import('./RenderPreparationPanel')

    for (const value of [10, 80]) {
      const html = renderToStaticMarkup(
        <MaxCharactersPerCueField value={value} locked={false} invalid={!isMaxCharactersPerCueValid(value)} onChange={() => {}} />,
      )
      expect(html).not.toContain('media:renderPrep.maxCharactersInvalid')
    }
  })

  it('isMaxCharactersPerCueValid — 10..80 integer boundary only', async () => {
    const { isMaxCharactersPerCueValid } = await import('./RenderPreparationPanel')

    expect(isMaxCharactersPerCueValid(10)).toBe(true)
    expect(isMaxCharactersPerCueValid(80)).toBe(true)
    expect(isMaxCharactersPerCueValid(9)).toBe(false)
    expect(isMaxCharactersPerCueValid(81)).toBe(false)
    expect(isMaxCharactersPerCueValid(40.5)).toBe(false)
    expect(isMaxCharactersPerCueValid(0)).toBe(false)
  })

  it('M-A lock unchanged: AUTO + CHARACTERS stays frozen read-only', () => {
    configQuery.data = {
      ...baseConfig,
      confirmed: true,
      presentation: {
        subtitle: { schemaVersion: 1, displayMode: 'CHARACTERS', maxCharactersPerCue: 40 },
      },
    } as RenderConfig

    const html = renderPanel({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      subtitleMode: 'HARD_SUB',
      stages: charsStages,
    })

    expect(html).not.toContain('render-prep-frozen')
    expect(html).not.toContain('>media:renderPrep.confirm<')
    expect(html).not.toContain('media:renderPrep.maxCharactersInvalid')
  })
})

describe('RenderPreparationPanel — M-A workflow mode locking (docs/19 §1.8.2)', () => {
  const frozenConfig = {
    confirmed: true,
    subtitleMode: 'HARD_SUB',
    subtitlePosition: 'BOTTOM',
    verticalOffsetPercent: 0,
    backgroundBox: true,
  } as RenderConfig

  const readyStages = (ttsStatus: string) => [
    { id: 's1', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
    { id: 's2', stageName: 'TTS', stageOrder: 5, status: ttsStatus, progressPercent: 0, startedAt: null, completedAt: null },
    { id: 's3', stageName: 'RENDER', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
  ]

  const renderPanel = (jobOverrides: Partial<MediaJob>) =>
    renderToStaticMarkup(
      <RenderPreparationPanel
        workspaceId="ws"
        job={job(jobOverrides)}
        provider={provider({ id: 'p1' })}
        voices={[voice({ id: 'v1' })]}
        canEdit
      />,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    configQuery.data = frozenConfig
  })

  it('AUTO job remains read-only without a frozen banner', () => {
    const html = renderPanel({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      subtitleMode: 'HARD_SUB',
      stages: readyStages('PENDING'),
    })

    expect(html).not.toContain('render-prep-frozen')
    expect(html).not.toContain('media:renderPrep.frozenHint')
    expect(html).not.toContain('>media:renderPrep.confirm<')
    expect(html).not.toContain('render-prep-locked')
  })

  it('AUTO + TTS FAILED stays locked — no editable dead-end', () => {
    const html = renderPanel({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      subtitleMode: 'HARD_SUB',
      stages: readyStages('FAILED'),
    })

    expect(html).not.toContain('render-prep-frozen')
    expect(html).not.toContain('>media:renderPrep.confirm<')
  })

  it('AUTO + TTS CANCELLED stays locked — no editable dead-end', () => {
    const html = renderPanel({
      recipeId: 'localization.full',
      workflowMode: 'AUTO',
      subtitleMode: 'HARD_SUB',
      stages: readyStages('CANCELLED'),
    })

    expect(html).not.toContain('render-prep-frozen')
    expect(html).not.toContain('>media:renderPrep.confirm<')
  })

  it('workflowMode NULL + localization.full derives AUTO — frozen, never treated as MANUAL', () => {
    const html = renderPanel({
      recipeId: 'localization.full',
      workflowMode: null,
      subtitleMode: 'HARD_SUB',
      stages: readyStages('PENDING'),
    })

    expect(html).not.toContain('render-prep-frozen')
    expect(html).not.toContain('>media:renderPrep.confirm<')
  })

  it('C2: MANUAL localization.full + SOFT_SUB is editable with a confirm action (CP-B = every MANUAL)', () => {
    configQuery.data = { confirmed: false } as RenderConfig
    const html = renderPanel({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      subtitleMode: 'SOFT_SUB',
      stages: readyStages('PENDING'),
    })

    expect(html).not.toContain('render-prep-readonly')
    expect(html).not.toContain('render-prep-frozen')
    expect(html).toContain('>media:renderPrep.confirm<')
  })

  it('C2 P1 (BA review): voice-less MANUAL non-generative job can confirm — original-only is legal', () => {
    configQuery.data = { confirmed: false } as RenderConfig
    const html = renderPanel({
      recipeId: 'summary.extractive',
      workflowMode: 'MANUAL',
      subtitleMode: 'SOFT_SUB',
      voiceId: null,
      ttsVoiceId: null,
      stages: readyStages('PENDING'),
    })

    // No voice binding (original-only, TTS SKIPPED path — Q-M-WORKFLOW-06):
    // the confirm button must be ENABLED — never blocked by a missing voiceDraft.
    expect(html).toContain('>media:renderPrep.confirm<')
    // Scope the enabled-assertion to the confirm button itself (Phase 6 adds
    // always-disabled controls like the fixed layer-anchor select).
    const confirmTag = /<button[^>]*render-prep-confirm[^>]*>/.exec(html)![0]
    expect(confirmTag).not.toContain('disabled')
  })

  it('generative MANUAL without a voice still blocks confirm (dubbing-mandatory)', () => {
    configQuery.data = { confirmed: false } as RenderConfig
    const html = renderPanel({
      recipeId: 'summary.generative',
      workflowMode: 'MANUAL',
      subtitleMode: 'HARD_SUB',
      voiceId: null,
      ttsVoiceId: null,
      stages: readyStages('PENDING'),
    })

    // Generative keeps the historical voice gate — confirm stays disabled.
    expect(html).toContain('disabled=""')
    expect(html).toContain('>media:renderPrep.confirm<')
  })

  it('MANUAL + TTS FAILED keeps the historical re-confirm path (no frozen banner)', () => {
    const html = renderPanel({
      recipeId: 'localization.full',
      workflowMode: 'MANUAL',
      subtitleMode: 'HARD_SUB',
      stages: readyStages('FAILED'),
    })

    expect(html).not.toContain('render-prep-frozen')
    expect(html).not.toContain('render-prep-locked')
    expect(html).toContain('>media:renderPrep.confirm<')
  })

  it('legacy summary.generative (NULL mode) derives MANUAL — editable, no frozen banner', () => {
    configQuery.data = { confirmed: false } as RenderConfig
    const html = renderPanel({
      recipeId: 'summary.generative',
      workflowMode: null,
      stages: readyStages('PENDING'),
    })

    expect(html).not.toContain('render-prep-frozen')
    expect(html).not.toContain('render-prep-locked')
    expect(html).toContain('>media:renderPrep.confirm<')
  })

  it('MANUAL job with completed RENDER shows unlock reapply button and reapply hint', () => {
    configQuery.data = { confirmed: true } as RenderConfig
    const html = renderPanel({
      recipeId: 'summary.generative',
      workflowMode: 'MANUAL',
      stages: [
        { id: 's1', stageName: 'TRANSLATE', stageOrder: 4, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's2', stageName: 'TTS', stageOrder: 5, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
        { id: 's3', stageName: 'RENDER', stageOrder: 6, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      ],
    })

    expect(html).toContain('render-reapply-unlock')
    expect(html).toContain('render-prep-reapply-hint')
    expect(html).not.toContain('render-prep-confirm')
  })

  it('summary recipe displays summary-grouping-hint', () => {
    configQuery.data = { confirmed: false } as RenderConfig
    const html = renderPanel({
      recipeId: 'summary.generative',
      workflowMode: 'MANUAL',
      stages: readyStages('PENDING'),
    })

    expect(html).toContain('summary-grouping-hint')
  })
})
