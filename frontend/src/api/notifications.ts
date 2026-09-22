import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { NotificationItem } from '@/types/notification'

export type NotificationQueryParams = {
  limit?: number
  offset?: number
  page?: number
  size?: number
  unread?: boolean
}

export function listNotificationsApi(
  workspaceId: string,
  params: NotificationQueryParams = {},
): Promise<NotificationItem[]> {
  const search = new URLSearchParams()
  const size = params.size ?? params.limit ?? 20
  const page = params.page ?? (params.offset != null ? Math.floor(params.offset / size) : 0)
  const offset = params.offset ?? page * size
  const limit = params.limit ?? size

  search.set('page', String(page))
  search.set('size', String(size))
  search.set('limit', String(limit))
  search.set('offset', String(offset))
  if (params.unread != null) search.set('unread', String(params.unread))

  const qs = search.toString()
  const path = buildWorkspacePath(workspaceId, `/notifications${qs ? `?${qs}` : ''}`)
  return apiRequest<any>(path).then((res) => {
    const rawItems: any[] = Array.isArray(res)
      ? res
      : Array.isArray(res?.content)
        ? res.content
        : []

    return rawItems.map((item: any): NotificationItem => ({
      id: item.id,
      type: item.type ?? 'NOTIFICATION',
      title: item.title || item.type || 'Notification',
      message: item.message ?? '',
      relatedEntityType: item.relatedEntityType || (item.type?.startsWith('BATCH_') ? 'BATCH' : null),
      relatedEntityId: item.relatedEntityId || item.refId || null,
      payload: item.payload ?? null,
      createdAt: item.createdAt || new Date().toISOString(),
    }))
  })
}

export function markNotificationReadApi(workspaceId: string, notificationId: string) {
  return apiRequest<{ id: string }>(
    buildWorkspacePath(workspaceId, `/notifications/${notificationId}/read`),
    { method: 'POST' },
  )
}

export function markAllNotificationsReadApi(workspaceId: string) {
  return apiRequest<{ updatedCount: number }>(
    buildWorkspacePath(workspaceId, '/notifications/read-all'),
    { method: 'POST' },
  )
}

