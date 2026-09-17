// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Phase 6 V2 (docs/97 §19.17) — editor UI contract tests:
 * ownership chip + dead-control mirroring, outline ⊗ box XOR, Mask/Layer v1
 * style XOR, EFFECTIVE-only preview sample, tri-state PUT and mode-flip UX.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const currentStyle = { data: null as unknown }
const configQuery = { data: null as unknown }
const updateConfig = { isPending: false, mutateAsync: vi.fn() }
const confirmRender = { isPending: false, mutateAsync: vi.fn() }

vi.mock('@/hooks/useMedia', () => ({
  useRenderConfig: () => configQuery,
  useUpdateRenderConfig: () => updateConfig,
  useConfirmRender: () => confirmRender,
  useRerunRender: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSelectVoice: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/useProviders', () => ({
  useVoicePreview: () => ({ isPending: false, variables: undefined, mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/useSubtitleStyle', () => ({
  useJobSubtitleStyle: () => currentStyle,
  deriveStyleAssignment: (current: unknown) => {
    const snapshot = (current ?? null) as Record<string, unknown> | null
    return {
      styleAssigned: !!snapshot,
      snapshot,
      styledBoxMode: !!snapshot && !!snapshot.background,
    }
  },
}))

const { RenderPreparationPanel } = await import('./RenderPreparationPanel')
import type { MediaJob, RenderConfig } from '@/types/media'
import type { ProviderConfig } from '@/types/provider'

function job(): MediaJob {
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
    voiceId: 'legacy-voice-id',
    ttsProviderId: 'p1',
    ttsVoiceId: 'v1',
    recipeId: 'summary.generative',
    createdAt: '2026-08-24T00:00:00Z',
    stages: [
      { id: 's1', stageName: 'TRANSLATE', stageOrder: 5, status: 'COMPLETED', progressPercent: 100, startedAt: null, completedAt: null },
      { id: 's2', stageName: 'TTS', stageOrder: 6, status: 'PENDING', progressPercent: 0, startedAt: null, completedAt: null },
    ],
  } as never
}

const providerStub = { id: 'p1' } as ProviderConfig

function configData(over: Partial<RenderConfig> = {}): RenderConfig {
  return {
    subtitleMode: 'HARD_SUB',
    subtitlePosition: 'BOTTOM',
    verticalOffsetPercent: 0,
    backgroundBox: true,
    confirmed: false,
    sourceVideoUrl: '',
    sourceVideoUrlExpiresInSeconds: 60,
    presentation: {
      subtitle: {
        schemaVersion: 1,
        displayMode: 'SENTENCE',
        typography: { fontSize: 40, bold: true },
        mask: null,
      },
      audio: { schemaVersion: 1 },
    },
    backgroundColor: '#11223380',
    textColor: '#abcdef',
    effective: { boxMode: false, ownedByStyle: false, resolvedLinePercent: 88, deadControls: [] },
    ...over,
  } as RenderConfig
}

const SNAPSHOT = {
  font_family: 'Arial',
  font_size: 52,
  primary_color: '#FFFFFF',
  outline_color: '#000000',
  outline_width: 4,
  shadow: true,
  bold: true,
  italic: false,
  alignment: 'center',
  margin_v: 24,
  line_spacing: 0,
  background: '#000000CC',
  opacity: 100,
}

async function renderPanel(configOver: Partial<RenderConfig> = {}) {
  configQuery.data = configData(configOver)
  const utils = render(
    <RenderPreparationPanel
      workspaceId="ws"
      job={job()}
      provider={providerStub}
      voices={[]}
      canEdit
      hideVoiceGrid
    />,
  )
  // The hydration effect runs after mount; flush it before asserting.
  await waitFor(() =>
    expect((utils.container.querySelector('select') as HTMLSelectElement)?.value).toBe('HARD_SUB'),
  )
  return utils
}

beforeEach(() => {
  vi.clearAllMocks()
  currentStyle.data = null
  updateConfig.mutateAsync.mockReset().mockResolvedValue(undefined)
  confirmRender.mutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => cleanup())

describe('Phase 6 — ownership chip + dead controls (Task 1)', () => {
  it('styled job: chip + readout visible, appearance controls disabled, outline hidden', async () => {
    currentStyle.data = SNAPSHOT
    const { container } = await renderPanel({
      effective: {
        boxMode: true,
        ownedByStyle: true,
        resolvedLinePercent: 88,
        deadControls: ['backgroundColor', 'textColor', 'backgroundBox', 'subtitlePosition', 'verticalOffsetPercent'],
      },
    })

    expect(screen.getByTestId('style-ownership-chip')).toBeTruthy()
    const readout = screen.getByTestId('style-ownership-readout')
    expect(readout.textContent).toContain('font_family')

    const disabled = (testid: string) =>
      (container.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement).disabled
    expect(disabled('render-prep-background-color')).toBe(true)
    expect(disabled('render-prep-background-alpha')).toBe(true)
    expect(disabled('render-prep-text-color')).toBe(true)
    // Outline controls are not rendered at all for owned jobs.
    expect(container.querySelector('[data-testid="outline-controls"]')).toBeNull()

    const positionSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    expect(positionSelect.disabled).toBe(true)
    const offsetRange = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(offsetRange.disabled).toBe(true)
    const boxToggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(boxToggle.disabled).toBe(true)
  })

  it('unstyled job: no chip, appearance controls stay editable', async () => {
    const { container } = await renderPanel()

    expect(screen.queryByTestId('style-ownership-chip')).toBeNull()
    const enabled = (selector: string) =>
      !(container.querySelector(selector) as HTMLInputElement).disabled
    expect(enabled('[data-testid="render-prep-text-color"]')).toBe(true)
    const offsetRange = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(offsetRange.disabled).toBe(false)
  })
})

describe('Phase 6 — outline XOR with the effective box (Task 3)', () => {
  it('ring mode: outline editable without warning', async () => {
    const { container } = await renderPanel({
      backgroundBox: false,
      effective: { boxMode: false, ownedByStyle: false, resolvedLinePercent: 88, deadControls: [] },
    })

    const width = container.querySelector('[data-testid="render-prep-outline-width"]') as HTMLInputElement
    expect(width.disabled).toBe(false)
    expect(container.querySelector('[data-testid="outline-box-warning"]')).toBeNull()
  })

  it('box mode: outline disabled with the ignored-warning surfaced', async () => {
    const { container } = await renderPanel({
      backgroundBox: true,
      effective: { boxMode: true, ownedByStyle: false, resolvedLinePercent: 88, deadControls: ['outlineWidth', 'outlineColor'] },
    })

    const width = container.querySelector('[data-testid="render-prep-outline-width"]') as HTMLInputElement
    expect(width.disabled).toBe(true)
    const color = container.querySelector('[data-testid="render-prep-outline-color"]') as HTMLInputElement
    expect(color.disabled).toBe(true)
    expect(screen.getByTestId('outline-box-warning').textContent).toContain('renderPrep.outlineBoxWarning')
  })
})

describe('Phase 6 — Cover layers editor (V2 §B exposure, user decision 2026-09-06)', () => {
  it('enabling cover renders one editable layer anchored to the subtitle line', async () => {
    const { container } = await renderPanel()
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))

    const card = screen.getByTestId('mask-layer-0')
    expect(card).toBeTruthy()
    const anchor = container.querySelector(
      '[data-testid="mask-layer-0-anchor"]',
    ) as HTMLSelectElement
    expect(anchor.value).toBe('SUBTITLE')
    // Anchors are per-layer and editable now — the old fixed SUBTITLE-only
    // select is gone.
    expect(anchor.disabled).toBe(false)
    expect((container.querySelector('[data-testid="mask-layer-0-style"]') as HTMLSelectElement).value).toBe('BLUR')
  })

  it('per-layer style XOR: BLUR renders radius only; SOLID renders color+opacity', async () => {
    const { container } = await renderPanel()
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))

    expect(container.querySelector('[data-testid="mask-layer-0-blur-radius"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="mask-layer-0-color"]')).toBeNull()

    fireEvent.change(screen.getByTestId('mask-layer-0-style'), { target: { value: 'SOLID' } })
    expect(screen.getByTestId('mask-layer-0-color')).toBeTruthy()
    expect(screen.getByTestId('mask-layer-0-opacity')).toBeTruthy()
    expect(container.querySelector('[data-testid="mask-layer-0-blur-radius"]')).toBeNull()
  })

  it('caps at 4 layers (wire contract) — add disables, remove re-opens the slot', async () => {
    await renderPanel()
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))

    for (let i = 1; i < 4; i += 1) {
      fireEvent.click(screen.getByTestId('mask-layer-add'))
      expect(screen.getByTestId(`mask-layer-${i}`)).toBeTruthy()
    }
    const add = screen.getByTestId('mask-layer-add') as HTMLButtonElement
    expect(add.disabled).toBe(true)

    fireEvent.click(screen.getByTestId('mask-layer-3-remove'))
    expect(screen.queryByTestId('mask-layer-3')).toBeNull()
    expect((screen.getByTestId('mask-layer-add') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a stored legacy v1 mask hydrates into the equivalent editable layer', async () => {
    await renderPanel({
      presentation: {
        subtitle: {
          schemaVersion: 1,
          displayMode: 'SENTENCE',
          typography: { fontSize: 40, bold: true },
          mask: {
            enabled: true,
            anchor: 'SUBTITLE',
            widthPercent: 80,
            heightPercent: 10,
            opacityPercent: 70,
            paddingPercent: 3,
            style: 'BLUR',
            blurRadius: 9,
            color: '#336699',
          },
        },
        audio: { schemaVersion: 1 },
      },
    })

    // Enabled straight from the stored mask — same values as a BLUR layer.
    const enable = screen.getByTestId('mask-enable') as HTMLInputElement
    expect(enable.checked).toBe(true)
    expect(
      (screen.queryByText('media:renderPrep.coverHint') as HTMLElement | null),
    ).toBeTruthy()
    expect((screen.getByTestId('mask-layer-0-anchor') as HTMLSelectElement).value).toBe('SUBTITLE')
    expect((screen.getByTestId('mask-layer-0-blur-radius') as HTMLInputElement).value).toBe('9')
    expect((screen.getByTestId('mask-layer-0-width') as HTMLInputElement).value).toBe('80')
  })

  it('OUTPUT-ASPECT: selector drafts the frame and the PUT carries it', async () => {
    const { container } = await renderPanel()
    const group = container.querySelector('[data-testid="render-prep-aspect"]')
    expect(group).toBeTruthy()
    // ORIGINAL selected by default; switching drafts 9:16…
    expect(
      (container.querySelector('[data-testid="render-prep-aspect-ORIGINAL"]') as HTMLButtonElement)
        .getAttribute('aria-pressed'),
    ).toBe('true')
    fireEvent.click(screen.getByTestId('render-prep-aspect-9x16'))
    fireEvent.click(screen.getByTestId('render-prep-confirm'))

    await waitFor(() => expect(updateConfig.mutateAsync).toHaveBeenCalledTimes(1))
    const body = updateConfig.mutateAsync.mock.calls[0][0] as Record<string, unknown>
    expect(body.outputAspectRatio).toBe('9:16')
  })

  it('confirm PUT carries the wire layers and an explicit null mask', async () => {
    await renderPanel()
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))
    fireEvent.change(screen.getByTestId('mask-layer-0-anchor'), { target: { value: 'CENTER' } })
    fireEvent.click(screen.getByTestId('render-prep-confirm'))

    await waitFor(() => expect(updateConfig.mutateAsync).toHaveBeenCalledTimes(1))
    const body = updateConfig.mutateAsync.mock.calls[0][0] as Record<string, unknown>
    const presentation = body.presentation as { subtitle: Record<string, unknown> }
    const layers = presentation.subtitle.layers as Array<Record<string, unknown>>
    expect(layers).toHaveLength(1)
    expect(layers[0].anchor).toBe('CENTER')
    expect(layers[0].enabled).toBe(true)
    expect(layers[0].zIndex).toBe(0)
    expect(presentation.subtitle.mask).toBeNull()
  })
})

