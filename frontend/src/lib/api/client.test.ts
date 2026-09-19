import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config/featureFlags', () => ({
  apiBaseUrl: 'http://localhost:8080/api',
  featureFlags: {},
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ accessToken: 'token', refreshToken: null }) },
  clearAuthAndRedirect: () => undefined,
}))

const { apiRequest } = await import('./client')

function mockErrorResponse(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Error',
      json: async () => body,
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('parseError error codes', () => {
  // The Spring `ApiError` shape carries its machine-readable code in `code`,
  // not `errorCode`. Reading only `errorCode` collapsed every B1.2 subtitle
  // style failure into a generic NOT_FOUND / HTTP_400.
  it.each([
    [404, 'STYLE_NOT_FOUND'],
    [404, 'STYLE_NOT_ACTIVE'],
    [400, 'INVALID_STYLE_KEY'],
  ])('surfaces the ApiError `code` field (%i %s)', async (status, code) => {
    mockErrorResponse(status, { status, code, message: 'boom' })

    await expect(apiRequest('/media/subtitle-styles/x')).rejects.toMatchObject({
      status,
      code,
      errorCode: code,
    })
  })

  it('still prefers the ProviderErrorResponse `errorCode` when both are present', async () => {
    mockErrorResponse(400, { errorCode: 'PROVIDER_ERROR', code: 'LEGACY', message: 'boom' })

    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('falls back to the status heuristic when the body carries no code', async () => {
    mockErrorResponse(404, { status: 404, message: 'missing' })

    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('surfaces numeric error codes as strings and extracts validation data', async () => {
    mockErrorResponse(400, {
      code: 9998,
      message: 'Validation failed',
      data: { targetLang: 'must not be blank' },
    })

    await expect(apiRequest('/x')).rejects.toMatchObject({
      status: 400,
      code: '9998',
      fieldErrors: { targetLang: 'must not be blank' },
    })
  })
})

describe('apiRequest ApiResponse unwrapping', () => {
  it('unwraps ApiResponse { code: 1000, data: ... }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 1000, data: { id: 'ws-1', name: 'Test' } }),
      }),
    )

    const res = await apiRequest('/workspaces/ws-1')
    expect(res).toEqual({ id: 'ws-1', name: 'Test' })
  })

  it('keeps raw object if not wrapped in ApiResponse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'ws-1', name: 'Test' }),
      }),
    )

    const res = await apiRequest('/workspaces/ws-1')
    expect(res).toEqual({ id: 'ws-1', name: 'Test' })
  })
})

