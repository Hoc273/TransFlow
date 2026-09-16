import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconArrowRight,
  IconChevronRight,
  IconPlus,
  IconRefresh,
  IconStack2,
} from '@tabler/icons-react'
import { CreateBatchModal } from '@/components/batch/CreateBatchModal'
import { EmptyState } from '@/components/shared/EmptyState'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useBatches } from '@/hooks/useBatches'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { useProjects } from '@/hooks/useProjects'
import { formatDateTime } from '@/lib/format'
import { asJobStatus, progressVariant } from '@/lib/status'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/**
 * C.4 Batch Tracking List — Minimalist, Clean & Intuitive UX.
 * Fast to scan, zero visual noise, responsive table.
 */
export function BatchListPage() {
  const { t } = useTranslation(['batch', 'common', 'dashboard'])
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
  const canCreate = usePermission('batch.create')
  useDocumentTitle(t('batch:list.title'))

  const {
    data: batches = [],
    isLoading,
    isError,
    error,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useBatches(workspaceId)

  const { data: projects = [] } = useProjects(workspaceId)
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]))
    return (id: string) => map.get(id) || id.slice(0, 8)
  }, [projects])

  const [createOpen, setCreateOpen] = useState(false)

  const hasActive = useMemo(() => {
    return batches.some((b) => {
      const s = String(b.status).toUpperCase()
      return s === 'PENDING' || s === 'PROCESSING'
    })
  }, [batches])

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{t('batch:list.title')}</span>
      </div>

      {/* Header: Title + Action */}
      <div className="page-header flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('batch:list.title')}</h1>
            {!isLoading && batches.length > 0 && (
              <span className="rounded-full bg-[var(--color-bg-surface-3)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
                {batches.length}
              </span>
            )}
          </div>
          <div className="page-subtitle flex items-center gap-1.5 flex-wrap">
            <span>{t('batch:list.subtitle')}</span>
            {hasActive && isFetching && (
              <span className="inline-flex items-center gap-1 text-[var(--color-accent)]">
                <IconRefresh size={12} className="animate-spin" />
                <span>{t('batch:list.updating')}</span>
              </span>
            )}
            {dataUpdatedAt > 0 && (
              <span className="text-[var(--color-text-tertiary)] col-hide-mobile">
                · {t('batch:list.updatedAt', { time: formatDateTime(new Date(dataUpdatedAt).toISOString(), language) })}
              </span>
            )}
          </div>
        </div>

        {canCreate && (
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 shadow-xs"
            onClick={() => setCreateOpen(true)}
          >
            <IconPlus size={15} />
            <span>{t('batch:list.create')}</span>
          </button>
        )}
      </div>

      {/* Main Table Card */}
      <div className="app-card overflow-hidden">
        {isLoading && (
          <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            icon={<IconStack2 size={36} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-10"
          >
            <button type="button" className="btn-secondary mt-3" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        )}

        {/* Global Empty State */}
        {!isLoading && !isError && batches.length === 0 && (
          <EmptyState
            icon={<IconStack2 size={36} stroke={1.25} />}
            title={t('batch:list.emptyTitle')}
            description={t('batch:list.emptyDesc')}
            className="py-12"
          >
            {canCreate && (
              <button
                type="button"
                className="btn-primary mt-3 flex items-center gap-1.5"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus size={15} />
                <span>{t('batch:list.create')}</span>
              </button>
            )}
          </EmptyState>
        )}

        {/* Clean, Readable Table */}
        {!isLoading && !isError && batches.length > 0 && (
          <div className="overflow-x-auto">
            <table className="dd-table">
              <thead>
                <tr>
                  <th className="w-1/3">{t('dashboard:col.name')}</th>
                  <th className="col-hide-mobile">{t('batch:list.col.project')}</th>
                  <th>{t('dashboard:col.status')}</th>
                  <th style={{ width: 170 }}>{t('dashboard:col.progress')}</th>
                  <th className="col-hide-tablet">{t('dashboard:col.createdAt')}</th>
                  <th className="w-10 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const done = batch.completedDocuments + batch.failedDocuments
                  const total = batch.totalDocuments || 1
                  const status = asJobStatus(String(batch.status))
                  const targetPath = `/w/${workspaceId}/batches/${batch.id}`

                  return (
                    <tr
                      key={batch.id}
                      onClick={() => navigate(targetPath)}
                      className="group cursor-pointer transition-colors hover:bg-[var(--color-bg-surface-2)]/60"
                    >
                      {/* Name */}
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-transform group-hover:scale-105">
                            <IconStack2 size={16} />
                          </div>
                          <span className="font-medium text-xs text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition">
                            {batch.name || batch.id.slice(0, 8)}
                          </span>
                        </div>
                      </td>

                      {/* Project */}
                      <td className="col-hide-mobile text-xs text-[var(--color-text-secondary)]">
                        {projectName(batch.projectId)}
                      </td>

                      {/* Status */}
                      <td>
                        <StatusBadge status={status} />
                      </td>

                      {/* Progress */}
                      <td>
                        <div className="flex items-center gap-2">
                          <ProgressBar
                            value={done}
                            max={total}
                            variant={progressVariant(String(batch.status))}
                            className="flex-1 h-1.5"
                          />
                          <span className="text-[11px] font-mono tabular-nums text-[var(--color-text-tertiary)]">
                            {done}/{batch.totalDocuments}
                          </span>
                        </div>
                      </td>

                      {/* Created At */}
                      <td className="text-xs text-[var(--color-text-tertiary)] col-hide-tablet">
                        {formatDateTime(batch.createdAt, language)}
                      </td>

                      {/* Action Arrow */}
                      <td className="text-right">
                        <span className="inline-flex items-center text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--color-accent)]">
                          <IconArrowRight size={15} />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateBatchModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
      />
    </div>
  )
}
