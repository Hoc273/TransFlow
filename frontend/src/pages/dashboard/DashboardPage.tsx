import {
  IconBook2,
  IconChevronRight,
  IconFolder,
  IconRefresh,
  IconStack2,
  IconVideo,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { AiUsageLiveChartsWidget } from '@/components/dashboard/AiUsageLiveChartsWidget'
import { QueueBatchStatusWidget } from '@/components/dashboard/QueueBatchStatusWidget'
import { RecentProjectsTable } from '@/components/dashboard/RecentProjectsTable'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useAuthStore } from '@/store/authStore'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryClient'

/** Dashboard (Phase B.5) — Live AI telemetry, active batches, recent projects. */
export function DashboardPage() {
  const { t } = useTranslation(['dashboard', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const qc = useQueryClient()
  useDocumentTitle(t('dashboard:title'))

  const refreshAll = () => {
    if (!workspaceId) return
    // Prefix keys so param variants (limit/offset/filters) all refresh.
    void qc.invalidateQueries({ queryKey: ['usage', workspaceId] })
    void qc.invalidateQueries({ queryKey: queryKeys.batches(workspaceId) })
    void qc.invalidateQueries({ queryKey: ['notifications', workspaceId] })
    void qc.invalidateQueries({ queryKey: queryKeys.projects(workspaceId) })
  }

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{t('common:nav.dashboard')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard:title')}</h1>
          <div className="page-subtitle">{t('dashboard:subtitle')}</div>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="flex cursor-pointer items-center gap-2 border-none bg-transparent text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition"
        >
          <IconRefresh size={14} />
          <span>{t('dashboard:updatedAt')}</span>
        </button>
      </div>

      {/* Quick Launch Bar */}
      <div className="mb-6 flex flex-wrap items-center gap-2.5">
        <Link
          to={`/w/${workspaceId}/projects`}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text-primary)] shadow-xs transition hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-hover)] no-underline"
        >
          <IconFolder size={15} className="text-[var(--color-accent)]" />
          <span>{t('dashboard:live.quickNewProject')}</span>
        </Link>
        <Link
          to={`/w/${workspaceId}/batches`}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text-primary)] shadow-xs transition hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-hover)] no-underline"
        >
          <IconStack2 size={15} className="text-[#38bdf8]" />
          <span>{t('dashboard:live.quickNewBatch')}</span>
        </Link>
        <Link
          to={`/w/${workspaceId}/media`}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text-primary)] shadow-xs transition hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-hover)] no-underline"
        >
          <IconVideo size={15} className="text-[#a855f7]" />
          <span>{t('dashboard:live.quickMedia')}</span>
        </Link>
        <Link
          to={`/w/${workspaceId}/glossaries`}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--color-text-primary)] shadow-xs transition hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-hover)] no-underline"
        >
          <IconBook2 size={15} className="text-[#10b981]" />
          <span>{t('dashboard:live.quickGlossary')}</span>
        </Link>
      </div>

      {/* Unified Live AI Analytics & KPI Summary */}
      <AiUsageLiveChartsWidget />

      {/* Row 2: Active Batches Queue & Recent Projects in 2-column side-by-side grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <QueueBatchStatusWidget />
        <RecentProjectsTable />
      </div>
    </div>
  )
}