describe('Preview sample — styled effective vs live draft (§1.8.2 redesign)', () => {
  it('styled job: text locks to the backend projection, bottom 12%', async () => {
    currentStyle.data = SNAPSHOT
    const { container } = await renderPanel({
      effective: {
        boxMode: true,
        ownedByStyle: true,
        resolvedLinePercent: 88,
        deadControls: [],
      },
    })

    const sample = container.querySelector('[data-testid="render-prep-draft-sample"]') as HTMLElement
    // F-07: styled → locked BOTTOM at 100−88 = 12%, regardless of stored position.
    expect(sample.style.bottom).toBe('12%')
    expect(sample.style.fontSize).toBe(`${(52 / 1080) * 100}cqh`)
    expect(sample.style.fontWeight).toBe('700')
  })

  it('non-styled job: the live draft mirrors the stored line until edited', async () => {
    const { container } = await renderPanel({
      subtitlePosition: 'CENTER',
      verticalOffsetPercent: 10,
      textColor: '#ABCDEF',
      effective: {
        boxMode: false,
        ownedByStyle: false,
        resolvedLinePercent: 60,
        deadControls: [],
      },
    })

    const sample = container.querySelector('[data-testid="render-prep-draft-sample"]') as HTMLElement
    expect(sample.style.top).toBe('60%')
    expect(sample.style.color).toContain('171, 205, 239')
  })
})

