import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteTmEntryApi, queryTmApi } from '@/api/tm'
import { STALE, queryKeys } from '@/lib/queryClient'
import type { TmQueryParams } from '@/types/tm'

export function useTmQuery(
  workspaceId: string | undefined,
  params: TmQueryParams | null,
) {
  return useQuery({
    queryKey: queryKeys.tm(workspaceId ?? '', params ?? { sl: '', tl: '' }),
    queryFn: () => queryTmApi(workspaceId!, params!),
    enabled: !!workspaceId && !!params?.sl && !!params?.tl,
    staleTime: STALE.static,
  })
}

export function useDeleteTmEntry(workspaceId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTmEntryApi(workspaceId!, id),
    onSuccess: () => {
      if (workspaceId) {
        void qc.invalidateQueries({ queryKey: ['tm', workspaceId] })
      }
    },
  })
}
