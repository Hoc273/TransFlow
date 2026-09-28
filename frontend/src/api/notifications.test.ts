import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiRequest = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  buildWorkspacePath: (ws: string, path: string) => `/workspaces/${ws}${path}`,
}))

const { listNotificationsApi } = await import('./notifications')

beforeEach(() => {
  apiRequest.mockReset()
})

describe('notifications api', () => {
  it('reads the backend PageResponse `items` list', async () => {
    apiRequest.mockResolvedValue({
      items: [
        {
          id: 'n1',
          type: 'JOB_COMPLETED',
          refId: 'job-1',
          message: 'Job xong',
          readAt: null,
          createdAt: '2026-09-28T00:00:00Z',
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    })

    const items = await listNotificationsApi('ws', { limit: 20, offset: 0 })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'n1',
      type: 'JOB_COMPLETED',
      message: 'Job xong',
      relatedEntityId: 'job-1',
      relatedEntityType: 'MEDIA_JOB',
      isRead: false,
    })
  })
})
