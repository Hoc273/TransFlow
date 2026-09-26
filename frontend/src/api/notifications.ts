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

    return rawItems.map(toNotificationItem)
  })
}

function relatedEntityTypeOf(type: string | undefined): string | null {
  if (type?.startsWith('BATCH_')) return 'BATCH'
  if (type?.startsWith('JOB_')) return 'MEDIA_JOB'
  if (type === 'PROVIDER_KEY_INVALID') return 'PROVIDER'
  return null
}

function toNotificationItem(item: any): NotificationItem {
  const readAt: string | null = item.readAt ?? null
  return {
    id: item.id,
    type: item.type ?? 'NOTIFICATION',
    title: item.title || item.type || 'Notification',
    message: item.message ?? '',
    relatedEntityType: item.relatedEntityType || relatedEntityTypeOf(item.type),
    relatedEntityId: item.relatedEntityId || item.refId || null,
    payload: item.payload ?? null,
    readAt,
    isRead: readAt != null,
    createdAt: item.createdAt || new Date().toISOString(),
  }
}

/** Unread total for the bell badge — reads `totalElements` of a 1-item unread page. */
export function countUnreadNotificationsApi(workspaceId: string): Promise<number> {
  const path = buildWorkspacePath(workspaceId, '/notifications?unread=true&page=0&size=1')
  return apiRequest<any>(path).then((res) => {
    if (typeof res?.totalElements === 'number') return res.totalElements
    return Array.isArray(res) ? res.length : Array.isArray(res?.content) ? res.content.length : 0
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

