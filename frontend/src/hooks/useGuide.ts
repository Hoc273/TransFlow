import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createGuideArticleApi,
  createGuideCategoryApi,
  deleteGuideArticleApi,
  deleteGuideCategoryApi,
  getAdminGuideArticleApi,
  getAdminGuideArticlesApi,
  getAdminGuideCategoriesApi,
  getAdminGuideCategoryApi,
  getGuideArticleApi,
  getGuideArticlesApi,
  getGuideCategoriesApi,
  moveGuideCategoryApi,
  previewGuideArticleApi,
  setGuideArticlePublishApi,
  updateGuideArticleApi,
  updateGuideCategoryApi,
} from '@/api/guide'
import { queryKeys, STALE } from '@/lib/queryClient'
import type {
  GuideArticleRequest,
  GuideArticleStatus,
  GuideArticlesQuery,
  GuideCategoryRequest,
  GuideMoveRequest,
} from '@/types/guide'

// =============================================================================
// Public Guide Hooks
// =============================================================================

export function useGuideCategories(lang = 'vi', enabled = true) {
  return useQuery({
    queryKey: queryKeys.guideCategories(lang),
    queryFn: () => getGuideCategoriesApi(lang),
    enabled,
    staleTime: 60_000,
  })
}

export function useGuideArticles(query: GuideArticlesQuery = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.guideArticles({
      categoryId: query.categoryId,
      q: query.q,
      lang: query.lang ?? 'vi',
    }),
    queryFn: () => getGuideArticlesApi(query),
    enabled,
    staleTime: 60_000,
  })
}

export function useGuideArticle(slug?: string, lang = 'vi', enabled = true) {
  return useQuery({
    queryKey: queryKeys.guideArticle(slug, lang),
    queryFn: () => getGuideArticleApi(slug!, lang),
    enabled: enabled && Boolean(slug),
    staleTime: 60_000,
  })
}

// =============================================================================
// Platform Admin Category Hooks
// =============================================================================

export function useAdminGuideCategories(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminGuideCategories,
    queryFn: () => getAdminGuideCategoriesApi(),
    enabled,
    staleTime: STALE.realtime,
  })
}

export function useAdminGuideCategory(id?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminGuideCategory(id),
    queryFn: () => getAdminGuideCategoryApi(id!),
    enabled: enabled && Boolean(id),
    staleTime: STALE.realtime,
  })
}

export function useCreateGuideCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: GuideCategoryRequest) => createGuideCategoryApi(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminGuideCategories })
      queryClient.invalidateQueries({ queryKey: ['guide', 'categories'] })
    },
  })
}

export function useUpdateGuideCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: GuideCategoryRequest }) =>
      updateGuideCategoryApi(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminGuideCategories })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminGuideCategory(id) })
      queryClient.invalidateQueries({ queryKey: ['guide'] })
    },
  })
}

export function useDeleteGuideCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteGuideCategoryApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminGuideCategories })
      queryClient.invalidateQueries({ queryKey: ['guide'] })
    },
  })
}

export function useMoveGuideCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: GuideMoveRequest }) =>
      moveGuideCategoryApi(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adminGuideCategories })
      queryClient.invalidateQueries({ queryKey: ['guide', 'categories'] })
    },
  })
}

// =============================================================================
// Platform Admin Article Hooks
// =============================================================================

export function useAdminGuideArticles(query: GuideArticlesQuery = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminGuideArticles({
      categoryId: query.categoryId,
      q: query.q,
      status: query.status,
    }),
    queryFn: () => getAdminGuideArticlesApi(query),
    enabled,
    staleTime: STALE.realtime,
  })
}

export function useAdminGuideArticle(id?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminGuideArticle(id),
    queryFn: () => getAdminGuideArticleApi(id!),
    enabled: enabled && Boolean(id),
    staleTime: STALE.realtime,
  })
}

export function useCreateGuideArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: GuideArticleRequest) => createGuideArticleApi(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'guide'] })
      queryClient.invalidateQueries({ queryKey: ['guide'] })
    },
  })
}

export function useUpdateGuideArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: GuideArticleRequest }) =>
      updateGuideArticleApi(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'guide'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminGuideArticle(id) })
      queryClient.invalidateQueries({ queryKey: ['guide'] })
    },
  })
}

export function useDeleteGuideArticle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteGuideArticleApi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'guide'] })
      queryClient.invalidateQueries({ queryKey: ['guide'] })
    },
  })
}

export function useSetGuideArticlePublish() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: GuideArticleStatus }) =>
      setGuideArticlePublishApi(id, status),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'guide'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminGuideArticle(id) })
      queryClient.invalidateQueries({ queryKey: ['guide'] })
    },
  })
}

export function usePreviewGuideArticle(id?: string, lang = 'vi', enabled = true) {
  return useQuery({
    queryKey: ['admin', 'guide', 'preview', id, lang],
    queryFn: () => previewGuideArticleApi(id!, lang),
    enabled: enabled && Boolean(id),
  })
}
