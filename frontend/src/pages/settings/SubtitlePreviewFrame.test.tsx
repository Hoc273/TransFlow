// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SubtitlePreviewFrame, type SubtitlePreviewValues } from './SubtitlePreviewFrame'

afterEach(() => {
  cleanup()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

const values = (partial: Partial<SubtitlePreviewValues>): SubtitlePreviewValues => ({
  subtitlePosition: 'BOTTOM',
  verticalOffsetPercent: 0,
  backgroundBox: true,
  backgroundColor: '#000000',
  backgroundAlpha: 50,
  fontSize: null,
  bold: false,
  maskEnabled: true,
  maskStyle: 'SOLID',
  maskWidth: 85,
  maskHeight: 12,
  maskOpacity: 60,
  maskBlurRadius: 12,
  maskColor: '#000000',
  ...partial,
})

describe('SubtitlePreviewFrame — PRESET-VIZ live preview (docs/97 §19.16)', () => {
  it('anchors the subtitle at the render-contract line for BOTTOM', () => {
    render(<SubtitlePreviewFrame values={values({})} />)

    // BOTTOM base 88 + offset 0 → bottom = 100 - 88 = 12%.
    const subtitle = screen.getByTestId('preset-preview-subtitle')
    expect(subtitle.style.bottom).toBe('12%')
  })

  it('moves the line with position and vertical offset (TOP + offset)', () => {
    render(
      <SubtitlePreviewFrame
        values={values({ subtitlePosition: 'TOP', verticalOffsetPercent: 10 })}
      />,
    )

    // TOP base 8 + 10 → line 18%; text TOP edge at the line (worker Alignment 8).
    const subtitle = screen.getByTestId('preset-preview-subtitle')
    expect(subtitle.style.top).toBe('18%')
    // Mask centers on the line: top = 18 - heightPercent/2 = 18 - 6 = 12%.
    const mask = screen.getByTestId('preset-preview-mask')
    expect(mask.style.top).toBe('12%')
    expect(mask.style.width).toBe('85%')
    expect(mask.style.height).toBe('12%')
  })

  it('renders the SOLID mask with the configured color and opacity', () => {
    render(
      <SubtitlePreviewFrame
        values={values({ maskColor: '#336699', maskOpacity: 40 })}
      />,
    )

    const mask = screen.getByTestId('preset-preview-mask')
    expect(mask.getAttribute('data-style')).toBe('SOLID')
    expect(mask.style.background).toContain('rgba(51, 102, 153, 0.4)')
  })

  it('renders the BLUR mask with a blur and keeps the color tint', () => {
    render(
      <SubtitlePreviewFrame
        values={values({ maskStyle: 'BLUR', maskBlurRadius: 9, maskColor: '#112233' })}
      />,
    )

    const mask = screen.getByTestId('preset-preview-mask')
    expect(mask.getAttribute('data-style')).toBe('BLUR')
    expect(mask.style.backdropFilter).toBe('blur(9px)')
    expect(mask.style.background).toContain('rgba(17, 34, 51, 0.6)')
  })

  it('applies the text background only while backgroundBox is on', () => {
    const { rerender } = render(<SubtitlePreviewFrame values={values({})} />)
    const subtitle = screen.getByTestId('preset-preview-subtitle')
    expect(subtitle.style.background).toContain('rgba(0, 0, 0, 0.5)')

    rerender(<SubtitlePreviewFrame values={values({ backgroundBox: false })} />)
    expect(screen.getByTestId('preset-preview-subtitle').style.background).toBe('')
  })

  it('drops the paddingPercent inset entirely — reserved with no visual effect (F-17)', () => {
    render(<SubtitlePreviewFrame values={values({ maskEnabled: true })} />)
    // The inner span carries no synthesized padding anymore.
    expect(screen.getByTestId('preset-preview-subtitle-text').style.padding).toBe('')
    // The reserved note replaces the visualization while the mask is on…
    expect(screen.getByTestId('preset-preview-padding-note')).toBeTruthy()
    // …and disappears with the mask.
    cleanup()
    render(<SubtitlePreviewFrame values={values({ maskEnabled: false })} />)
    expect(screen.queryByTestId('preset-preview-padding-note')).toBeNull()
  })

  it('keeps the aspect selector local to the frame (preview-only, nothing persists)', () => {
    render(<SubtitlePreviewFrame values={values({})} />)
    const frame = screen.getByTestId('preset-preview-frame')
    expect(frame.getAttribute('data-aspect')).toBe('16:9')
    // CSS `<ratio>` must be a positive finite number (or "N / M") — the
    // "16:9" colon form is invalid CSS and would be dropped by browsers.
    // jsdom does not model the aspect-ratio property, so the numeric ratio is
    // asserted via data-ratio (the style prop uses the same number).
    const ratio = Number(frame.getAttribute('data-ratio'))
    expect(Number.isFinite(ratio)).toBe(true)
    expect(ratio).toBeGreaterThan(0)
    expect(ratio).toBeCloseTo(16 / 9, 10)

    fireEvent.click(screen.getByTestId('preset-preview-aspect-9x16'))
    expect(frame.getAttribute('data-aspect')).toBe('9:16')
    expect(Number(frame.getAttribute('data-ratio'))).toBeCloseTo(9 / 16, 10)
    // No preset config is ever produced by this component — preview-only.
    expect(screen.getByTestId('preset-preview')).toBeTruthy()
  })

  it('every aspect maps to a positive finite CSS ratio', () => {
    render(<SubtitlePreviewFrame values={values({})} />)
    for (const [buttonId, expected] of [
      ['preset-preview-aspect-16x9', 16 / 9],
      ['preset-preview-aspect-9x16', 9 / 16],
      ['preset-preview-aspect-4x3', 4 / 3],
      ['preset-preview-aspect-1x1', 1],
    ] as const) {
      fireEvent.click(screen.getByTestId(buttonId))
      const frame = screen.getByTestId('preset-preview-frame')
      const ratio = Number(frame.getAttribute('data-ratio'))
      expect(Number.isFinite(ratio)).toBe(true)
      expect(ratio).toBeGreaterThan(0)
      expect(ratio).toBeCloseTo(expected, 10)
      // The rendered inline style must carry the numeric ratio (valid CSS),
      // never the colon label.
      expect(frame.getAttribute('style')).toContain(`aspect-ratio: ${ratio}`)
    }
  })
})

describe('SubtitlePreviewFrame — V2 cover layers (docs/97 §19.17 §B)', () => {
  const layer = (over: Partial<NonNullable<SubtitlePreviewValues['layers']>[number]>) => ({
    id: 'cover-1',
    type: 'BLUR' as const,
    enabled: true,
    zIndex: 0,
    anchor: 'SUBTITLE' as const,
    geometry: { widthPercent: 84, heightPercent: 8 },
    style: { blurRadius: 10 },
    ...over,
  })

  it('projects each layer with its own anchor line and geometry', () => {
    render(
      <SubtitlePreviewFrame
        values={values({
          maskEnabled: false,
          layers: [
            layer({}),
            layer({
              id: 'cover-2',
              type: 'SOLID',
              zIndex: 1,
              anchor: 'TOP',
              geometry: { widthPercent: 60, heightPercent: 10 },
              style: { color: '#112233', opacityPercent: 80 },
            }),
          ],
        })}
      />,
    )

    // SUBTITLE anchor with BOTTOM+0 → line 88; top = 88 − 8/2 = 84%.
    const first = screen.getByTestId('preset-preview-layer-cover-1')
    expect(first.style.top).toBe('84%')
    expect(first.style.width).toBe('84%')
    expect(first.getAttribute('data-style')).toBe('BLUR')
    expect(first.style.backdropFilter).toBe('blur(10px)')

    // Fixed TOP anchor ignores the subtitle line entirely → top = 8 − 5 = 3%.
    const second = screen.getByTestId('preset-preview-layer-cover-2')
    expect(second.style.top).toBe('3%')
    expect(second.getAttribute('data-style')).toBe('SOLID')
    expect(second.style.background).toContain('rgba(17, 34, 51, 0.8)')
  })

  it('layers are authoritative — a passed legacy mask stays inert when layers exist', () => {
    render(
      <SubtitlePreviewFrame
        values={values({
          maskEnabled: true,
          layers: [layer({})],
        })}
      />,
    )

    expect(screen.getByTestId('preset-preview-layer-cover-1')).toBeTruthy()
    expect(screen.queryByTestId('preset-preview-mask')).toBeNull()
  })

  it('disabled layers are not rendered', () => {
    render(
      <SubtitlePreviewFrame
        values={values({
          maskEnabled: false,
          layers: [layer({ enabled: false })],
        })}
      />,
    )

    expect(screen.queryByTestId('preset-preview-layer-cover-1')).toBeNull()
  })
})
