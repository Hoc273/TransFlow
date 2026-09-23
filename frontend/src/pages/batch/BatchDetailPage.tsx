import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconChevronRight, IconDeviceDesktop, IconRefresh, IconStack2 } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useBatchDetail, useDownloadBulkJobs, useRetryBatchDocument } from '@/hooks/useBatches'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { asJobStatus, progressVariant } from '@/lib/status'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/** C.5 Batch Detail (DD) — poll 5s, partial-failure banner, per-document retry. */
export function BatchDetailPage() {
  const { t } = useTranslation(['batch', 'common', 'dashboard'])
  const { workspaceId = '', batchId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
  const canRetry = usePermission('batch.retry')
  const canDownload = usePermission('batch.download')

  const { data, isLoading, isError, error, isFetching, dataUpdatedAt, refetch } = useBatchDetail(
    workspaceId,
    batchId,
  )
  const retry = useRetryBatchDocument(workspaceId, batchId)
  const download = useDownloadBulkJobs(workspaceId, data?.projectId)
  const [downloadError, setDownloadError] = useState(false)
  const [skippedCount, setSkippedCount] = useState(0)

  const completedJobIds = (data?.documents ?? [])
    .flatMap((d) => d.jobs)
    .filter((j) => String(j.status).toUpperCase() === 'COMPLETED')
    .map((j) => (j as { id?: string; jobId?: string }).id || (j as { id?: string; jobId?: string }).jobId || '')
    .filter(Boolean)

  const handleDownload = () => {
    setDownloadError(false)
    setSkippedCount(0)
    void download
      .mutateAsync(completedJobIds)
      .then((res: import('@/types/batch').BulkDownloadResult) => {
        if (res.skipped?.length) setSkippedCount(res.skipped.length)
        if (res.downloadUrl) {
          window.open(res.downloadUrl, '_blank', 'noopener,noreferrer')
        } else {
          setDownloadError(true)
        }
      })
      .catch(() => {
        setDownloadError(true)
      })
  }

  useDocumentTitle(data?.name || t('batch:detail.title'))

  const done = data ? (data.completedDocuments ?? 0) + (data.failedDocuments ?? 0) : 0
  const total = data?.totalDocuments || 1
  const status = asJobStatus(data?.status)
  const isPartial = status === 'PARTIALLY_FAILED'

  return (
    <div>
      <div className="batch-mobile-banner md:hidden">
        <IconDeviceDesktop size={18} />
        {t('batch:detail.mobileBanner')}
      </div>

      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <Link to={`/w/${workspaceId}/batches`} className="btn-link">
          {t('batch:list.title')}
        </Link>
        <IconChevronRight size={10} />
        <span>{data?.name || batchId.slice(0, 8)}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{data?.name || t('batch:detail.title')}</h1>
          <div className="page-subtitle flex flex-wrap items-center gap-2">
            {data && <StatusBadge status={status} />}
            {isFetching && (
              <span className="text-[var(--color-accent)]">{t('batch:list.updating')}</span>
            )}
            {dataUpdatedAt > 0 && (
              <span
                className="text-[var(--color-text-tertiary)]"
                title={formatDateTime(new Date(dataUpdatedAt).toISOString(), language)}
              >
                {t('batch:detail.lastUpdated', {
                  relative: formatRelativeTime(
                    new Date(dataUpdatedAt).toISOString(),
                    language,
                  ),
                })}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canDownload && (
            <button
              type="button"
              className="btn-secondary"
              disabled={!completedJobIds.length || download.isPending}
              onClick={handleDownload}
            >
              {download.isPending
                ? t('batch:detail.downloading')
                : t('batch:detail.downloadZip')}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => void refetch()}>
            <IconRefresh size={16} />
            {t('common:retry')}
          </button>
        </div>
      </div>

      {downloadError && (
        <p className="mt-2 text-sm text-[var(--color-status-failed)]">
          {t('batch:detail.downloadFailed')}
        </p>
      )}

      {skippedCount > 0 && (
        <div className="mt-2 flex gap-3 rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
          <div>
            <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
              {t('batch:detail.skippedNotice', { count: skippedCount })}
            </p>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="app-card py-12 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common:loading')}
        </div>
      )}

      {isError && !isLoading && (
        <div className="app-card">
          <EmptyState
            icon={<IconStack2 size={40} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-12"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className="app-card mb-4 p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
              <span>{t('dashboard:col.progress')}</span>
              <span className="tabular-nums">
                {done}/{data.totalDocuments} · {data.failedDocuments} {t('batch:detail.failed')}
              </span>
            </div>
            <ProgressBar
              value={done}
              max={total}
              variant={progressVariant(String(data.status))}
            />
          </div>

          {isPartial && (
            <div className="mb-4 flex gap-3 rounded-lg border border-[var(--color-status-partial)] bg-[var(--color-status-partial-bg)] px-4 py-3 text-sm text-[var(--color-text-primary)]">
              <IconAlertTriangle size={20} className="shrink-0 text-[var(--color-status-partial)]" />
              <div>
                <div className="font-semibold">{t('batch:detail.partialTitle')}</div>
                <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
                  {t('batch:detail.partialBody', {
                    ok: data.completedDocuments,
                    total: data.totalDocuments,
                    failed: data.failedDocuments,
                  })}
                </p>
              </div>
            </div>
          )}

          <div className="app-card overflow-hidden">
            <div className="app-card-header">
              <div className="app-card-title">{t('batch:detail.documents')}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('batch:detail.col.document')}</th>
                    <th className="col-hide-tablet">{t('batch:detail.col.sourceLang')}</th>
                    <th>{t('dashboard:col.status')}</th>
                    <th>{t('batch:detail.col.jobs')}</th>
                    {canRetry && <th style={{ width: 100 }} className="col-hide-mobile">{t('batch:detail.col.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {(data.documents ?? []).map((doc) => {
                    const docStatus = asJobStatus(String(doc.status))
                    const hasFailedJob = doc.jobs.some(
                      (j) => String(j.status).toUpperCase() === 'FAILED',
                    )
                    const retrying =
                      retry.isPending && retry.variables === doc.documentId
                    return (
                      <tr key={doc.documentId}>
                        <td className="font-medium">{doc.name}</td>
                        <td className="uppercase col-hide-tablet">{doc.sourceLang}</td>
                        <td>
                          <StatusBadge status={docStatus} />
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {doc.jobs.map((job) => (
                              <span
                                key={job.id || (job as any).jobId}
                                className="inline-flex items-center gap-1 rounded bg-[var(--color-bg-surface-2)] px-1.5 py-0.5 text-[11px]"
                              >
                                <span className="font-medium uppercase">{job.targetLang}</span>
                                <StatusBadge status={asJobStatus(String(job.status))} />
                              </span>
                            ))}
                          </div>
                        </td>
                        {canRetry && (
                          <td className="col-hide-mobile">
                            {hasFailedJob && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                disabled={retry.isPending}
                                onClick={() => retry.mutate(doc.documentId)}
                              >
                                <IconRefresh size={14} />
                                {retrying
                                  ? t('batch:detail.retrying')
                                  : t('batch:detail.retry')}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {(data.documents ?? []).length === 0 && (
                <EmptyState
                  title={t('batch:detail.noDocuments')}
                  className="py-10"
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
