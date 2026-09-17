import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { NotificationItem } from '@/types/notification'

export function listNotificationsApi(
  workspaceId: string,
  params: { limit?: number; offset?: number } = {},
) {
  const search = new URLSearchParams()
  if (params.limit != null) search.set('limit', String(params.limit))
  if (params.offset != null) search.set('offset', String(params.offset))
  const qs = search.toString()
  const path = buildWorkspacePath(workspaceId, `/notifications${qs ? `?${qs}` : ''}`)
  return apiRequest<NotificationItem[]>(path)
}
