// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { MediaAsset, MediaJob } from '@/types/media'
import { JobsTable } from './JobsTable'

afterEach(() => cleanup())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue ?? key,
  }),
}))

const mockJobs: MediaJob[] = [
  {
    id: 'job-11111111',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    projectId: 'prj-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'COMPLETED',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-09-01T10:00:00Z',
    stages: [],
  },
  {
    id: 'job-22222222',
    documentId: 'doc-2',
    rootAssetId: 'asset-2',
    projectId: 'prj-1',
    processingMode: 'HYBRID',
    sourceLanguage: 'en',
    targetLang: 'ja',
    status: 'PROCESSING',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-09-02T10:00:00Z',
    stages: [],
  },
  {
    id: 'job-33333333',
    documentId: 'doc-3',
    rootAssetId: 'asset-3',
    projectId: 'prj-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'FAILED',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-09-03T10:00:00Z',
    stages: [],
  },
]

const mockAssets: MediaAsset[] = [
  {
    id: 'asset-1',
    projectId: 'prj-1',
    parentAssetId: null,
    assetType: 'SOURCE_VIDEO',
    fileName: 'alpha_video.mp4',
    mimeType: 'video/mp4',
    fileSizeBytes: 1024,
    durationMs: 60000,
    processingStatus: 'READY',
    createdAt: '2026-09-01T10:00:00Z',
  },
  {
    id: 'asset-2',
    projectId: 'prj-1',
    parentAssetId: null,
    assetType: 'SOURCE_VIDEO',
    fileName: 'beta_video.mp4',
    mimeType: 'video/mp4',
    fileSizeBytes: 2048,
    durationMs: 60000,
    processingStatus: 'READY',
    createdAt: '2026-09-02T10:00:00Z',
  },
  {
    id: 'asset-3',
    projectId: 'prj-1',
    parentAssetId: null,
    assetType: 'SOURCE_VIDEO',
    fileName: 'gamma_video.mp4',
    mimeType: 'video/mp4',
    fileSizeBytes: 4096,
    durationMs: 60000,
    processingStatus: 'READY',
    createdAt: '2026-09-03T10:00:00Z',
  },
]

describe('JobsTable component', () => {
  it('renders filter controls and chips with correct counts', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={mockJobs}
          assets={mockAssets}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={10}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    // Chips
    expect(screen.getByRole('button', { name: 'Tất cả (3)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Đang chạy (1)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lỗi (1)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Xong (1)' })).toBeTruthy()

    // Table rows
    expect(screen.getByText('alpha_video.mp4')).toBeTruthy()
    expect(screen.getByText('beta_video.mp4')).toBeTruthy()
    expect(screen.getByText('gamma_video.mp4')).toBeTruthy()
  })

  it('filters rows when typing in the search box', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={mockJobs}
          assets={mockAssets}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={10}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    const searchInput = screen.getByPlaceholderText('Tìm theo tên video hoặc ID…')
    fireEvent.change(searchInput, { target: { value: 'alpha' } })

    expect(screen.getByText('alpha_video.mp4')).toBeTruthy()
    expect(screen.queryByText('beta_video.mp4')).toBeNull()
    expect(screen.queryByText('gamma_video.mp4')).toBeNull()
  })

  it('filters rows when clicking a status chip', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={mockJobs}
          assets={mockAssets}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={10}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    const failedChip = screen.getByRole('button', { name: 'Lỗi (1)' })
    fireEvent.click(failedChip)

    expect(screen.getByText('gamma_video.mp4')).toBeTruthy()
    expect(screen.queryByText('alpha_video.mp4')).toBeNull()
    expect(screen.queryByText('beta_video.mp4')).toBeNull()
  })

  it('shows clear filters button when no jobs match and restores table on clear', () => {
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={mockJobs}
          assets={mockAssets}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={10}
          onPageChange={() => {}}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    const searchInput = screen.getByPlaceholderText('Tìm theo tên video hoặc ID…')
    fireEvent.change(searchInput, { target: { value: 'non_existing_keyword' } })

    expect(screen.getByText('Không tìm thấy job phù hợp với bộ lọc.')).toBeTruthy()

    const clearBtn = screen.getAllByText('Xóa bộ lọc')[0]
    fireEvent.click(clearBtn)

    expect(screen.getByText('alpha_video.mp4')).toBeTruthy()
    expect(screen.getByText('beta_video.mp4')).toBeTruthy()
  })

  it('calls onPageSizeChange when selecting a new page size', () => {
    const onPageSizeChange = vi.fn()
    render(
      <MemoryRouter>
        <JobsTable
          workspaceId="ws"
          projectId="prj-1"
          jobs={mockJobs}
          assets={mockAssets}
          isLoading={false}
          language="vi"
          page={0}
          pageSize={10}
          onPageChange={() => {}}
          onPageSizeChange={onPageSizeChange}
          onOpen={() => {}}
        />
      </MemoryRouter>,
    )

    const pageSizeSelect = screen.getByDisplayValue('10')
    fireEvent.change(pageSizeSelect, { target: { value: '20' } })

    expect(onPageSizeChange).toHaveBeenCalledWith(20)
  })
})
