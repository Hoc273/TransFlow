import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}))

const {
  getCreditPackagesApi,
  getCreditTransactionsApi,
  getUserCreditApi,
  purchaseCreditPackageApi,
} = await import('./credit')

beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockResolvedValue({})
})

describe('credit API', () => {
  it('loads the current user balance', async () => {
    await getUserCreditApi()
    expect(apiRequest).toHaveBeenCalledWith('/users/me/credit')
  })

  it('serializes transaction filters and paging', async () => {
    await getCreditTransactionsApi({
      type: 'AI_USAGE',
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-22T00:00:00Z',
      page: 2,
      size: 10,
    })

    expect(apiRequest).toHaveBeenCalledWith(
      '/users/me/credit/transactions?type=AI_USAGE&from=2026-09-01T00%3A00%3A00Z&to=2026-09-22T00%3A00%3A00Z&page=2&size=10',
    )
  })

  it('loads active packages', async () => {
    await getCreditPackagesApi()
    expect(apiRequest).toHaveBeenCalledWith('/credit/packages')
  })

  it('posts the manual payment reference when purchasing', async () => {
    await purchaseCreditPackageApi('package-1', 'BANK-001')

    expect(apiRequest).toHaveBeenCalledWith('/credit/packages/package-1/purchase', {
      method: 'POST',
      body: { paymentReference: 'BANK-001' },
    })
  })
})
