import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  countUnreadNotificationsApi,
  listNotificationsApi,
  markAllNotificationsReadApi,
  markNotificationReadApi,
} from '@/api/notifications'
import { STALE, queryKeys } from '@/lib/queryClient'

const PAGE_SIZE = 20

export function useNotifications(
  workspaceId: string | undefined,
  params: { limit?: number; offset?: number } = { limit: 5, offset: 0 },
) {
  return useQuery({
    queryKey: queryKeys.notifications(workspaceId ?? '', params),
    queryFn: () => listNotificationsApi(workspaceId!, params),
    enabled: !!workspaceId,
    staleTime: STALE.realtime,
    refetchInterval: 30_000,
  })
}

/** B.6 Notification Center — paginated list with Load more. */
export function useNotificationsInfinite(workspaceId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.notificationsInfinite(workspaceId ?? ''),
    queryFn: ({ pageParam }) =>
      listNotificationsApi(workspaceId!, { limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined
      return allPages.reduce((sum, p) => sum + p.length, 0)
    },
    enabled: !!workspaceId,
    staleTime: STALE.realtime,
    refetchInterval: 30_000,
  })
}

/** Unread total for the bell badge (server-side count, not the loaded page). */
export function useUnreadNotificationCount(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.notificationsUnreadCount(workspaceId ?? ''),
    queryFn: () => countUnreadNotificationsApi(workspaceId!),
    enabled: !!workspaceId,
    staleTime: STALE.realtime,
    refetchInterval: 30_000,
  })
}

/** Mark one notification read; refreshes every notification query of the workspace. */
export function useMarkNotificationRead(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationReadApi(workspaceId!, notificationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', workspaceId ?? ''] }),
  })
}

export function useMarkAllNotificationsRead(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => markAllNotificationsReadApi(workspaceId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', workspaceId ?? ''] }),
  })
}

export { PAGE_SIZE as NOTIFICATION_PAGE_SIZE }
