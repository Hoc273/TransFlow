// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileGlossaryPage } from './MobileGlossaryPage'

const refetchProjects = vi.fn()
const refetchTerms = vi.fn()
const addTermMutate = vi.fn()
const deleteTermMutate = vi.fn()
let canEdit = true

const projects = [
  { id: 'p1', name: 'Project Alpha', sourceLang: 'en', defaultGlossaryId: null, domain: null, tone: null },
  { id: 'p2', name: 'Project Beta', sourceLang: 'vi', defaultGlossaryId: null, domain: null, tone: null },
]

const termsByProject = {
  p1: [
    { id: 't1', glossaryId: 'g1', sourceTerm: 'Artificial Intelligence', targetTerm: 'Trí tuệ nhân tạo', targetLang: 'vi' },
  ],
  p2: [
    { id: 't2', glossaryId: 'g2', sourceTerm: 'Dữ liệu', targetTerm: 'Data', targetLang: 'en' },
  ],
}

vi.mock('@/hooks/useProjects', () => ({
  useProjects: vi.fn(() => ({
    data: projects,
    isLoading: false,
    error: null,
    refetch: refetchProjects,
  })),
}))

vi.mock('@/hooks/useGlossary', () => ({
  useGlossaryTerms: vi.fn((_workspaceId: string, projectId?: 'p1' | 'p2') => ({
    data: projectId ? termsByProject[projectId] : [],
    isLoading: false,
    error: null,
    refetch: refetchTerms,
  })),
  useAddTerm: vi.fn(() => ({ mutate: addTermMutate, isPending: false })),
  useDeleteTerm: vi.fn(() => ({ mutate: deleteTermMutate, isPending: false })),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: vi.fn(() => canEdit),
}))

describe('MobileGlossaryPage', () => {
  const renderPage = () => render(
    <MemoryRouter initialEntries={['/w/ws-test/glossaries']}>
      <Routes>
        <Route path="/w/:workspaceId/glossaries" element={<MobileGlossaryPage />} />
      </Routes>
    </MemoryRouter>,
  )

  beforeEach(() => {
    vi.clearAllMocks()
    canEdit = true
  })

  afterEach(cleanup)

  it('renders terms for the first project', () => {
    renderPage()

    expect(screen.getByText('Project Alpha')).toBeTruthy()
    expect(screen.getByText('Artificial Intelligence')).toBeTruthy()
    expect(screen.getByText('Trí tuệ nhân tạo')).toBeTruthy()
  })

  it('switches glossary data by project id', () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Chọn dự án'), { target: { value: 'p2' } })

    expect(screen.getByText('Dữ liệu')).toBeTruthy()
    expect(screen.getByText('Data')).toBeTruthy()
  })

  it('creates one term with the backend contract', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Thêm từ' }))
    fireEvent.change(screen.getByLabelText('Thuật ngữ nguồn *'), {
      target: { value: 'machine learning' },
    })
    fireEvent.change(screen.getByLabelText('Thuật ngữ đích *'), {
      target: { value: 'học máy' },
    })
    fireEvent.change(screen.getByLabelText('Ngôn ngữ đích *'), { target: { value: 'vi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thuật ngữ' }))

    expect(addTermMutate).toHaveBeenCalledWith(
      { sourceTerm: 'machine learning', targetTerm: 'học máy', targetLang: 'vi' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('deletes a term by id', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Xóa thuật ngữ Artificial Intelligence' }))

    expect(deleteTermMutate).toHaveBeenCalledWith('t1')
  })

  it('hides mutation actions for read-only users', () => {
    canEdit = false
    renderPage()

    expect(screen.queryByRole('button', { name: 'Thêm từ' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Xóa thuật ngữ/ })).toBeNull()
  })
})
