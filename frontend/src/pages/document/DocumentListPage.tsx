import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconChevronRight,
  IconFileText,
  IconPlus,
  IconStack2,
} from '@tabler/icons-react'
import { CreateBatchModal } from '@/components/batch/CreateBatchModal'
import { CreateDocumentModal } from '@/components/document/CreateDocumentModal'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useDocuments } from '@/hooks/useDocuments'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { useProjects } from '@/hooks/useProjects'
import { formatDateTime } from '@/lib/format'
import { asJobStatus } from '@/lib/status'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/** C.2 Document List + intake — list by project, paste/upload, batch entry. */
export function DocumentListPage() {
  const { t } = useTranslation(['document', 'common', 'dashboard', 'batch'])
  const { workspaceId = '', projectId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
  const canUpload = usePermission('document.upload')
  const canBatch = usePermission('batch.create')

  const { data: projects = [] } = useProjects(workspaceId)
  const project = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  )
  useDocumentTitle(project?.name || t('document:list.title'))

  const { data: documents = [], isLoading, isError, error, refetch } = useDocuments(
    workspaceId,
    projectId,
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <Link to={`/w/${workspaceId}/projects`} className="btn-link">
          {t('document:list.projects')}
        </Link>
        <IconChevronRight size={10} />
        <span>{project?.name || t('document:list.title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{project?.name || t('document:list.title')}</h1>
          <div className="page-subtitle">
            {t('document:list.subtitle')}
            {project && (
              <span className="ml-2 font-mono text-[12px] text-[var(--color-text-tertiary)]">
                · {project.sourceLang}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canBatch && (
            <button type="button" className="btn-secondary" onClick={() => setBatchOpen(true)}>
              <IconStack2 size={16} />
              {t('document:list.batchUpload')}
            </button>
          )}
          {canUpload && (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <IconPlus size={16} />
              {t('document:list.create')}
            </button>
          )}
        </div>
      </div>

      <div className="app-card overflow-hidden">
        {isLoading && (
          <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            icon={<IconFileText size={40} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-12"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        )}

        {!isLoading && !isError && documents.length === 0 && (
          <EmptyState
            icon={<IconFileText size={40} stroke={1.25} />}
            title={t('document:list.emptyTitle')}
            description={t('document:list.emptyDesc')}
            className="py-14"
          >
            {canUpload && (
              <button
                type="button"
                className="btn-primary mt-4"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus size={16} />
                {t('document:list.create')}
              </button>
            )}
          </EmptyState>
        )}

        {!isLoading && !isError && documents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('dashboard:col.name')}</th>
                  <th className="col-hide-mobile">{t('dashboard:col.sourceLang')}</th>
                  <th>{t('dashboard:col.status')}</th>
                  <th className="col-hide-tablet">{t('document:list.col.origin')}</th>
                  <th className="col-hide-tablet">{t('dashboard:col.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">
                      <Link
                        to={`/w/${workspaceId}/documents/${d.id}/jobs`}
                        className="btn-link font-medium"
                      >
                        {d.name}
                      </Link>
                    </td>
                    <td className="font-mono text-[12px] col-hide-mobile">{d.sourceLang}</td>
                    <td>
                      <StatusBadge status={asJobStatus(d.status)} />
                    </td>
                    <td className="col-hide-tablet">
                      <span className="phase-badge">{d.origin}</span>
                    </td>
                    <td className="text-[var(--color-text-secondary)] col-hide-tablet">
                      {d.createdAt ? formatDateTime(d.createdAt, language) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateDocumentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        projectId={projectId}
        defaultSourceLang={project?.sourceLang}
      />

      <CreateBatchModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        workspaceId={workspaceId}
        defaultProjectId={projectId}
      />
    </div>
  )
}
