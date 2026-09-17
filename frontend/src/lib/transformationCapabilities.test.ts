import { describe, expect, it, vi } from 'vitest'
import {
  guardCreateWithFreshCapabilities,
  isModeAvailable,
  modeBlock,
  reasonI18nKey,
  selectableModes,
} from './transformationCapabilities'
import type { AvailabilityProjection } from '@/types/transformation'

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

describe('selectableModes', () => {
  it('returns exactly the backend-supported modes, default first', () => {
    expect(selectableModes(projection())).toEqual(['FAST', 'STUDIO'])
    expect(
      selectableModes(projection({ supportedExecutionModes: ['FAST', 'STUDIO'], defaultExecutionMode: 'STUDIO' })),
    ).toEqual(['STUDIO', 'FAST'])
  })

  it('offers nothing when the projection is missing', () => {
    expect(selectableModes(undefined)).toEqual([])
  })

  it('never invents a mode absent from supportedExecutionModes', () => {
    const modes = selectableModes(projection({ supportedExecutionModes: ['FAST'] }))
    expect(modes).toEqual(['FAST'])
  })
})

describe('isModeAvailable', () => {
  it('reads availability strictly from the projection', () => {
    expect(isModeAvailable(projection(), 'FAST')).toBe(true)
    expect(isModeAvailable(projection(), 'STUDIO')).toBe(false)
  })

  it('fails closed when the projection is missing or the mode is absent', () => {
    expect(isModeAvailable(undefined, 'FAST')).toBe(false)
    expect(isModeAvailable(projection({ availability: {} }), 'FAST')).toBe(false)
  })
})

describe('modeBlock — no silent downgrade', () => {
  it('blocks an explicitly selected unavailable mode and surfaces its reason', () => {
    const block = modeBlock(projection(), 'STUDIO')
    expect(block).toEqual({ kind: 'unavailable', reason: 'POLICY_DISABLED' })
    // Crucially it does NOT return { kind: 'ok' } with a substituted FAST.
    expect(block.kind).not.toBe('ok')
  })

  it('allows the deployment default when it is available', () => {
    expect(modeBlock(projection(), 'FAST')).toEqual({ kind: 'ok' })
  })

  it('allows an available non-default mode to be submitted explicitly', () => {
    const p = projection({
      availability: {
        FAST: { available: true, unavailableReason: null },
        STUDIO: { available: true, unavailableReason: null },
      },
    })
    expect(modeBlock(p, 'STUDIO')).toEqual({ kind: 'ok' })
  })

  it('reports loading rather than a permissive default before the projection arrives', () => {
    expect(modeBlock(undefined, 'FAST')).toEqual({ kind: 'loading' })
    expect(modeBlock(projection(), null)).toEqual({ kind: 'loading' })
  })

  it('fails closed with READINESS_UNKNOWN when a mode is missing from availability', () => {
    expect(modeBlock(projection({ availability: {} }), 'FAST')).toEqual({
      kind: 'unavailable',
      reason: 'READINESS_UNKNOWN',
    })
  })
})

describe('reasonI18nKey', () => {
  it('namespaces backend codes without rewriting them', () => {
    expect(reasonI18nKey('POLICY_DISABLED')).toBe('media:executionMode.reason.POLICY_DISABLED')
    expect(reasonI18nKey('BRAND_NEW_CODE')).toBe('media:executionMode.reason.BRAND_NEW_CODE')
  })
})

describe('guardCreateWithFreshCapabilities', () => {
  it('refreshes before deciding and passes the user mode through unchanged', async () => {
    const refresh = vi.fn().mockResolvedValue(projection())

    const guard = await guardCreateWithFreshCapabilities(refresh, 'FAST')

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(guard).toEqual({ ok: true, requestedMode: 'FAST' })
  })

  it('uses the fresh projection, not a stale snapshot, when availability changed', async () => {
    // Stale snapshot said STUDIO was fine; the fresh fetch says it is not.
    const refresh = vi.fn().mockResolvedValue(
      projection({
        availability: {
          FAST: { available: true, unavailableReason: null },
          STUDIO: { available: false, unavailableReason: 'WORKER_CAPABILITY_MISMATCH' },
        },
      }),
    )

    const guard = await guardCreateWithFreshCapabilities(refresh, 'STUDIO')

    expect(guard).toEqual({
      ok: false,
      block: { kind: 'unavailable', reason: 'WORKER_CAPABILITY_MISMATCH' },
    })
    // No downgrade: the guard never reports ok with a substituted FAST.
    expect(guard.ok).toBe(false)
  })

  it('blocks rather than creating when the refresh fails', async () => {
    const guard = await guardCreateWithFreshCapabilities(
      vi.fn().mockRejectedValue(new Error('network')),
      'FAST',
    )

    expect(guard).toEqual({ ok: false, block: { kind: 'loading' } })
  })

  it('blocks when the refresh resolves without a projection', async () => {
    const guard = await guardCreateWithFreshCapabilities(
      vi.fn().mockResolvedValue(undefined),
      'FAST',
    )

    expect(guard).toEqual({ ok: false, block: { kind: 'loading' } })
  })

  it('falls back to the fresh deployment default only when the user never chose', async () => {
    const guard = await guardCreateWithFreshCapabilities(
      vi.fn().mockResolvedValue(projection()),
      null,
    )

    expect(guard).toEqual({ ok: true, requestedMode: 'FAST' })
  })

  it('passes through an available non-default explicit selection', async () => {
    const guard = await guardCreateWithFreshCapabilities(
      vi.fn().mockResolvedValue(
        projection({
          availability: {
            FAST: { available: true, unavailableReason: null },
            STUDIO: { available: true, unavailableReason: null },
          },
        }),
      ),
      'STUDIO',
    )

    expect(guard).toEqual({ ok: true, requestedMode: 'STUDIO' })
  })
})
