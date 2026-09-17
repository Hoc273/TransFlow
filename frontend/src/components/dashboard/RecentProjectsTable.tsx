import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconArrowRight, IconChevronRight, IconFolder, IconPlus } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { useProjects } from '@/hooks/useProjects'
import { ApiError } from '@/types/api'

/** Recent projects — Minimalist & Actionable compact view. */
export function RecentProjectsTable() {
  const { t } = useTranslation('dashboard')
  const { workspaceId = '' } = useParams()
  const { data, isLoading, isError, error, isFetching } = useProjects(workspaceId)

  const projects = (data ?? []).slice(0, 5)

  return (
    <div className="app-card flex flex-col h-full" aria-busy={isLoading || isFetching}>
      {/* Header */}
      <div className="app-card-header flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 bg-[var(--color-bg-surface-2)]/30">
        <div className="flex items-center gap-2">
          <IconFolder size={16} className="text-[var(--color-accent)]" />
          <h3 className="font-semibold text-xs text-[var(--color-text-primary)]">
            {t('widget.recentProjects.title')}
          </h3>
        </div>
        <Link to={`/w/${workspaceId}/projects`} className="btn-ghost-sm no-underline flex items-center gap-1 text-[11px] py-1 px-2">
          <span>{t('viewAll')}</span>
          <IconChevronRight size={12} />
        </Link>
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
            icon={<IconFolder size={32} stroke={1.25} />}
            title={t('widget.recentProjects.loadError')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-6"
          />
        )}

        {!isLoading && !isError && projects.length === 0 && (
          <div className="my-auto py-6 px-4 text-center">
            <div className="text-xs font-medium text-[var(--color-text-tertiary)]">
              {t('widget.recentProjects.emptyTitle')}
            </div>
            <Link
              to={`/w/${workspaceId}/projects`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline no-underline"
            >
              <IconPlus size={13} />
              <span>{t('live.quickNewProject')}</span>
            </Link>
          </div>
        )}

        {!isLoading && !isError && projects.length > 0 && (
          <div className="space-y-2">
            {projects.map((p) => {
              const targetPath = `/w/${workspaceId}/media?projectId=${p.id}`

              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-[var(--color-border)]/80 bg-[var(--color-bg-surface-2)]/40 p-3 transition hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-surface-2)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link
                          to={targetPath}
                          className="truncate text-xs font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent)] no-underline"
                          title={p.name}
                        >
                          {p.name}
                        </Link>
                        <span className="shrink-0 rounded bg-[var(--color-bg-surface-3)] px-1.5 py-0.2 text-[9px] font-bold text-[var(--color-text-secondary)] uppercase">
                          {p.sourceLang || '—'}
                        </span>
                      </div>
                      {p.domain && (
                        <div className="mt-1 truncate text-[11px] text-[var(--color-text-tertiary)]">
                          {p.domain}
                        </div>
                      )}
                    </div>

                    <Link
                      to={targetPath}
                      className="shrink-0 inline-flex items-center gap-1 rounded-md bg-[var(--color-accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition no-underline"
                    >
                      <span>{t('continue')}</span>
                      <IconArrowRight size={11} />
                    </Link>
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
