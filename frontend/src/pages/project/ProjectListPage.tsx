import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconArrowRight,
  IconChevronRight,
  IconFolder,
  IconPlus,
  IconVideo,
} from '@tabler/icons-react'
import { CreateProjectModal } from '@/components/project/CreateProjectModal'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { usePermission } from '@/hooks/usePermission'
import { useProjects } from '@/hooks/useProjects'
import { formatLanguageOption } from '@/lib/languages'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { ApiError } from '@/types/api'

/**
 * C.1 Project List — Sleek, Minimalist & Intuitive UX.
 * Fast to scan, zero visual noise, clean table, global ⌘K search.
 */
export function ProjectListPage() {
  const { t } = useTranslation(['project', 'common'])
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((state) => state.language)
  const canCreate = usePermission('project.create')
  useDocumentTitle(t('project:list.title'))

  const { data: projects = [], isLoading, isError, error, refetch } = useProjects(workspaceId)
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{t('project:list.title')}</span>
      </div>

      {/* Header: Title + Action */}
      <div className="page-header flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{t('project:list.title')}</h1>
            {!isLoading && projects.length > 0 && (
              <span className="rounded-full bg-[var(--color-bg-surface-3)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
                {projects.length}
              </span>
            )}
          </div>
          <div className="page-subtitle">{t('project:list.subtitle')}</div>
        </div>

        {canCreate && (
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 shadow-xs"
            onClick={() => setCreateOpen(true)}
          >
            <IconPlus size={15} />
            <span>{t('project:list.create')}</span>
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
            icon={<IconFolder size={36} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-10"
          >
            <button type="button" className="btn-secondary mt-3" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        )}

        {/* Workspace Empty State */}
        {!isLoading && !isError && projects.length === 0 && (
          <EmptyState
            icon={<IconFolder size={36} stroke={1.25} />}
            title={t('project:list.emptyTitle')}
            description={t('project:list.emptyDesc')}
            className="py-12"
          >
            {canCreate && (
              <button
                type="button"
                className="btn-primary mt-3 flex items-center gap-1.5"
                onClick={() => setCreateOpen(true)}
              >
                <IconPlus size={15} />
                <span>{t('project:list.create')}</span>
              </button>
            )}
          </EmptyState>
        )}

        {/* Clean, Readable Table */}
        {!isLoading && !isError && projects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="dd-table">
              <thead>
                <tr>
                  <th className="w-2/5">{t('project:list.col.name')}</th>
                  <th className="col-hide-mobile">{t('project:list.col.sourceLang')}</th>
                  <th className="col-hide-tablet">{t('project:list.col.domain')}</th>
                  <th>{t('project:list.col.media')}</th>
                  <th className="w-12 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const targetPath = `/w/${workspaceId}/media?projectId=${p.id}`
                  const videoCount = p.mediaCount ?? p.documentCount ?? 0

                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(targetPath)}
                      className="group cursor-pointer transition-colors hover:bg-[var(--color-bg-surface-2)]/60"
                    >
                      {/* Name */}
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-transform group-hover:scale-105">
                            <IconFolder size={16} />
                          </div>
                          <span className="font-medium text-xs text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)] transition">
                            {p.name}
                          </span>
                        </div>
                      </td>

                      {/* Source Language */}
                      <td className="col-hide-mobile text-xs text-[var(--color-text-secondary)]">
                        <span className="inline-flex items-center rounded-md bg-[var(--color-bg-surface-3)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--color-text-primary)] uppercase">
                          {p.sourceLang}
                        </span>
                        <span className="ml-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                          {formatLanguageOption(p.sourceLang, language)}
                        </span>
                      </td>

                      {/* Domain */}
                      <td className="col-hide-tablet text-xs text-[var(--color-text-secondary)]">
                        {p.domain || '—'}
                      </td>

                      {/* Videos count */}
                      <td>
                        <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          <IconVideo size={14} className="text-[var(--color-text-tertiary)]" />
                          <span>{t('project:list.videoCount', { count: videoCount })}</span>
                        </div>
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

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        onCreated={(newProjectId) => navigate(`/w/${workspaceId}/media?projectId=${newProjectId}`)}
      />
    </div>
  )
}
