import { useQuery } from '@tanstack/react-query'
import {
  getPlatformAuditLogsApi,
  getPlatformOverviewApi,
  getPlatformStatusApi,
  getPlatformUsersApi,
  getPlatformWorkspacesApi,
} from '@/api/platform'
import { STALE, queryKeys } from '@/lib/queryClient'

export function usePlatformOverview(params: { from?: string; to?: string; topLimit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.platformOverview(params),
    queryFn: () => getPlatformOverviewApi(params),
    staleTime: STALE.realtime,
  })
}

export function usePlatformStatus() {
  return useQuery({
    queryKey: queryKeys.platformStatus,
    queryFn: getPlatformStatusApi,
    staleTime: STALE.realtime,
  })
}

export function usePlatformUsers(
  params: { q?: string; page?: number; size?: number; isPlatformAdmin?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.platformUsers(params),
    queryFn: () => getPlatformUsersApi(params),
    staleTime: STALE.realtime,
  })
}

export function usePlatformWorkspaces(params: { q?: string; page?: number; size?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.platformWorkspaces(params),
    queryFn: () => getPlatformWorkspacesApi(params),
    staleTime: STALE.realtime,
  })
}

export function usePlatformAuditLogs(params: { action?: string; page?: number; size?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.platformAudit(params),
    queryFn: () => getPlatformAuditLogsApi(params),
    staleTime: STALE.realtime,
  })
}
