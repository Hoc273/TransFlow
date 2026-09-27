import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ExecutionModeSelector } from './ExecutionModeSelector'
import enMedia from '@/locales/en/media.json'
import type { AvailabilityProjection } from '@/types/transformation'

/**
 * Faithful i18next stand-in backed by the real `en` catalog: a key that exists
 * resolves to its translation, and a key that does not falls back to
 * defaultValue. This lets the tests assert both that the shipped reason map
 * covers the documented codes and that unknown codes degrade to the raw code.
 */
function lookup(key: string): string | undefined {
  const path = key.replace(/^media:/, '').split('.')
  let node: unknown = enMedia
  for (const part of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const hit = lookup(key)
      if (hit !== undefined) return hit
      if (options && 'defaultValue' in options) return String(options.defaultValue)
      return key
    },
  }),
}))

function projection(overrides: Partial<AvailabilityProjection> = {}): AvailabilityProjection {
  return {
    protocolVersion: '1',
    supportedExecutionModes: ['FAST', 'STUDIO'],
    defaultExecutionMode: 'FAST',
    availability: {
      FAST: { available: true, unavailableReason: null },
      STUDIO: { available: false, unavailableReason: 'POLICY_DISABLED' },
    },
    workerCapability: {
      state: 'AVAILABLE',
      workerCount: 1,
      compatibleFastWorkers: 1,
      compatibleStudioWorkers: 0,
    },
    readiness: {
      status: 'AVAILABLE',
      readyExecutionModes: ['FAST'],
      reasons: ['READY'],
      evaluatedAt: '2026-07-31T11:00:00Z',
    },
    ...overrides,
  }
}

describe('ExecutionModeSelector', () => {
  it('renders only the modes the backend projection reports as supported', () => {
    const html = renderToStaticMarkup(
      <ExecutionModeSelector
        projection={projection({
          supportedExecutionModes: ['FAST'],
          availability: { FAST: { available: true, unavailableReason: null } },
        })}
        value="FAST"
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('data-mode="FAST"')
    // STUDIO is absent from supportedExecutionModes, so it must not be offered
    // even though the mode exists in the client type union.
    expect(html).not.toContain('data-mode="STUDIO"')
  })

  it('disables an unavailable mode and shows the backend symbolic reason', () => {
    const html = renderToStaticMarkup(
      <ExecutionModeSelector projection={projection()} value="FAST" onChange={() => undefined} />,
    )

    expect(html).toContain('data-mode="STUDIO"')
    expect(html).toContain('data-available="false"')
    expect(html).toContain('execution-mode-reason-STUDIO')
    expect(html).toContain(enMedia.executionMode.reason.POLICY_DISABLED)
  })

  it('allows available Studio even when FAST is the default', () => {
    const html = renderToStaticMarkup(
      <ExecutionModeSelector
        projection={projection({
          availability: {
            FAST: { available: true, unavailableReason: null },
            STUDIO: { available: true, unavailableReason: null },
          },
        })}
        value="STUDIO"
        onChange={() => undefined}
      />,
    )

    const studio = (html.match(/<button[^>]*data-mode="STUDIO"[^>]*>/) ?? [])[0]
    expect(studio).toContain('data-available="true"')
    expect(studio).toContain('aria-checked="true"')
    expect(studio).toContain('aria-disabled="false"')
    expect(studio).not.toContain(' disabled')
  })

  it('renders an unrecognized backend reason code verbatim', () => {
    const html = renderToStaticMarkup(
      <ExecutionModeSelector
        projection={projection({
          availability: {
            FAST: { available: true, unavailableReason: null },
            STUDIO: { available: false, unavailableReason: 'SOME_FUTURE_BACKEND_CODE' },
          },
        })}
        value="FAST"
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('SOME_FUTURE_BACKEND_CODE')
  })

  it('renders each documented unavailable reason code', () => {
    const codes = [
      'PRODUCT_UNSUPPORTED',
      'POLICY_DISABLED',
      'READINESS_UNKNOWN',
      'WORKER_CAPABILITY_UNKNOWN',
      'WORKER_CAPABILITY_UNAVAILABLE',
      'WORKER_CAPABILITY_MISMATCH',
    ] as const

    for (const code of codes) {
      const html = renderToStaticMarkup(
        <ExecutionModeSelector
          projection={projection({
            availability: {
              FAST: { available: true, unavailableReason: null },
              STUDIO: { available: false, unavailableReason: code },
            },
          })}
          value="FAST"
          onChange={() => undefined}
        />,
      )
      // The shipped catalog must cover every documented code — a raw code
      // leaking here would mean a missing translation, not a fallback.
      expect(html).toContain(enMedia.executionMode.reason[code])
      expect(html).not.toContain(`>${code}<`)
    }
  })

  it('shows a loading state instead of guessing availability before the projection arrives', () => {
    const html = renderToStaticMarkup(
      <ExecutionModeSelector projection={undefined} value={null} loading onChange={() => undefined} />,
    )

    expect(html).toContain('execution-mode-loading')
    expect(html).not.toContain('data-mode=')
  })

  it('offers no mode when the projection cannot be read', () => {
    const html = renderToStaticMarkup(
      <ExecutionModeSelector projection={undefined} value={null} error onChange={() => undefined} />,
    )

    expect(html).toContain('execution-mode-error')
    expect(html).not.toContain('data-mode=')
  })

  it('keeps an unavailable selection explicit without moving it to FAST', () => {
    // The user explicitly picked STUDIO while STUDIO is unavailable. The
    // selector must keep the checked state on STUDIO and must not silently
    // move it onto the available FAST option.
    const html = renderToStaticMarkup(
      <ExecutionModeSelector projection={projection()} value="STUDIO" onChange={() => undefined} />,
    )

    const buttons = html.match(/<button[^>]*>/g) ?? []
    const fast = buttons.find((b) => b.includes('data-mode="FAST"'))
    const studio = buttons.find((b) => b.includes('data-mode="STUDIO"'))

    expect(studio).toContain('aria-checked="true"')
    expect(fast).toContain('aria-checked="false"')
  })
})
