import { useParams, Link } from 'react-router-dom'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconFileText,
  IconRefresh,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { MobileCard } from '../../components/MobileCard'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { useBatchDetail, useRetryBatchDocument } from '@/hooks/useBatches'
import type { BatchDetail, BatchDocument } from '@/types/batch'

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

export function MobileBatchDetailPage() {
  const { workspaceId = '', batchId = '' } = useParams<{ workspaceId: string; batchId: string }>()

  const detailResult = useBatchDetail(workspaceId, batchId) as any
  const retryMutation = useRetryBatchDocument(workspaceId, batchId)

  const batch: BatchDetail | undefined = detailResult.data ?? detailResult.batch
  const rawItems: any[] = batch?.documents ?? detailResult.items ?? []
  const documents: (BatchDocument & { id?: string })[] = rawItems

  const isLoading = Boolean(detailResult.isLoading)
  const error = detailResult.error
  const refetch = detailResult.refetch
  const rerunItem = detailResult.rerunItem

  const totalDocs = batch?.totalDocuments ?? (batch as any)?.totalFiles ?? 0
  const completedDocs = batch?.completedDocuments ?? (batch as any)?.completedFiles ?? 0
  const failedDocs = batch?.failedDocuments ?? (batch as any)?.failedFiles ?? 0
  const progress =
    typeof (batch as any)?.progress === 'number'
      ? (batch as any).progress
      : totalDocs > 0
      ? Math.round((completedDocs / totalDocs) * 100)
      : 0

  const isPartial =
    String(batch?.status).toUpperCase() === 'PARTIALLY_FAILED' || failedDocs > 0

  const handleRetryDocument = (docId: string) => {
    if (rerunItem) {
      rerunItem(docId)
    } else {
      retryMutation.mutate(docId)
    }
  }

  const backUrl = workspaceId ? `/w/${workspaceId}/batches` : '/batches'

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Top Bar / Back Navigation */}
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to={backUrl}
          aria-label="Quay lại danh sách lô"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800 transition-colors"
        >
          <IconArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-neutral-900 dark:text-white" title={batch?.name}>
            {batch?.name || 'Chi tiết lô'}
          </h1>
          <span className="block truncate text-[11px] font-mono text-neutral-400" title={batchId}>
            ID: {batchId.length > 12 ? `${batchId.slice(0, 12)}…` : batchId}
          </span>
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="py-6 text-center text-sm text-neutral-400">
            Đang tải chi tiết lô...
          </div>
          <MobileCard className="animate-pulse space-y-3 p-4">
            <div className="h-4 w-1/3 rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-3 w-1/2 rounded bg-neutral-100 dark:bg-neutral-800" />
            <div className="h-2 w-full rounded bg-neutral-100 dark:bg-neutral-800" />
          </MobileCard>
          {[1, 2, 3].map((i) => (
            <MobileCard key={i} className="animate-pulse flex items-center justify-between p-3.5">
              <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-4 w-12 rounded bg-neutral-100 dark:bg-neutral-800" />
            </MobileCard>
          ))}
        </div>
      ) : error ? (
        /* Error State */
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="text-red-500 mb-2" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Không thể tải chi tiết lô
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
      ) : (
        <div className="space-y-4">
          {/* Summary Card */}
          <MobileCard className="space-y-3 bg-gradient-to-br from-white to-primary/5 dark:from-neutral-900 dark:to-primary/10 border-primary/20 p-4">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-neutral-600 dark:text-neutral-400">
                Trạng thái
              </span>
              <span
                className={clsx(
                  'rounded-full px-2.5 py-0.5 text-xs font-bold border',
                  getStatusBadgeStyle(batch?.status)
                )}
              >
                {batch?.status}
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-medium text-neutral-600 dark:text-neutral-400">
                  Tiến độ tổng thể
                </span>
                <span className="font-bold text-neutral-900 dark:text-white">
                  {progress}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
              </div>
            </div>

            <div className="flex justify-between items-center text-[11px] text-neutral-500 dark:text-neutral-400 pt-1 border-t border-neutral-100 dark:border-neutral-800">
              <span>
                Tài liệu: {completedDocs}/{totalDocs} hoàn thành
              </span>
              {failedDocs > 0 && (
                <span className="text-red-500 font-medium">
                  {failedDocs} tài liệu lỗi
                </span>
              )}
            </div>
          </MobileCard>

          {/* Partial failure notice banner */}
          {isPartial && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-xs text-amber-900 dark:text-amber-200">
              <IconAlertTriangle size={18} className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <span className="font-bold block">Thành công một phần</span>
                <span className="text-[11px] text-amber-800 dark:text-amber-300">
                  {completedDocs}/{totalDocs} tài liệu hoàn thành, {failedDocs} tài liệu lỗi.
                  Bạn có thể bấm Thử lại cho từng tệp bên dưới.
                </span>
              </div>
            </div>
          )}

          {/* Documents Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Danh sách tệp trong lô
              </h2>
              <span className="text-xs text-neutral-400">
                {documents.length} tệp
              </span>
            </div>

            {documents.length === 0 ? (
              <MobileEmptyState
                icon={<IconFileText size={32} />}
                title="Chưa có tài liệu nào"
                description="Lô xử lý này hiện chưa chứa tài liệu."
              />
            ) : (
              <div className="space-y-2">
                {documents.map((doc, idx) => {
                  const docId = doc.documentId || doc.id || `doc-${idx}`
                  const hasFailedJob = doc.jobs?.some(
                    (j: any) => String(j.status).toUpperCase() === 'FAILED'
                  )
                  const isFailed =
                    String(doc.status).toUpperCase() === 'FAILED' || hasFailedJob
                  const isRetrying =
                    retryMutation?.isPending && retryMutation?.variables === docId

                  return (
                    <MobileCard
                      key={docId}
                      className="flex min-w-0 items-center justify-between p-3.5 gap-3"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div className="mt-0.5 shrink-0 text-neutral-400">
                          <IconFileText size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-white" title={doc.name}>
                              {doc.name}
                            </span>
                            {doc.sourceLang && (
                              <span className="shrink-0 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-neutral-600 dark:text-neutral-300 uppercase">
                                {doc.sourceLang}
                              </span>
                            )}
                          </div>

                          <div className="flex min-w-0 items-center gap-1.5 mt-1 flex-wrap">
                            <span
                              className={clsx(
                                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap border',
                                getStatusBadgeStyle(doc.status)
                              )}
                            >
                              {doc.status}
                            </span>

                            {doc.jobs && doc.jobs.length > 0 && (
                              <div className="flex min-w-0 items-center gap-1 flex-wrap">
                                {doc.jobs.map((job: any) => (
                                  <span
                                    key={job.jobId}
                                    className="max-w-full truncate rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-600 dark:text-neutral-400"
                                  >
                                    {job.targetLang?.toUpperCase()}: {job.status}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action / Status indicator */}
                      <div className="shrink-0">
                        {isFailed ? (
                          <button
                            type="button"
                            disabled={isRetrying}
                            onClick={() => handleRetryDocument(docId)}
                            className="flex min-h-[36px] items-center gap-1 whitespace-nowrap rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 transition-colors disabled:opacity-50"
                          >
                            <IconRefresh
                              size={14}
                              className={clsx(isRetrying && 'animate-spin')}
                            />
                            <span>{isRetrying ? 'Đang thử…' : 'Thử lại'}</span>
                          </button>
                        ) : String(doc.status).toUpperCase() === 'COMPLETED' ? (
                          <div className="p-1 text-emerald-500">
                            <IconCheck size={18} />
                          </div>
                        ) : (
                          <div className="p-1 text-neutral-400">
                            <IconClock size={16} />
                          </div>
                        )}
                      </div>
                    </MobileCard>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
