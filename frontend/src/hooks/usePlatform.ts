import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminAdjustUserCreditApi,
  createPlatformPricingApi,
  getPlatformPricingApi,
  getPlatformPricingCoverageApi,
  getPlatformPricingHistoryApi,
  previewPlatformPricingApi,
  createPlatformProviderApi,
  deletePlatformProviderApi,
  getPlatformProvidersApi,
  syncPlatformProviderVoicesApi,
  testPlatformProviderApi,
  updatePlatformProviderApi,
  getPlatformAuditLogsApi,
  getPlatformOverviewApi,
  getPlatformRealtimeApi,
  getPlatformStatusApi,
  getPlatformUsersApi,
  getPlatformWorkspacesApi,
} from '@/api/platform'
import { getMeApi } from '@/api/auth'
import { queryKeys, STALE } from '@/lib/queryClient'
import { useAuthStore } from '@/store/authStore'
import type {
  AdminCreditAdjustRequest,
  PlatformAuditQuery,
  PlatformOverviewQuery,
  PlatformProviderInput,
  PlatformUsersQuery,
  PricingVersionInput,
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

export function usePlatformOverview(query: PlatformOverviewQuery = {}, enabled = true) {
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

export function usePlatformUsers(query: PlatformUsersQuery = {}, enabled = true) {
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

export function usePlatformWorkspaces(query: PlatformWorkspacesQuery = {}, enabled = true) {
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

export function usePlatformAuditLogs(query: PlatformAuditQuery = {}, enabled = true) {
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

/**
 * SA-RT — polls GET /api/platform/realtime every 3 seconds.
 * Returns processingJobs, completedToday, tokensLastHour — all sourced from DB.
 */
export function usePlatformRealtime(enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformRealtime,
    queryFn: () => getPlatformRealtimeApi(),
    enabled,
    staleTime: 0,
    refetchInterval: 3000,
  })
}

/**
 * SA — adjust credit balance for any user (grant or deduct).
 * Invalidates the platform users list on success so balance data refreshes.
 */
export function useAdminAdjustUserCredit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, req }: { userId: string; req: AdminCreditAdjustRequest }) =>
      adminAdjustUserCreditApi(userId, req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'users'] })
    },
  })
}

/** SA — shared platform AI key pool; polled so health/cooldown badges stay current. */
export function usePlatformProviders(enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformProviders,
    queryFn: () => getPlatformProvidersApi(),
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

function useProviderMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.platformProviders })
    },
  })
}

export function useCreatePlatformProvider() {
  return useProviderMutation((body: PlatformProviderInput) => createPlatformProviderApi(body))
}

export function useUpdatePlatformProvider() {
  return useProviderMutation(({ id, body }: { id: string; body: PlatformProviderInput }) =>
    updatePlatformProviderApi(id, body),
  )
}

export function useDeletePlatformProvider() {
  return useProviderMutation((id: string) => deletePlatformProviderApi(id))
}

export function useTestPlatformProvider() {
  return useProviderMutation((id: string) => testPlatformProviderApi(id))
}

export function useSyncPlatformProviderVoices() {
  return useProviderMutation((id: string) => syncPlatformProviderVoicesApi(id))
}

/** SA — credit price versions in effect now + scheduled ones. */
export function usePlatformPricing() {
  return useQuery({
    queryKey: queryKeys.platformPricing,
    queryFn: () => getPlatformPricingApi(),
    staleTime: 30_000,
  })
}

export function usePlatformPricingHistory(capability?: string, providerScope?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.platformPricingHistory({ capability, providerScope }),
    queryFn: () => getPlatformPricingHistoryApi({ capability, providerScope }),
    enabled,
  })
}

export function usePlatformPricingCoverage() {
  return useQuery({
    queryKey: queryKeys.platformPricingCoverage,
    queryFn: () => getPlatformPricingCoverageApi(),
    staleTime: 30_000,
  })
}

export function useCreatePlatformPricing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PricingVersionInput) => createPlatformPricingApi(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.platformPricing })
    },
  })
}

export function usePreviewPlatformPricing() {
  return useMutation({
    mutationFn: (body: Parameters<typeof previewPlatformPricingApi>[0]) => previewPlatformPricingApi(body),
  })
}
