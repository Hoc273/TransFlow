import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  IconAlertCircle,
  IconFolder,
  IconRefresh,
  IconVideo,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { MobileCard } from '../../components/MobileCard'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useProjects } from '@/hooks/useProjects'
import { useMediaJobs } from '@/hooks/useMedia'

function getStatusBadgeStyle(status?: string) {
  switch (status?.toUpperCase()) {
    case 'COMPLETED':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    case 'FAILED':
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
    case 'PARTIALLY_FAILED':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    case 'PROCESSING':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
    case 'PENDING':
    default:
      return 'bg-primary/10 text-primary border-primary/20'
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function MobileMediaListPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryProjectId = searchParams.get('projectId') || ''

  // 1. Projects hook
  const projectsQuery = (useProjects as any)(workspaceId)
  const projects: Array<{ id: string; name: string }> =
    projectsQuery?.data ?? projectsQuery?.projects ?? []

  // Default to query param or first project id
  const selectedProjectId = queryProjectId || projects[0]?.id

  // 2. Media Jobs hook (supports both real signature and parameterless mock)
  const mediaJobsQuery = (useMediaJobs as any)(workspaceId, selectedProjectId)

  // Defensive normalization
  const jobs: any[] =
    mediaJobsQuery?.jobs ??
    (Array.isArray(mediaJobsQuery?.data) ? mediaJobsQuery.data : null) ??
    (Array.isArray(mediaJobsQuery) ? mediaJobsQuery : [])

  const isLoading = Boolean(mediaJobsQuery?.isLoading)
  const error = mediaJobsQuery?.error
  const refetch = mediaJobsQuery?.refetch

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const filterOptions = [
    { id: 'ALL', label: 'Tất cả' },
    { id: 'PROCESSING', label: 'Đang xử lý' },
    { id: 'COMPLETED', label: 'Hoàn thành' },
    { id: 'FAILED', label: 'Thất bại' },
  ]

  const filtered = jobs.filter((j: any) => {
    const title = (j.title || j.fileName || j.name || j.id || '').toLowerCase()
    const matchSearch = title.includes(search.toLowerCase())
    const matchStatus =
      statusFilter === 'ALL' ||
      j.status?.toUpperCase() === statusFilter.toUpperCase()
    return matchSearch && matchStatus
  })

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">Media Hub</h1>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {jobs.length > 0 ? `${jobs.length} tệp media` : 'Quản lý phụ đề và video'}
          </p>
        </div>
        <Link
          to={`/w/${workspaceId}/media/presets`}
          className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800 transition-colors"
        >
          Presets
        </Link>
      </div>

      {/* Project Switcher if multiple projects */}
      {projects.length > 1 && (
        <div className="no-scrollbar -mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1">
          <IconFolder size={16} className="text-neutral-400 shrink-0 ml-1" />
          {projects.map((p) => {
            const isCurrent = p.id === selectedProjectId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('projectId', p.id)
                    return next
                  })
                }}
                className={clsx(
                  'max-w-[160px] shrink-0 truncate min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border',
                  isCurrent
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400'
                )}
                title={p.name}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Search and Status Filter */}
      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm kiếm video/audio..."
        filters={filterOptions}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      {/* Loading State */}
      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="py-6 text-center text-sm text-neutral-400">
            Đang tải danh sách media...
          </div>
          {[1, 2, 3].map((i) => (
            <MobileCard key={i} className="animate-pulse space-y-3 p-4">
              <div className="flex gap-3">
                <div className="h-16 w-24 shrink-0 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-3 w-1/4 rounded bg-neutral-100 dark:bg-neutral-800" />
                </div>
              </div>
            </MobileCard>
          ))}
        </div>
      ) : error ? (
        /* Error State */
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="text-red-500 mb-2" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Không thể tải danh sách media
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {error?.message || 'Vui lòng kiểm tra lại kết nối mạng'}
          </p>
          <button
            type="button"
            onClick={() => void refetch?.()}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200"
          >
            <IconRefresh size={14} />
            <span>Thử lại</span>
          </button>
        </MobileCard>
      ) : jobs.length === 0 ? (
        /* Empty Workspace Jobs */
        <MobileEmptyState
          icon={<IconVideo size={36} />}
          title="Chưa có tệp Media nào"
          description="Tải lên tệp video hoặc audio để bắt đầu quy trình phụ đề và lồng tiếng AI."
        />
      ) : filtered.length === 0 ? (
        /* Empty Search Results */
        <MobileEmptyState
          icon={<IconVideo size={36} />}
          title="Không tìm thấy tệp media"
          description="Không có tệp media nào khớp với điều kiện tìm kiếm hoặc bộ lọc."
          action={
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setStatusFilter('ALL')
              }}
              className="rounded-xl bg-neutral-100 dark:bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              Xóa bộ lọc
            </button>
          }
        />
      ) : (
        /* Media Item Cards */
        <div className="space-y-3">
          {filtered.map((item: any) => {
            const itemTitle =
              item.title ||
              item.fileName ||
              item.name ||
              `Tệp media ${item.id?.slice(0, 8) ?? ''}`

            const duration =
              item.duration ||
              (typeof item.durationSeconds === 'number'
                ? formatDuration(item.durationSeconds)
                : typeof item.requestedDurationSeconds === 'number'
                ? formatDuration(item.requestedDurationSeconds)
                : null)

            const progress =
              typeof item.progress === 'number'
                ? item.progress
                : typeof item.progressPercent === 'number'
                ? item.progressPercent
                : item.status === 'COMPLETED'
                ? 100
                : 0

            const isProcessing =
              item.status === 'PROCESSING' ||
              item.status === 'PENDING' ||
              item.status === 'CANCEL_REQUESTED'

            const detailUrl = `/w/${workspaceId}/media/jobs/${item.id}`

            return (
              <Link key={item.id} to={detailUrl} className="block min-w-0">
                <MobileCard interactive className="min-w-0 space-y-3">
                  <div className="flex min-w-0 gap-3">
                    {/* Thumbnail / Duration */}
                    <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
                      <IconVideo size={24} className="text-neutral-400" />
                      {duration && (
                        <span className="absolute bottom-1 right-1 rounded-sm bg-black/70 px-1 py-0.5 text-[9px] font-semibold whitespace-nowrap text-white">
                          {duration}
                        </span>
                      )}
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 min-w-0">
                      <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-white" title={itemTitle}>
                        {itemTitle}
                      </h3>
                      <div className="mt-1 flex min-w-0 items-center flex-wrap gap-1.5">
                        <span
                          className={clsx(
                            'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold border',
                            getStatusBadgeStyle(item.status)
                          )}
                        >
                          {item.status}
                        </span>
                        {item.targetLang && (
                          <span className="shrink-0 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-400 uppercase">
                            {String(item.targetLang).toUpperCase()}
                          </span>
                        )}
                        {(item.type || item.processingMode || item.recipeId) && (
                          <span className="min-w-0 truncate text-[10px] text-neutral-400 max-w-[120px]">
                            {item.recipeId || item.type || item.processingMode}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar for active / processing jobs */}
                  {isProcessing && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-neutral-500">
                        <span>Đang xử lý</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </MobileCard>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
