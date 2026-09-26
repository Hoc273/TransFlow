// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PlatformPricingPage } from './PlatformPricingPage'
import { ApiError } from '@/types/api'
import type { PricingCoverageItem, PricingVersion } from '@/types/platform'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'vi' },
  }),
}))

const versions: PricingVersion[] = [
  {
    id: 'v-default',
    capability: 'TTS',
    providerScope: null,
    infraCoefficientX: 0.000027,
    tokenCoefficientY: 0.0117,
    effectiveFrom: '2026-09-01T00:00:00Z',
    effectiveTo: null,
    status: 'ACTIVE',
    createdByUserId: 'admin',
    changeReason: 'seed',
    createdAt: '2026-09-01T00:00:00Z',
  },
]

const coverage: PricingCoverageItem[] = [
  {
    providerId: 'p1',
    providerName: 'OpenAI pool',
    capability: 'TTS',
    pricingScope: 'openai_compatible/tts-1',
    matchedBy: 'DEFAULT',
    matchedVersionId: 'v-default',
    matchedScope: null,
    infraCoefficientX: 0.000027,
    tokenCoefficientY: 0.0117,
  },
]

const createMutate = vi.fn()

vi.mock('@/hooks/usePlatform', () => ({
  usePlatformPricing: () => ({ data: versions, isLoading: false, isError: false, refetch: vi.fn() }),
  usePlatformPricingCoverage: () => ({ data: coverage, refetch: vi.fn() }),
  usePlatformPricingHistory: () => ({ data: [], isLoading: false }),
  useCreatePlatformPricing: () => ({ mutateAsync: createMutate, isPending: false }),
  usePreviewPlatformPricing: () => ({ mutateAsync: vi.fn().mockReturnValue(new Promise(() => {})) }),
}))

function renderPage() {
  render(
    <MemoryRouter>
      <PlatformPricingPage />
    </MemoryRouter>,
  )
}

describe('PlatformPricingPage', () => {
  it('shows active prices with per-minute Credit and coverage gaps', () => {
    renderPage()

    expect(screen.getAllByText('0.000027').length).toBeGreaterThan(0)
    expect(screen.getByText('0.011700')).toBeTruthy()
    // TTS: (0.000027 + 0.0117) × 1000 characters/minute
    expect(screen.getByText((11.727).toLocaleString(undefined, { maximumFractionDigits: 4 }))).toBeTruthy()
    expect(screen.getByText('OpenAI pool')).toBeTruthy()
    expect(screen.getByText('pricing.coverage.DEFAULT')).toBeTruthy()
  })

  it('asks for confirmation when the server flags a large change', async () => {
    createMutate.mockRejectedValueOnce(
      new ApiError({ status: 409, errorCode: '2306', code: '2306', message: 'large', retryable: false }),
    )
    renderPage()

    fireEvent.click(screen.getByTitle('pricing.change'))
    fireEvent.change(screen.getByPlaceholderText('0.005850'), { target: { value: '0.030000' } })
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'OpenAI raised TTS price' } })
    fireEvent.click(screen.getByRole('button', { name: 'pricing.form.submit' }))

    await waitFor(() => expect(screen.getByText('pricing.form.confirmLargeChange')).toBeTruthy())
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'TTS',
        providerScope: null,
        infraCoefficientX: 0.000027,
        tokenCoefficientY: 0.03,
        changeReason: 'OpenAI raised TTS price',
      }),
    )

    createMutate.mockResolvedValueOnce({ version: versions[0], closedVersion: null, warnings: [] })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'pricing.form.submit' }))

    await waitFor(() =>
      expect(createMutate).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLargeChange: true })),
    )
  })
})
