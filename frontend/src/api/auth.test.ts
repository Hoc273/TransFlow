import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/lib/api/client'
import type { AuthResponse } from '@/types/auth'

vi.mock('@/lib/api/client', () => ({
  apiRequest: vi.fn(),
}))

import { googleExchangeApi } from './auth'

const authResponse: AuthResponse = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: {
    id: 'user-id',
    email: 'user@example.com',
    fullName: 'Example User',
  },
}

describe('googleExchangeApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shares an in-flight request for the same one-time exchange code', async () => {
    let resolveRequest!: (value: AuthResponse) => void
    const pending = new Promise<AuthResponse>((resolve) => {
      resolveRequest = resolve
    })
    vi.mocked(apiRequest).mockReturnValue(pending)

    const first = googleExchangeApi('one-time-code')
    const second = googleExchangeApi('one-time-code')

    expect(second).toBe(first)
    expect(apiRequest).toHaveBeenCalledTimes(1)

    resolveRequest(authResponse)
    await expect(first).resolves.toEqual(authResponse)
  })

  it('allows retrying after the previous exchange request fails', async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce(authResponse)

    await expect(googleExchangeApi('retry-code')).rejects.toThrow('network failure')
    await expect(googleExchangeApi('retry-code')).resolves.toEqual(authResponse)
    expect(apiRequest).toHaveBeenCalledTimes(2)
  })
})
