import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}))

const {
  getPlatformOverviewApi,
  getPlatformStatusApi,
  getPlatformUsersApi,
} = await import('./platform')

beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockResolvedValue({ items: [] })
})

describe('platform api', () => {
  it('users build đúng query', async () => {
    await getPlatformUsersApi({ q: 'a@b.c', page: 0, size: 20 })
    expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('/platform/users'))
    expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('q=a%40b.c'))
  })

  it('overview truyền from/to/topLimit', async () => {
    apiRequest.mockResolvedValueOnce({ users: { total: 1 } })
    await getPlatformOverviewApi({ topLimit: 5 })
    expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('/platform/overview'))
    expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('topLimit=5'))
  })

  it('status gọi đúng path', async () => {
    apiRequest.mockResolvedValueOnce({ overall: 'UP' })
    await getPlatformStatusApi()
    expect(apiRequest).toHaveBeenCalledWith('/platform/status')
  })
})
