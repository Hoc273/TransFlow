import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { listNotificationsApi } from '@/api/notifications'
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

export { PAGE_SIZE as NOTIFICATION_PAGE_SIZE }
