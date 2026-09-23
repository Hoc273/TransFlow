// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GuidePage } from './GuidePage'
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
    articleCount: 2,
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
    excerpt: 'Tóm tắt bài viết tổng quan.',
    excerptVi: 'Tóm tắt bài viết tổng quan.',
    excerptEn: 'Summary of overview.',
    content: '# Tổng quan\n\nNội dung Markdown hướng dẫn chi tiết.',
    contentVi: '# Tổng quan\n\nNội dung Markdown hướng dẫn chi tiết.',
    contentEn: '# Overview\n\nMarkdown content in English.',
    status: 'PUBLISHED',
    orderIndex: 0,
  },
  {
    id: 'art-2',
    categoryId: 'cat-1',
    categorySlug: 'bat-dau',
    categoryTitle: 'Bắt đầu',
    slug: 'tao-du-an',
    title: 'Tạo dự án đầu tiên',
    titleVi: 'Tạo dự án đầu tiên',
    titleEn: 'Creating your first project',
    excerpt: 'Hướng dẫn tạo dự án.',
    content: '# Tạo dự án\n\nCác bước thực hiện.',
    status: 'PUBLISHED',
    orderIndex: 1,
  },
]

vi.mock('@/hooks/useGuide', () => ({
  useGuideCategories: () => ({
    data: mockCategories,
    isLoading: false,
  }),
  useGuideArticles: () => ({
    data: mockArticles,
    isLoading: false,
  }),
}))

describe('GuidePage', () => {
  it('renders sidebar categories and default active article content', () => {
    render(
      <MemoryRouter initialEntries={['/guide']}>
        <Routes>
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/guide/:slug" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    )

    // Category in sidebar / breadcrumb
    expect(screen.getAllByText('Bắt đầu').length).toBeGreaterThan(0)
    // Articles in sidebar
    expect(screen.getAllByText('Tổng quan TransFlow').length).toBeGreaterThan(0)
    expect(screen.getByText('Tạo dự án đầu tiên')).toBeInTheDocument()
    // Markdown rendered heading
    expect(screen.getByRole('heading', { level: 1, name: 'Tổng quan TransFlow' })).toBeInTheDocument()
    expect(screen.getByText('Tóm tắt bài viết tổng quan.')).toBeInTheDocument()
  })

  it('renders selected article when slug is present in URL', () => {
    render(
      <MemoryRouter initialEntries={['/guide/tao-du-an']}>
        <Routes>
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/guide/:slug" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Tạo dự án đầu tiên' })).toBeInTheDocument()
    expect(screen.getByText('Hướng dẫn tạo dự án.')).toBeInTheDocument()
  })

  it('filters articles in sidebar when typing in search input', () => {
    render(
      <MemoryRouter initialEntries={['/guide']}>
        <Routes>
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/guide/:slug" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    )

    const searchInput = screen.getByPlaceholderText('search')
    fireEvent.change(searchInput, { target: { value: 'Tạo dự án' } })

    // 'Tạo dự án đầu tiên' should still exist
    expect(screen.getByText('Tạo dự án đầu tiên')).toBeInTheDocument()
    // 'Tổng quan TransFlow' in sidebar list should be filtered out
    const buttons = screen.getAllByRole('button')
    const hasTongQuanButton = buttons.some((b) => b.textContent?.includes('Tổng quan TransFlow'))
    expect(hasTongQuanButton).toBe(false)
  })
})
