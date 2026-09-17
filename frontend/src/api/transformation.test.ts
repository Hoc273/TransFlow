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

const { createTransformationJobApi, getTransformationCapabilitiesApi } = await import(
  './transformation'
)

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
