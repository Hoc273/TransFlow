import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  IconChevronRight,
  IconLanguage,
  IconPlus,
} from '@tabler/icons-react'
import { CreateJobModal } from '@/components/job/CreateJobModal'
import { EmptyState } from '@/components/shared/EmptyState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { getDocumentApi } from '@/api/documents'
import { useJobs } from '@/hooks/useJobs'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { formatDateTime } from '@/lib/format'
import { STALE, queryKeys } from '@/lib/queryClient'
import { asJobStatus } from '@/lib/status'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/** C.6 Translation Job List (Data-Dense) → Editor. */
export function JobListPage() {
  const { t } = useTranslation(['job', 'common', 'dashboard', 'document'])
  const { workspaceId = '', documentId = '' } = useParams()
  const navigate = useNavigate()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)
  const canStart = usePermission('job.start')

  const {
    data: document,
  } = useQuery({
    queryKey: queryKeys.document(workspaceId, documentId),
    queryFn: () => getDocumentApi(workspaceId, documentId),
    enabled: !!workspaceId && !!documentId,
    staleTime: STALE.static,
  })

  const { data: jobs = [], isLoading, isError, error, refetch } = useJobs(
    workspaceId,
    documentId,
  )

  useDocumentTitle(document?.name || t('job:list.title'))

  const [createOpen, setCreateOpen] = useState(false)

  const sorted = useMemo(
    () =>
      [...jobs].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [jobs],
  )

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        {document?.projectId ? (
          <Link
            to={`/w/${workspaceId}/projects/${document.projectId}/documents`}
            className="btn-link"
          >
            {t('document:list.title')}
          </Link>
        ) : (
          <span>{t('document:list.title')}</span>
        )}
        <IconChevronRight size={10} />
        <span>{document?.name || t('job:list.title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{document?.name || t('job:list.title')}</h1>
          <div className="page-subtitle">
            {t('job:list.subtitle')}
            {document && (
              <span className="ml-2 font-mono text-[12px] text-[var(--color-text-tertiary)]">
                · {document.sourceLang}
              </span>
            )}
          </div>
        </div>
        {canStart && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <IconPlus size={16} />
            {t('job:list.create')}
          </button>
        )}
      </div>

      <div className="app-card overflow-hidden">
        {isLoading && (
          <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            icon={<IconLanguage size={40} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-12"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        )}

        {!isLoading && !isError && sorted.length === 0 && (
          <EmptyState
            icon={<IconLanguage size={40} stroke={1.25} />}
            title={t('job:list.emptyTitle')}
            description={t('job:list.emptyDesc')}
            className="py-14"
          >
            {canStart && (
              <button
                type="button"
                className="btn-primary mt-4"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus size={16} />
                {t('job:list.create')}
              </button>
            )}
          </EmptyState>
        )}

        {!isLoading && !isError && sorted.length > 0 && (
          <div className="overflow-x-auto">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('job:list.col.targetLang')}</th>
                  <th>{t('dashboard:col.status')}</th>
                  <th className="col-hide-mobile">{t('job:list.col.provider')}</th>
                  <th className="col-hide-mobile">{t('job:list.col.model')}</th>
                  <th className="col-hide-tablet">{t('dashboard:col.createdAt')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((job) => (
                  <tr
                    key={job.id}
                    className="cursor-pointer"
                    onClick={() =>
                      navigate(`/w/${workspaceId}/jobs/${job.id}/editor`)
                    }
                  >
                    <td className="font-mono font-medium">{job.targetLang}</td>
                    <td>
                      <StatusBadge status={asJobStatus(job.status)} />
                    </td>
                    <td className="text-[var(--color-text-secondary)] col-hide-mobile">
                      {job.providerUsed || '—'}
                    </td>
                    <td className="font-mono text-[12px] text-[var(--color-text-secondary)] col-hide-mobile">
                      {job.modelUsed || '—'}
                    </td>
                    <td className="text-[var(--color-text-secondary)] col-hide-tablet">
                      {job.createdAt ? formatDateTime(job.createdAt, language) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateJobModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        documentId={documentId}
        existingJobs={jobs}
        onCreated={(jobId) => navigate(`/w/${workspaceId}/jobs/${jobId}/editor`)}
      />
    </div>
  )
}
