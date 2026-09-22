import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconPlus, IconStack2 } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatusBadge, type JobStatus } from '@/components/shared/StatusBadge'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { useActiveBatches } from '@/hooks/useBatches'
import { ApiError } from '@/types/api'

function asJobStatus(status: string): JobStatus {
  const s = status.toUpperCase()
  if (
    s === 'PENDING' ||
    s === 'PROCESSING' ||
    s === 'COMPLETED' ||
    s === 'PARTIALLY_FAILED' ||
    s === 'FAILED' ||
    s === 'CANCELLED'
  ) {
    return s
  }
  return 'PENDING'
}

function progressVariant(status: string): 'default' | 'success' | 'warn' | 'error' {
  const s = status.toUpperCase()
  if (s === 'COMPLETED') return 'success'
  if (s === 'PARTIALLY_FAILED') return 'warn'
  if (s === 'FAILED') return 'error'
  return 'default'
}

/** Active batches — Compact & Actionable view. */
export function QueueBatchStatusWidget() {
  const { t } = useTranslation('dashboard')
  const { workspaceId = '' } = useParams()
  const { active, isLoading, isError, error, isFetching } = useActiveBatches(workspaceId)

  return (
    <div className="app-card flex flex-col h-full" aria-busy={isLoading || isFetching}>
      {/* Header */}
      <div className="app-card-header flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 bg-[var(--color-bg-surface-2)]/30">
        <div className="flex items-center gap-2">
          <IconStack2 size={16} className="text-[#38bdf8]" />
          <h3 className="font-semibold text-xs text-[var(--color-text-primary)]">
            {t('widget.queue.title')}
          </h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-500 ring-1 ring-emerald-500/30">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
            {t('live.indicator')}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 flex-1 flex flex-col">
        {isLoading && (
          <div className="py-8 text-center text-xs text-[var(--color-text-tertiary)]">
            {t('loading')}
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            icon={<IconStack2 size={32} stroke={1.25} />}
            title={t('widget.queue.loadError')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-6"
          />
        )}

        {!isLoading && !isError && active.length === 0 && (
          <div className="my-auto py-6 px-4 text-center">
            <div className="text-xs font-medium text-[var(--color-text-tertiary)]">
              {t('widget.queue.emptyTitle')}
            </div>
            <Link
              to={`/w/${workspaceId}/batches`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline no-underline"
            >
              <IconPlus size={13} />
              <span>{t('live.quickNewBatch')}</span>
            </Link>
          </div>
        )}

        {!isLoading && !isError && active.length > 0 && (
          <div className="space-y-2">
            {active.map((batch) => {
              const done = (batch.completedDocuments ?? 0) + (batch.failedDocuments ?? 0)
              const total = batch.totalDocuments || 1
              const pct = Math.round((done / total) * 100)
              const isProcessing = String(batch.status).toUpperCase() === 'PROCESSING'
              const targetPath = `/w/${workspaceId}/batches/${batch.id}`

              return (
                <div
                  key={batch.id}
                  className="rounded-lg border border-[var(--color-border)]/80 bg-[var(--color-bg-surface-2)]/40 p-3 transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-surface-2)]"
                >
                  {/* Line 1: Title + Badge + Action */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Link
                        to={targetPath}
                        className="truncate text-xs font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)] no-underline"
                        title={batch.name || batch.id}
                      >
                        {batch.name || batch.id.slice(0, 12)}
                      </Link>
                      <StatusBadge status={asJobStatus(String(batch.status))} />
                    </div>

                    <Link
                      to={targetPath}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md bg-[var(--color-accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition no-underline"
                    >
                      <span>{t('continue')}</span>
                      <IconArrowRight size={11} />
                    </Link>
                  </div>

                  {/* Line 2: Shimmer Progress + Percent */}
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <ProgressBar
                      value={done}
                      max={total}
                      shimmer={isProcessing}
                      variant={progressVariant(String(batch.status))}
                      className="flex-1 h-1.5 rounded-full overflow-hidden"
                    />
                    <span className="shrink-0 text-[11px] tabular-nums font-medium text-[var(--color-text-secondary)]">
                      {done}/{batch.totalDocuments} ({pct}%)
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
