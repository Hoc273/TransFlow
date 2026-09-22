import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  buildWorkspacePath: (workspaceId: string, suffix = '') =>
    `/workspaces/${workspaceId}${suffix.startsWith('/') ? suffix : suffix ? `/${suffix}` : ''}`,
}))

const { downloadBulkJobsApi } = await import('./batches')

beforeEach(() => {
  apiRequest.mockReset()
  apiRequest.mockResolvedValue({ downloadUrl: 'http://minio/x.zip', fileName: 'videos.zip' })
})

describe('downloadBulkJobsApi', () => {
  it('posts completed jobIds to the project bulk-download endpoint', async () => {
    const res = await downloadBulkJobsApi('ws-1', 'proj-1', ['job-a', 'job-b'])
    expect(apiRequest).toHaveBeenCalledWith(
      '/workspaces/ws-1/projects/proj-1/media/jobs/download',
      { method: 'POST', body: { jobIds: ['job-a', 'job-b'] } },
    )
    expect(res.downloadUrl).toContain('http')
  })
})
