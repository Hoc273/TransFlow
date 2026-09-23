export type GuideArticleStatus = 'DRAFT' | 'PUBLISHED'

export interface GuideCategory {
  id: string
  slug: string
  title: string
  titleVi: string
  titleEn: string
  orderIndex: number
  published: boolean
  articleCount: number
  createdAt?: string
  updatedAt?: string
}

export interface GuideCategoryRequest {
  slug?: string
  titleVi: string
  titleEn: string
  orderIndex?: number
  published?: boolean
}

export interface GuideArticle {
  id: string
  categoryId: string
  categorySlug?: string
  categoryTitle?: string
  slug: string
  title: string
  titleVi: string
  titleEn: string
  excerpt?: string
  excerptVi?: string
  excerptEn?: string
  content: string
  contentVi?: string
  contentEn?: string
  status: GuideArticleStatus
  orderIndex: number
  coverImageUrl?: string
  createdAt?: string
  updatedAt?: string
}

export interface GuideArticleRequest {
  slug?: string
  categoryId: string
  titleVi: string
  titleEn: string
  excerptVi?: string
  excerptEn?: string
  contentVi: string
  contentEn: string
  orderIndex?: number
  coverImageUrl?: string
  status?: GuideArticleStatus
}

export interface GuideMoveRequest {
  direction?: 'UP' | 'DOWN'
  orderIndex?: number
}

export interface GuideArticlesQuery {
  categoryId?: string
  q?: string
  lang?: string
  status?: GuideArticleStatus
}
