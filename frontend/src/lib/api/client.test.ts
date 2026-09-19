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

  it('unwraps ApiResponse { code: 1000, data: ... } on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 1000, data: { id: 'ws_123', name: 'My Workspace' } }),
      }),
    )

    const result = await apiRequest<{ id: string; name: string }>('/workspaces/ws_123')
    expect(result).toEqual({ id: 'ws_123', name: 'My Workspace' })
  })

  it('extracts fieldErrors from code 9998 validation errors', async () => {
    mockErrorResponse(400, {
      code: 9998,
      data: { targetLang: 'must not be blank', email: 'invalid email' },
    })

    await expect(apiRequest('/test')).rejects.toMatchObject({
      status: 400,
      code: 9998,
      fieldErrors: { targetLang: 'must not be blank', email: 'invalid email' },
    })
  })
})
