// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }),
}))

const purchaseMutate = vi.fn().mockResolvedValue({ newBalance: 1250 })
const purchaseReset = vi.fn()

vi.mock('@/hooks/useCredit', () => ({
  useUserCredit: () => ({
    data: { balance: 250 },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useCreditTransactions: () => ({
    data: {
      items: [{
        id: 'transaction-1',
        userId: 'user-1',
        amount: -25,
        balanceAfter: 250,
        type: 'AI_USAGE',
        performedByUserId: 'user-1',
        refType: 'MEDIA_JOB',
        refId: 'job-1',
        createdAt: '2026-09-22T00:00:00Z',
      }],
      page: 0,
      size: 10,
      totalElements: 1,
      totalPages: 1,
    },
    error: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useCreditPackages: () => ({
    data: [{
      id: 'package-1',
      name: 'Studio 1K',
      creditAmount: 1000,
      priceAmount: 9.99,
      priceCurrency: 'USD',
      isActive: true,
      createdAt: '2026-09-01T00:00:00Z',
    }],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
  usePurchaseCreditPackage: () => ({
    mutateAsync: purchaseMutate,
    reset: purchaseReset,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const { CreditSection } = await import('./CreditSection')

describe('CreditSection', () => {
  it('shows the balance and ledger rows', () => {
    render(<CreditSection />)

    expect(screen.getAllByText('250')).toHaveLength(2)
    expect(screen.getAllByText('account:credit.types.AI_USAGE')).toHaveLength(2)
    expect(screen.getByText('MEDIA_JOB')).toBeTruthy()
  })

  it('purchases a selected package with its payment reference', async () => {
    render(<CreditSection />)

    fireEvent.click(screen.getByRole('button', { name: 'account:credit.buy' }))
    fireEvent.click(screen.getByRole('button', { name: /Studio 1K/ }))
    fireEvent.change(screen.getByLabelText('account:credit.modal.reference'), {
      target: { value: 'BANK-001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'account:credit.modal.confirm' }))

    await waitFor(() => {
      expect(purchaseMutate).toHaveBeenCalledWith({
        packageId: 'package-1',
        paymentReference: 'BANK-001',
      })
    })
  })
})
