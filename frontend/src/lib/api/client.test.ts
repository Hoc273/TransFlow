import { beforeEach, describe, expect, it, vi } from 'vitest'

const setAccessTokenMock = vi.hoisted(() => vi.fn())
const clearAuthMock = vi.hoisted(() => vi.fn())
const authState = vi.hoisted(() => ({ accessToken: 'token' as string | null }))

vi.mock('@/config/featureFlags', () => ({
  apiBaseUrl: 'http://localhost:8080/api',
  featureFlags: {},
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ accessToken: authState.accessToken, setAccessToken: setAccessTokenMock }),
  },
  clearAuthAndRedirect: () => clearAuthMock(),
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
  authState.accessToken = 'token'
  clearAuthMock.mockReset()
  setAccessTokenMock.mockReset()
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


describe('401 refresh via HttpOnly cookie', () => {
  it('refreshes with credentials (no token in body) and retries once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 1000, data: { accessToken: 'new-access' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ code: 1000, data: { ok: true } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const res = await apiRequest('/workspaces')
    expect(res).toEqual({ ok: true })

    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1]
    expect(refreshUrl).toBe('http://localhost:8080/api/auth/refresh')
    expect(refreshInit.credentials).toBe('include')
    expect(refreshInit.body).toBeUndefined()
    expect(setAccessTokenMock).toHaveBeenCalledWith('new-access')
  })

  const unauthorized = { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) }

  it.each([503, 502, 429])('keeps the session when refresh fails transiently (%i)', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(unauthorized)
        .mockResolvedValueOnce({ ok: false, status, json: async () => ({}) }),
    )

    await expect(apiRequest('/workspaces')).rejects.toMatchObject({ code: 'SESSION_REFRESH_UNAVAILABLE' })
    expect(clearAuthMock).not.toHaveBeenCalled()
  })

  it('keeps the session when the refresh request hits a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(unauthorized).mockRejectedValueOnce(new TypeError('Failed to fetch')),
    )

    await expect(apiRequest('/workspaces')).rejects.toMatchObject({ code: 'SESSION_REFRESH_UNAVAILABLE' })
    expect(clearAuthMock).not.toHaveBeenCalled()
  })

  it.each([401, 403])('logs out when the refresh token is rejected (%i)', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(unauthorized)
        .mockResolvedValueOnce({ ok: false, status, json: async () => ({}) }),
    )

    await expect(apiRequest('/workspaces')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
    expect(clearAuthMock).toHaveBeenCalledOnce()
  })

  it('retries with the rotated token without a second refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        // Another request refreshed while this one was in flight.
        authState.accessToken = 'rotated'
        return unauthorized
      })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ code: 1000, data: 1 }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/workspaces')).resolves.toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer rotated')
  })
})

describe('upload progress transport', () => {
  class FakeXhr {
    static last: FakeXhr
    upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null }
    status = 0
    statusText = ''
    response: Blob | null = null
    withCredentials = false
    responseType = ''
    headers: Record<string, string> = {}
    method = ''
    url = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    ontimeout: (() => void) | null = null
    onabort: (() => void) | null = null
    constructor() { FakeXhr.last = this }
    open(method: string, url: string) { this.method = method; this.url = url }
    setRequestHeader(name: string, value: string) { this.headers[name] = value }
    getAllResponseHeaders() { return 'content-type: application/json\r\n' }
    abort() { this.onabort?.() }
    send() {
      this.upload.onprogress?.({ loaded: 2 })
      this.upload.onprogress?.({ loaded: 4 })
      this.status = 200
      this.statusText = 'OK'
      this.response = new Blob([JSON.stringify({ code: 1000, data: { receivedChunks: 1 } })])
      this.onload?.()
    }
  }

  it('reports sent bytes through XHR and still unwraps the envelope with auth', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const progress: number[] = []

    const res = await apiRequest('/chunks/0', {
      method: 'PUT',
      body: new Blob(['abcd']),
      rawBody: true,
      onUploadProgress: (loaded) => progress.push(loaded),
    })

    expect(res).toEqual({ receivedChunks: 1 })
    expect(progress).toEqual([2, 4])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(FakeXhr.last.method).toBe('PUT')
    expect(FakeXhr.last.withCredentials).toBe(true)
    expect(FakeXhr.last.headers.Authorization).toBe('Bearer token')
  })

  it('rejects like fetch on network loss', async () => {
    class OfflineXhr extends FakeXhr {
      send() { this.onerror?.() }
    }
    vi.stubGlobal('XMLHttpRequest', OfflineXhr)

    await expect(
      apiRequest('/chunks/0', { method: 'PUT', body: 'x', rawBody: true, onUploadProgress: () => {} }),
    ).rejects.toBeInstanceOf(TypeError)
  })
})
