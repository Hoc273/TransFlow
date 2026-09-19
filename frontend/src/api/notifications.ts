import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { NotificationItem } from '@/types/notification'

export async function listNotificationsApi(
  workspaceId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<NotificationItem[]> {
  const search = new URLSearchParams()
  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const page = Math.floor(offset / limit)
  search.set('page', String(page))
  search.set('size', String(limit))
  const qs = search.toString()
  const path = buildWorkspacePath(workspaceId, `/notifications${qs ? `?${qs}` : ''}`)
  const res = await apiRequest<any>(path)
  if (res && Array.isArray(res.content)) {
    return res.content
  }
  if (Array.isArray(res)) {
    return res
  }
  return []
}

export function markNotificationAsReadApi(workspaceId: string, id: string) {
  return apiRequest<any>(buildWorkspacePath(workspaceId, `/notifications/${id}/read`), {
    method: 'POST',
  })
}

export function markAllNotificationsAsReadApi(workspaceId: string) {
  return apiRequest<any>(buildWorkspacePath(workspaceId, '/notifications/read-all'), {
    method: 'POST',
  })
}
