import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  buildWorkspacePath: (workspaceId: string, suffix = '') =>
    `/workspaces/${workspaceId}${suffix.startsWith('/') ? suffix : suffix ? `/${suffix}` : ''}`,
}))

const {
  assignJobSubtitleStyleApi,
  getJobSubtitleStyleApi,
  getSubtitleStyleApi,
  listSubtitleStylePresetsApi,
} = await import('./subtitleStyle')

beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockResolvedValue({})
})

describe('listSubtitleStylePresetsApi', () => {
  it('reads the deployment-wide preset route, never a workspace- or job-scoped one', async () => {
    await listSubtitleStylePresetsApi()

    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe('/media/subtitle-styles')
    expect(path).not.toContain('/workspaces/')
    expect(path).not.toContain('/jobs/')
    expect(options?.method).toBeUndefined()
  })
})

describe('getSubtitleStyleApi', () => {
  it('addresses the preset by stable key', async () => {
    await getSubtitleStyleApi('style-tiktok')

    expect(apiRequest.mock.calls[0][0]).toBe('/media/subtitle-styles/style-tiktok')
  })

  it('encodes the key so it cannot escape its path segment', async () => {
    await getSubtitleStyleApi('a/../b')

    expect(apiRequest.mock.calls[0][0]).toBe('/media/subtitle-styles/a%2F..%2Fb')
  })
})

describe('assignJobSubtitleStyleApi', () => {
  it('POSTs the B1.2 body shape — `key`, never `styleKey` or a UUID', async () => {
    await assignJobSubtitleStyleApi('job-1', 'style-tiktok')

    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe('/media/jobs/job-1/subtitle-style')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({ key: 'style-tiktok' })
    expect(Object.keys(options.body)).not.toContain('styleKey')
    expect(Object.keys(options.body)).not.toContain('styleId')
  })
})

describe('getJobSubtitleStyleApi', () => {
  it('reads the job-scoped current style', async () => {
    await getJobSubtitleStyleApi('job-1')

    const [path, options] = apiRequest.mock.calls[0]
    expect(path).toBe('/media/jobs/job-1/subtitle-style')
    expect(options?.method).toBeUndefined()
  })
})