describe('Phase 6 — tri-state PUT + mode-flip UX (Task 5)', () => {
  it('box off → backgroundColor key dropped, textColor REPLACE uppercased', async () => {
    await renderPanel({ backgroundBox: false })
    fireEvent.click(screen.getByTestId('render-prep-confirm'))

    await waitFor(() => expect(updateConfig.mutateAsync).toHaveBeenCalledTimes(1))
    const body = updateConfig.mutateAsync.mock.calls[0][0] as Record<string, unknown>
    expect(body.backgroundColor).toBeUndefined()
    expect(body.textColor).toBe('#ABCDEF')
  })

  it('HARD→SOFT flip clears both colors in the same PUT and drops burn-only fields', async () => {
    const { container } = await renderPanel({ backgroundBox: true })
    const modeSelect = container.querySelectorAll('select')[0] as HTMLSelectElement
    fireEvent.change(modeSelect, { target: { value: 'SOFT_SUB' } })
    fireEvent.click(screen.getByTestId('render-prep-confirm'))

    await waitFor(() => expect(updateConfig.mutateAsync).toHaveBeenCalledTimes(1))
    const body = updateConfig.mutateAsync.mock.calls[0][0] as Record<string, unknown>
    expect(body.subtitleMode).toBe('SOFT_SUB')
    // Explicit-null sentinels — backend PRESENTATION_HARD_SUB_ONLY survival guard passes.
    expect(body.backgroundColor).toBeNull()
    expect(body.textColor).toBeNull()
    const presentation = body.presentation as { subtitle: Record<string, unknown> }
    // The builder emits explicit nulls — full-replacement clears the stored
    // burn-only fields in the same PUT (layers XOR mask, both cleared).
    expect(presentation.subtitle.typography).toBeNull()
    expect(presentation.subtitle.mask).toBeNull()
    expect(presentation.subtitle.layers).toBeNull()
  })

  it('HARD_SUB keep sends the typography patch merged over stored values', async () => {
    await renderPanel({})
    fireEvent.click(screen.getByTestId('render-prep-confirm'))

    await waitFor(() => expect(updateConfig.mutateAsync).toHaveBeenCalledTimes(1))
    const body = updateConfig.mutateAsync.mock.calls[0][0] as Record<string, unknown>
    expect(body.backgroundColor).toBe('#11223380')
    expect(body.textColor).toBe('#ABCDEF')
    const presentation = body.presentation as { subtitle: Record<string, unknown> }
    expect(presentation.subtitle.typography).toEqual({
      fontSize: 40,
      bold: true,
      outlineWidth: null,
      outlineColor: null,
    })
  })
})
