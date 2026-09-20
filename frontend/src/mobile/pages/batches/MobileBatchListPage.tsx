import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IconAlertCircle, IconLayersLinked, IconRefresh } from '@tabler/icons-react'
import clsx from 'clsx'
import { MobileCard } from '../../components/MobileCard'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useBatches } from '@/hooks/useBatches'
import type { BatchSummary } from '@/types/batch'

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

export function MobileBatchListPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const result = useBatches(workspaceId) as any
  const batches: BatchSummary[] = result.data ?? result.batches ?? []
  const isLoading = Boolean(result.isLoading)
  const error = result.error
  const refetch = result.refetch

  const [search, setSearch] = useState('')

  const filtered = batches.filter((b) => {
    const term = search.toLowerCase()
    return (
      (b.name && b.name.toLowerCase().includes(term)) ||
      (b.id && b.id.toLowerCase().includes(term)) ||
      (b.status && String(b.status).toLowerCase().includes(term))
    )
  })

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex min-w-0 items-baseline gap-1.5 text-xl font-bold text-neutral-900 dark:text-white">
            <span className="truncate">Lô xử lý</span>
            <span className="shrink-0 text-xs font-normal text-neutral-400 dark:text-neutral-500">(Batches)</span>
          </h1>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {batches.length > 0 ? `${batches.length} đợt xử lý hàng loạt` : 'Theo dõi tiến độ dịch theo lô'}
          </p>
        </div>
      </div>

      {/* Search Filter */}
      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm kiếm lô xử lý..."
      />

      {/* Loading State */}
      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="py-6 text-center text-sm text-neutral-400">
            Đang tải lô xử lý...
          </div>
          {[1, 2, 3].map((i) => (
            <MobileCard key={i} className="animate-pulse space-y-3 p-4">
              <div className="flex justify-between">
                <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-4 w-16 rounded-full bg-neutral-100 dark:bg-neutral-800" />
              </div>
              <div className="h-3 w-1/3 rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="h-2 w-full rounded bg-neutral-100 dark:bg-neutral-800" />
            </MobileCard>
          ))}
        </div>
      ) : error ? (
        /* Error State */
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="text-red-500 mb-2" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Không thể tải danh sách lô xử lý
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
      ) : batches.length === 0 ? (
        /* Empty Workspace Batches */
        <MobileEmptyState
          icon={<IconLayersLinked size={36} />}
          title="Chưa có lô xử lý nào"
          description="Các tệp được xử lý đồng thời sẽ hiển thị tại đây."
        />
      ) : filtered.length === 0 ? (
        /* Empty Search Results */
        <MobileEmptyState
          icon={<IconLayersLinked size={36} />}
          title="Không tìm thấy lô xử lý"
          description="Không có lô xử lý nào khớp với từ khóa tìm kiếm."
          action={
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-xl bg-neutral-100 dark:bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              Xóa tìm kiếm
            </button>
          }
        />
      ) : (
        /* Batch List */
        <div className="space-y-3">
          {filtered.map((b) => {
            const totalDocs = b.totalDocuments ?? (b as any).totalFiles ?? 0
            const completedDocs = b.completedDocuments ?? (b as any).completedFiles ?? 0
            const failedDocs = b.failedDocuments ?? (b as any).failedFiles ?? 0
            const progress =
              typeof (b as any).progress === 'number'
                ? (b as any).progress
                : totalDocs > 0
                ? Math.round((completedDocs / totalDocs) * 100)
                : 0

            const detailUrl = `/w/${workspaceId}/batches/${b.id}`

            return (
              <MobileCard key={b.id} className="min-w-0 space-y-3 p-4">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <Link
                    to={detailUrl}
                    className="font-semibold text-sm text-neutral-900 dark:text-white hover:text-primary transition-colors flex-1 min-w-0 truncate"
                  >
                    {b.name || b.id.slice(0, 8)}
                  </Link>
                  <span
                    className={clsx(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap border',
                      getStatusBadgeStyle(b.status)
                    )}
                  >
                    {b.status}
                  </span>
                </div>

                <div className="flex min-w-0 flex-wrap justify-between items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>
                    Số tệp: {completedDocs}/{totalDocs}
                    {failedDocs > 0 && (
                      <span className="ml-1 text-red-500 font-medium">({failedDocs} lỗi)</span>
                    )}
                  </span>
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                    {progress}%
                  </span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
              </MobileCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
