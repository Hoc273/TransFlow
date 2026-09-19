import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconChevronLeft,
  IconChevronRight,
  IconFolder,
  IconList,
  IconPlus,
  IconRefresh,
  IconUpload,
  IconVideo,
} from '@tabler/icons-react'
import { MediaStudioNav } from '@/components/media-studio/MediaStudioNav'
import { StageBadge } from '@/components/media-studio/StageBadge'
import { StageLegend } from '@/components/media-studio/StageLegend'
import { StudioAccordion, type StudioPanel } from '@/components/media-studio/StudioAccordion'
import { UploadConsentPanel } from '@/components/media-studio/UploadConsentPanel'
import { EmptyState } from '@/components/shared/EmptyState'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useMediaJobs } from '@/hooks/useMedia'
import { useProjects } from '@/hooks/useProjects'
import {
  currentStage,
  domainPhaseLabelKey,
  isActiveMediaJobStatus,
  overallProgress,
  recipeLabelKey,
  recipeModeBadgeClass,
} from '@/lib/media'
import { formatRelativeTime } from '@/lib/format'
import { formatLanguageOption } from '@/lib/languages'
import { asJobStatus } from '@/lib/status'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import type { MediaJob } from '@/types/media'

const PAGE_SIZE = 8

/**
 * Media Studio hub (M8) — design 0 overview:
 * accordion [0] job list, [1] upload+consent; click job → pipeline detail.
 */
export function MediaListPage() {
  const { t } = useTranslation(['media', 'common'])
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryProjectId = searchParams.get('projectId') || ''

  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const language = useUiStore((s) => s.language)

  const { data: projects = [] } = useProjects(workspaceId)
  const [projectId, setProjectId] = useState(queryProjectId)
  const [openPanel, setOpenPanel] = useState<string | null>('overview')
  const [page, setPage] = useState(0)

  // Sync state if query param in URL changes
  useEffect(() => {
    if (queryProjectId !== projectId) {
      setProjectId(queryProjectId)
    }
  }, [queryProjectId])

  useDocumentTitle(t('media:title'))

  const {
    data: jobs = [],
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useMediaJobs(workspaceId, projectId || undefined)

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  )

  const activeCount = useMemo(
    () => jobs.filter((j) => isActiveMediaJobStatus(j.status)).length,
    [jobs],
  )

  // Reset page when project or job list size changes.
  useEffect(() => {
    setPage(0)
  }, [projectId, jobs.length])

  const panels: StudioPanel[] = [
    {
      id: 'overview',
      index: 0,
      title: t('media:panels.overview'),
      subtitle: t('media:panels.overviewSub'),
      icon: <IconList size={16} />,
      badge:
        jobs.length > 0 ? (
          <span className="media-count-pill">{jobs.length}</span>
        ) : undefined,
      children: (
        <JobsTable
          workspaceId={workspaceId}
          projectId={projectId}
          jobs={jobs}
          isLoading={isLoading}
          language={language}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onOpen={(id) => navigate(`/w/${workspaceId}/media/jobs/${id}`)}
        />
      ),
    },
    {
      id: 'upload',
      index: 1,
      title: t('media:panels.upload'),
      subtitle: t('media:panels.uploadSub'),
      icon: <IconUpload size={16} />,
      disabled: !projectId,
      children: projectId ? (
        <UploadConsentPanel
          workspaceId={workspaceId}
          projectId={projectId}
          onCreated={() => setOpenPanel('overview')}
        />
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('media:noProjectDesc')}</p>
      ),
    },
  ]

  return (
    <div className="media-studio-page">
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span className="text-[var(--color-media)]">{t('media:title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">
            <IconVideo size={26} className="text-[var(--color-media)]" />
            {t('media:title')}
          </h1>
          <div className="page-subtitle">{t('media:subtitle')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projectId && (
            <div className="media-poll-status">
              <span className={`media-poll-dot ${activeCount > 0 ? 'pulse-dot' : ''}`} />
              <span>
                {activeCount > 0
                  ? t('media:poll.active', { count: activeCount })
                  : t('media:poll.idle')}
                {dataUpdatedAt > 0 && (
                  <>
                    {' · '}
                    {t('media:poll.updated', {
                      relative: formatRelativeTime(
                        new Date(dataUpdatedAt).toISOString(),
                        language,
                      ),
                    })}
                  </>
                )}
              </span>
            </div>
          )}
          <StageLegend />
          <button
            type="button"
            className="btn-secondary"
            disabled={!projectId || isFetching}
            onClick={() => void refetch()}
          >
            <IconRefresh size={16} />
            {t('common:retry')}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!projectId}
            onClick={() => setOpenPanel('upload')}
          >
            <IconPlus size={16} />
            {t('media:newJob')}
          </button>
        </div>
      </div>

      <MediaStudioNav />

      <div className="media-banner info mb-4">
        <IconVideo size={18} />
        <div className="flex-1 text-sm">{t('media:scopeBanner')}</div>
      </div>

      <div className="media-project-picker mb-4">
        <div className="media-project-picker-icon">
          <IconFolder size={20} />
        </div>
        <div className="media-project-picker-body">
          <div className="media-project-picker-label">{t('media:selectProject')}</div>
          <div className="media-project-picker-hint">{t('media:selectProjectHint')}</div>
          {selectedProject && (
            <div className="media-project-picker-meta">
              <span>
                {t('media:projectSourceLang')}:{' '}
                <strong>
                  {formatLanguageOption(selectedProject.sourceLang, language)}
                </strong>
              </span>
              {selectedProject.domain && (
                <span>
                  · {t('media:projectDomain')}: <strong>{selectedProject.domain}</strong>
                </span>
              )}
            </div>
          )}
        </div>
        <select
          className="field-input media-project-picker-select"
          value={projectId}
          onChange={(e) => {
            const nextId = e.target.value
            setProjectId(nextId)
            setOpenPanel('overview')
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev)
                if (nextId) {
                  next.set('projectId', nextId)
                } else {
                  next.delete('projectId')
                }
                return next
              },
              { replace: true },
            )
          }}
          aria-label={t('media:selectProject')}
        >
          <option value="">{t('media:selectProjectPlaceholder')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatLanguageOption(p.sourceLang, language)}
            </option>
          ))}
        </select>
      </div>

      <StudioAccordion
        panels={panels}
        openId={openPanel}
        onToggle={(id) => setOpenPanel((cur) => (cur === id ? null : id))}
      />
    </div>
  )
}

