import { apiRequest } from '@/lib/api/client'
import type {
  GuideArticle,
  GuideArticleRequest,
  GuideArticleStatus,
  GuideArticlesQuery,
  GuideCategory,
  GuideCategoryRequest,
  GuideMoveRequest,
} from '@/types/guide'

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    search.set(k, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

// =============================================================================
// Public Guide APIs
// =============================================================================

export function getGuideCategoriesApi(lang = 'vi') {
  return apiRequest<GuideCategory[]>(`/guides/categories${qs({ lang })}`, {
    skipAuth: true,
  })
}

export function getGuideArticlesApi(query: GuideArticlesQuery = {}) {
  return apiRequest<GuideArticle[]>(
    `/guides/articles${qs({
      categoryId: query.categoryId,
      q: query.q,
      lang: query.lang ?? 'vi',
    })}`,
    { skipAuth: true },
  )
}

export function getGuideArticleApi(slug: string, lang = 'vi') {
  return apiRequest<GuideArticle>(`/guides/articles/${encodeURIComponent(slug)}${qs({ lang })}`, {
    skipAuth: true,
  })
}

// =============================================================================
// Platform Admin Guide APIs
// =============================================================================

export function getAdminGuideCategoriesApi() {
  return apiRequest<GuideCategory[]>('/platform/guides/categories')
}

export function getAdminGuideCategoryApi(id: string) {
  return apiRequest<GuideCategory>(`/platform/guides/categories/${id}`)
}

export function createGuideCategoryApi(data: GuideCategoryRequest) {
  return apiRequest<GuideCategory>('/platform/guides/categories', {
    method: 'POST',
    body: data,
  })
}

export function updateGuideCategoryApi(id: string, data: GuideCategoryRequest) {
  return apiRequest<GuideCategory>(`/platform/guides/categories/${id}`, {
    method: 'PUT',
    body: data,
  })
}

export function deleteGuideCategoryApi(id: string) {
  return apiRequest<void>(`/platform/guides/categories/${id}`, {
    method: 'DELETE',
  })
}

export function moveGuideCategoryApi(id: string, data: GuideMoveRequest) {
  return apiRequest<GuideCategory>(`/platform/guides/categories/${id}/move`, {
    method: 'PATCH',
    body: data,
  })
}

export function getAdminGuideArticlesApi(query: GuideArticlesQuery = {}) {
  return apiRequest<GuideArticle[]>(
    `/platform/guides/articles${qs({
      categoryId: query.categoryId,
      q: query.q,
      status: query.status,
    })}`,
  )
}

export function getAdminGuideArticleApi(id: string) {
  return apiRequest<GuideArticle>(`/platform/guides/articles/${id}`)
}

export function createGuideArticleApi(data: GuideArticleRequest) {
  return apiRequest<GuideArticle>('/platform/guides/articles', {
    method: 'POST',
    body: data,
  })
}

export function updateGuideArticleApi(id: string, data: GuideArticleRequest) {
  return apiRequest<GuideArticle>(`/platform/guides/articles/${id}`, {
    method: 'PUT',
    body: data,
  })
}

export function deleteGuideArticleApi(id: string) {
  return apiRequest<void>(`/platform/guides/articles/${id}`, {
    method: 'DELETE',
  })
}

export function setGuideArticlePublishApi(id: string, status: GuideArticleStatus) {
  return apiRequest<GuideArticle>(`/platform/guides/articles/${id}/publish`, {
    method: 'PATCH',
    body: { status },
  })
}

export function previewGuideArticleApi(id: string, lang = 'vi') {
  return apiRequest<GuideArticle>(`/platform/guides/articles/${id}/preview${qs({ lang })}`)
}
