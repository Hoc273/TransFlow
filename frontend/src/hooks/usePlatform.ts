import { useQuery } from '@tanstack/react-query'
import {
  getPlatformAuditLogsApi,
  getPlatformOverviewApi,
  getPlatformStatusApi,
  getPlatformUsersApi,
  getPlatformWorkspacesApi,
} from '@/api/platform'
import { getMeApi } from '@/api/auth'
import { queryKeys, STALE } from '@/lib/queryClient'
import { useAuthStore } from '@/store/authStore'
import type {
  PlatformAuditQuery,
  PlatformOverviewQuery,
  PlatformUsersQuery,
  PlatformWorkspacesQuery,
} from '@/types/platform'

/** Refresh me from DB so isPlatformAdmin is not stale after seed. */
export function usePlatformMe(enabled = true) {
  const setUser = useAuthStore((s) => s.setUser)
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const me = await getMeApi()
      setUser(me)
      return me
    },
    enabled,
    staleTime: STALE.realtime,
  })
}

export function usePlatformOverview(query: PlatformOverviewQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformOverview({
      from: query.from,
      to: query.to,
      topLimit: query.topLimit,
    }),
    queryFn: () => getPlatformOverviewApi(query),
    enabled,
    staleTime: STALE.realtime,
  })
}

export function usePlatformStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformStatus,
    queryFn: () => getPlatformStatusApi(),
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export function usePlatformUsers(query: PlatformUsersQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformUsers({
      q: query.q,
      page: query.page,
      size: query.size,
      isPlatformAdmin: query.isPlatformAdmin,
    }),
    queryFn: () => getPlatformUsersApi(query),
    enabled,
    staleTime: STALE.realtime,
  })
}

export function usePlatformWorkspaces(query: PlatformWorkspacesQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformWorkspaces({
      q: query.q,
      page: query.page,
      size: query.size,
    }),
    queryFn: () => getPlatformWorkspacesApi(query),
    enabled,
    staleTime: STALE.realtime,
  })
}

export function usePlatformAuditLogs(query: PlatformAuditQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformAudit({
      action: query.action,
      page: query.page,
      size: query.size,
    }),
    queryFn: () => getPlatformAuditLogsApi(query),
    enabled,
    staleTime: STALE.realtime,
  })
}