function JobsTable({
  workspaceId,
  projectId,
  jobs,
  isLoading,
  language,
  page,
  pageSize,
  onPageChange,
  onOpen,
}: {
  workspaceId: string
  projectId: string
  jobs: MediaJob[]
  isLoading: boolean
  language: string
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation(['media', 'common'])

  const totalPages = Math.max(1, Math.ceil(jobs.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageJobs = useMemo(() => {
    const start = safePage * pageSize
    return jobs.slice(start, start + pageSize)
  }, [jobs, safePage, pageSize])

  if (!projectId) {
    return (
      <EmptyState
        icon={<IconVideo size={40} stroke={1.25} />}
        title={t('media:noProjectTitle')}
        description={t('media:noProjectDesc')}
        className="py-12"
      />
    )
  }

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
        {t('common:loading')}
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={<IconVideo size={40} stroke={1.25} />}
        title={t('media:emptyTitle')}
        description={t('media:emptyDesc')}
        className="py-12"
      />
    )
  }

  const from = safePage * pageSize + 1
  const to = Math.min(jobs.length, (safePage + 1) * pageSize)

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="dd-table">
          <thead>
            <tr>
              <th>{t('media:col.job')}</th>
              <th>{t('media:col.mode')}</th>
              <th>{t('media:col.targetLang')}</th>
              <th>{t('media:col.currentStage')}</th>
              <th>{t('media:col.status')}</th>
              <th>{t('media:col.created')}</th>
              <th style={{ width: 48 }} />
            </tr>
          </thead>
          <tbody>
            {pageJobs.map((job) => {
              const stage = currentStage(job)
              const progress = overallProgress(job)
              return (
                <tr
                  key={job.id}
                  className="cursor-pointer"
                  onClick={() => onOpen(job.id)}
                >
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="media-job-thumb">
                        <IconVideo size={16} />
                      </div>
                      <div>
                        <div className="font-semibold text-[13px]">
                          {formatLanguageOption(job.targetLang, language)}
                        </div>
                        <div className="font-mono text-[11px] text-[var(--color-text-tertiary)]">
                          {job.id.slice(0, 8)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`media-mode-badge ${recipeModeBadgeClass(job)}`}>
                      {t(`media:${recipeLabelKey(job)}`)}
                    </span>
                  </td>
                  <td>
                    <span className="media-lang-badge">
                      {formatLanguageOption(job.targetLang, language)}
                    </span>
                  </td>
                  <td>
                    {stage ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-[12.5px]">
                          <span>
                            {t(`media:stages.${stage.stageName}`, {
                              defaultValue: stage.stageName.replaceAll('_', ' '),
                            })}
                          </span>
                          <StageBadge status={stage.status} />
                        </div>
                        {isActiveMediaJobStatus(job.status) && (
                          <div className="flex max-w-[140px] items-center gap-2">
                            <ProgressBar value={progress} className="h-1 flex-1" />
                            <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
                              {progress}%
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className="space-y-1">
                      <StatusBadge status={asJobStatus(job.status)} />
                      {job.domainPhase && (
                        <div
                          className="text-[11px] text-[var(--color-text-tertiary)]"
                          title={String(job.domainPhase)}
                        >
                          {t(`media:${domainPhaseLabelKey(job.domainPhase)}`, {
                            defaultValue: String(job.domainPhase).replaceAll('_', ' '),
                          })}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="text-xs text-[var(--color-text-tertiary)]">
                    {formatRelativeTime(job.createdAt, language)}
                  </td>
                  <td>
                    <Link
                      to={`/w/${workspaceId}/media/jobs/${job.id}`}
                      className="btn-ghost btn-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconChevronRight size={16} />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="media-pagination">
        <span>
          {t('media:pagination.showing', { from, to, total: jobs.length })}
        </span>
        <div className="media-pagination-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={safePage <= 0}
            onClick={() => onPageChange(safePage - 1)}
          >
            <IconChevronLeft size={14} />
            {t('media:pagination.prev')}
          </button>
          <span className="media-pagination-page">
            {t('media:pagination.page', { page: safePage + 1, total: totalPages })}
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={safePage + 1 >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
          >
            {t('media:pagination.next')}
            <IconChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
