import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCreditPackagesApi,
  getCreditTransactionsApi,
  getUserCreditApi,
  purchaseCreditPackageApi,
} from '@/api/credit'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { CreditTransactionQuery } from '@/types/credit'

export function useUserCredit() {
  return useQuery({
    queryKey: queryKeys.userCredit,
    queryFn: getUserCreditApi,
    staleTime: STALE.realtime,
  })
}

export function useCreditTransactions(query: CreditTransactionQuery = {}) {
  return useQuery({
    queryKey: queryKeys.creditTransactions(query),
    queryFn: () => getCreditTransactionsApi(query),
    staleTime: STALE.realtime,
  })
}

export function useCreditPackages() {
  return useQuery({
    queryKey: queryKeys.creditPackages,
    queryFn: getCreditPackagesApi,
    staleTime: STALE.static,
  })
}

export function usePurchaseCreditPackage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ packageId, paymentReference }: { packageId: string; paymentReference: string }) =>
      purchaseCreditPackageApi(packageId, paymentReference),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.userCredit })
      void queryClient.invalidateQueries({ queryKey: queryKeys.creditTransactionsRoot })
    },
  })
}
