// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GuideAdminPage } from './GuideAdminPage'
import type { GuideArticle, GuideCategory } from '@/types/guide'

interface CustomMatchers<R = unknown> {
  toBeInTheDocument(): R
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toBeInTheDocument(received) {
    const pass = received !== null && received !== undefined
    return {
      pass,
      message: () => `expected element to ${pass ? 'not ' : ''}be in the document`,
    }
  },
})

afterEach(() => cleanup())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'vi' },
  }),
}))

const mockCategories: GuideCategory[] = [
  {
    id: 'cat-1',
    slug: 'bat-dau',
    title: 'Bắt đầu',
    titleVi: 'Bắt đầu',
    titleEn: 'Getting Started',
    orderIndex: 0,
    published: true,
    articleCount: 1,
  },
]

const mockArticles: GuideArticle[] = [
  {
    id: 'art-1',
    categoryId: 'cat-1',
    categorySlug: 'bat-dau',
    categoryTitle: 'Bắt đầu',
    slug: 'tong-quan',
    title: 'Tổng quan TransFlow',
    titleVi: 'Tổng quan TransFlow',
    titleEn: 'Overview of TransFlow',
    excerptVi: 'Tóm tắt bài viết.',
    content: '# Tổng quan\n\nNội dung Markdown.',
    contentVi: '# Tổng quan\n\nNội dung Markdown.',
    contentEn: '# Overview\n\nEnglish markdown.',
    status: 'PUBLISHED',
    orderIndex: 0,
  },
]

const mockSetPublishMutate = vi.fn().mockResolvedValue({})
const mockCreateCategoryMutate = vi.fn().mockResolvedValue({})

vi.mock('@/hooks/useGuide', () => ({
  useAdminGuideCategories: () => ({
    data: mockCategories,
    isLoading: false,
  }),
  useAdminGuideArticles: () => ({
    data: mockArticles,
    isLoading: false,
  }),
  useCreateGuideCategory: () => ({
    mutateAsync: mockCreateCategoryMutate,
    isPending: false,
  }),
  useUpdateGuideCategory: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteGuideCategory: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useMoveGuideCategory: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCreateGuideArticle: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateGuideArticle: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteGuideArticle: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSetGuideArticlePublish: () => ({
    mutateAsync: mockSetPublishMutate,
    isPending: false,
  }),
}))

describe('GuideAdminPage', () => {
  it('renders categories list and articles table', () => {
    render(
      <MemoryRouter>
        <GuideAdminPage />
      </MemoryRouter>,
    )

    // Category panel
    expect(screen.getAllByText('Bắt đầu').length).toBeGreaterThan(0)
    expect(screen.getByText(/1 bài viết/i)).toBeInTheDocument()

    // Article row
    expect(screen.getByText('Tổng quan TransFlow')).toBeInTheDocument()
    expect(screen.getAllByText('admin.published').length).toBeGreaterThan(0)
  })

  it('calls setPublishMut when clicking publish status badge', () => {
    render(
      <MemoryRouter>
        <GuideAdminPage />
      </MemoryRouter>,
    )

    const publishBtn = screen.getByTitle('admin.unpublish')
    fireEvent.click(publishBtn)

    expect(mockSetPublishMutate).toHaveBeenCalledWith({
      id: 'art-1',
      status: 'DRAFT',
    })
  })

  it('opens new category modal and submits form', () => {
    render(
      <MemoryRouter>
        <GuideAdminPage />
      </MemoryRouter>,
    )

    const newCatBtn = screen.getByRole('button', { name: /admin.newCategory/i })
    fireEvent.click(newCatBtn)

    expect(screen.getByPlaceholderText('Ví dụ: Bắt đầu')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Ví dụ: Bắt đầu'), {
      target: { value: 'Nâng cao' },
    })
    fireEvent.change(screen.getByPlaceholderText('Example: Getting Started'), {
      target: { value: 'Advanced' },
    })

    const saveBtn = screen.getByRole('button', { name: 'admin.save' })
    fireEvent.click(saveBtn)

    expect(mockCreateCategoryMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        titleVi: 'Nâng cao',
        titleEn: 'Advanced',
      }),
    )
  })
})
