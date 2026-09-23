import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  buildWorkspacePath: (workspaceId: string, suffix = '') =>
    `/workspaces/${workspaceId}${suffix.startsWith('/') ? suffix : suffix ? `/${suffix}` : ''}`,
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ accessToken: 'token' }) },
  clearAuthAndRedirect: () => undefined,
}))
vi.mock('@/config/featureFlags', () => ({
  apiBaseUrl: 'http://localhost:8080/api',
  featureFlags: {},
}))

const {
  batchEditTransformationSegmentsApi,
  consentTransformationAssetApi,
  createTransformationJobApi,
  getTransformationCapabilitiesApi,
  rerunTransformationRenderApi,
} = await import('./transformation')

beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockResolvedValue({})
})

describe('getTransformationCapabilitiesApi', () => {
  it('reads the deployment-wide availability endpoint, not a workspace-scoped one', async () => {
    await getTransformationCapabilitiesApi()

    expect(apiRequest).toHaveBeenCalledWith('/transformation/capabilities')
    const [path, options] = apiRequest.mock.calls[0]
    expect(path).not.toContain('/workspaces/')
    // Read-only: no method override means GET, and no body is ever sent.
    expect(options?.method).toBeUndefined()
    expect(options?.body).toBeUndefined()
  })

  it('issues a fresh request on every call so callers can revalidate before create', async () => {
    await getTransformationCapabilitiesApi()
    await getTransformationCapabilitiesApi()

    expect(apiRequest).toHaveBeenCalledTimes(2)
  })
})

describe('createTransformationJobApi', () => {
  it('sends the user requestedMode and never an effectiveMode', async () => {
    await createTransformationJobApi('ws-1', {
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
      subtitleMode: 'SOFT_SUB',
      requestedMode: 'STUDIO',
    })

    const [, options] = apiRequest.mock.calls[0]
    const body = options.body as Record<string, unknown>
    expect(body.requestedMode).toBe('STUDIO')
    expect(body).not.toHaveProperty('effectiveMode')
    expect(body).not.toHaveProperty('executionMode')
    expect(body).not.toHaveProperty('resolvedMode')
  })

  it('does not fabricate a mode when the caller supplies none', async () => {
    await createTransformationJobApi('ws-1', {
      documentId: 'doc-1',
      recipeId: 'localization.full',
      targetLang: 'vi',
    })

    const [, options] = apiRequest.mock.calls[0]
    const body = options.body as Record<string, unknown>
    expect(body.requestedMode).toBeUndefined()
    expect(body).not.toHaveProperty('effectiveMode')
  })
})

describe('rerunTransformationRenderApi', () => {
  it('POSTs the visual update to /rerun-render and returns the updated job', async () => {
    apiRequest.mockResolvedValue({ id: 'job-1', status: 'PROCESSING' })
    const body = { outputAspectRatio: '9:16' } as unknown as import('@/types/media').UpdateRenderConfigBody
    const res = await rerunTransformationRenderApi('ws-1', 'job-1', body)
    expect(apiRequest).toHaveBeenCalledWith(
      '/workspaces/ws-1/media/jobs/job-1/rerun-render',
      { method: 'POST', body },
    )
    expect(res).toEqual({ id: 'job-1', status: 'PROCESSING' })
  })
  it('sends no body key when called without visual changes', async () => {
    await rerunTransformationRenderApi('ws-1', 'job-1')
    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe('/workspaces/ws-1/media/jobs/job-1/rerun-render')
    expect(options.method).toBe('POST')
    expect(options.body).toBeUndefined()
  })
})

describe('batchEditTransformationSegmentsApi', () => {
  it('unwraps batch-edit response as a plain segment array', async () => {
    apiRequest.mockResolvedValue([{ id: 'seg-1', seq: 1 }])
    const res = await batchEditTransformationSegmentsApi('ws-1', 'job-1', {
      updates: [{ segmentId: 'seg-1', targetText: 'Chào' }],
    })
    expect(apiRequest).toHaveBeenCalledWith(
      '/workspaces/ws-1/media/jobs/job-1/segments/batch',
      { method: 'PUT', body: { updates: [{ segmentId: 'seg-1', targetText: 'Chào' }] } },
    )
    expect(Array.isArray(res)).toBe(true)
  })
})

describe('consentTransformationAssetApi', () => {
  it('sends explicit termsVersion when provided', async () => {
    await consentTransformationAssetApi('ws-1', 'asset-1', 'v2')
    expect(apiRequest).toHaveBeenCalledWith(
      '/workspaces/ws-1/media/assets/asset-1/consent',
      { method: 'POST', body: { termsVersion: 'v2' } },
    )
  })

  it('defaults to v1 when termsVersion is omitted or empty', async () => {
    await consentTransformationAssetApi('ws-1', 'asset-1')
    expect(apiRequest).toHaveBeenCalledWith(
      '/workspaces/ws-1/media/assets/asset-1/consent',
      { method: 'POST', body: { termsVersion: 'v1' } },
    )
  })
})
