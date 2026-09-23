import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFolder,
  IconList,
  IconLoader2,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRotate2,
  IconUpload,
  IconVideo,
} from '@tabler/icons-react'
import { MediaStudioNav } from '@/components/media-studio/MediaStudioNav'
import { StageLegend } from '@/components/media-studio/StageLegend'
import { StudioAccordion, type StudioPanel } from '@/components/media-studio/StudioAccordion'
import { UploadConsentPanel } from '@/components/media-studio/UploadConsentPanel'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useMediaJobs, useProjectMediaAssets } from '@/hooks/useMedia'
import { useProjects } from '@/hooks/useProjects'
import { exportTransformationJobApi, rerunTransformationStageApi } from '@/api/transformation'
import {
  currentStage,
  domainPhaseLabelKey,
  isActiveMediaJobStatus,
  isRedundantPhaseBadge,
  overallProgress,
  recipeLabelKey,
  recipeModeBadgeClass,
  resolveEffectivePhase,
} from '@/lib/media'
import { formatRelativeTime } from '@/lib/format'
import { formatLanguageOption } from '@/lib/languages'
import { asJobStatus } from '@/lib/status'
import { useUiStore } from '@/store/uiStore'
import type { MediaAsset, MediaJob } from '@/types/media'

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
  const location = useLocation()
  const language = useUiStore((s) => s.language)

  const { data: projects = [] } = useProjects(workspaceId)
  // Accept both ?project= (canonical) and ?projectId= (links from dashboard / project list).
  const projectFromUrl = searchParams.get('project') || searchParams.get('projectId') || ''
  const [projectId, setProjectId] = useState(projectFromUrl)

  const hashPanel = location.hash.replace(/^#/, '')
  const initialPanel = hashPanel === 'upload' ? 'upload' : 'overview'
  const [openPanel, setOpenPanel] = useState<string | null>(initialPanel)
  const [page, setPage] = useState(0)

  useDocumentTitle(t('media:title'))

  const {
    data: jobs = [],
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useMediaJobs(workspaceId, projectId || undefined)
  const { data: assets = [] } = useProjectMediaAssets(workspaceId, projectId || undefined)

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

  // Sync projectId with URL search parameter (?project=... or ?projectId=...)
  useEffect(() => {
    const urlProj = searchParams.get('project') || searchParams.get('projectId') || ''
    if (urlProj !== projectId) {
      setProjectId(urlProj)
    }
  }, [searchParams])

  // Sync openPanel with URL hash (#overview, #upload)
  useEffect(() => {
    const h = location.hash.replace(/^#/, '')
    if (h === 'upload') {
      setOpenPanel('upload')
    } else if (h === 'overview' || !h) {
      setOpenPanel('overview')
    }
  }, [location.hash])

  const handlePanelToggle = (panelId: string | null) => {
    const next = openPanel === panelId ? null : panelId
    setOpenPanel(next)
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: next ? `#${next}` : '',
      },
      { replace: false },
    )
  }

  const handleSelectProject = (newId: string) => {
    setProjectId(newId)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (newId) {
          next.set('project', newId)
        } else {
          next.delete('project')
        }
        return next
      },
      { replace: true },
    )
  }

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
          assets={assets}
          isLoading={isLoading}
          language={language}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onOpen={(id) => navigate(`/w/${workspaceId}/media/jobs/${id}`)}
          onRefresh={() => void refetch()}
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
          onCreated={() => {
            setOpenPanel('overview')
            navigate({
              pathname: location.pathname,
              search: location.search,
              hash: '#overview',
            })
          }}
        />
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('media:noProjectDesc')}</p>
      ),
    },
  ]

  return (
    <div className="media-studio-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <IconVideo size={26} className="text-[var(--color-media)]" />
            {t('media:title')}
          </h1>
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
            onClick={() => {
              setOpenPanel('upload')
              navigate({
                pathname: location.pathname,
                search: location.search,
                hash: '#upload',
              })
            }}
          >
            <IconPlus size={16} />
            {t('media:newJob')}
          </button>
        </div>
      </div>

      <MediaStudioNav />

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
            handleSelectProject(e.target.value)
            setOpenPanel('overview')
            navigate({
              pathname: location.pathname,
              search: e.target.value ? `?project=${e.target.value}` : '',
              hash: '#overview',
            })
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
        onToggle={handlePanelToggle}
      />
    </div>
  )
}

export function JobsTable({
  workspaceId,
  projectId,
  jobs,
  assets = [],
  isLoading,
  language,
  page,
  pageSize,
  onPageChange,
  onOpen,
  onRefresh,
}: {
  workspaceId: string
  projectId: string
  jobs: MediaJob[]
  assets?: MediaAsset[]
  isLoading: boolean
  language: string
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onOpen: (id: string) => void
  onRefresh?: () => void
}) {
  const { t } = useTranslation(['media', 'common'])

  const [previewJob, setPreviewJob] = useState<{
    job: MediaJob
    title: string
    videoUrl: string | null
    loading: boolean
    error: string | null
  } | null>(null)
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null)
  const [rerunningJobId, setRerunningJobId] = useState<string | null>(null)

  const handlePreview = async (e: React.MouseEvent, job: MediaJob, title: string) => {
    e.stopPropagation()
    setPreviewJob({ job, title, videoUrl: null, loading: true, error: null })
    try {
      const res = await exportTransformationJobApi(workspaceId, job.id, 'VIDEO')
      if (res.downloadUrl) {
        setPreviewJob((prev) => (prev ? { ...prev, videoUrl: res.downloadUrl, loading: false } : null))
      } else {
        setPreviewJob((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                error: language === 'vi' ? 'Không tìm thấy video preview' : 'No preview video available',
              }
            : null,
        )
      }
    } catch (err) {
      setPreviewJob((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error:
                err instanceof Error
                  ? err.message
                  : language === 'vi'
                    ? 'Không thể tải video preview'
                    : 'Failed to load video preview',
            }
          : null,
      )
    }
  }

  const handleDownload = async (e: React.MouseEvent, job: MediaJob, title: string) => {
    e.stopPropagation()
    setDownloadingJobId(job.id)
    try {
      const res = await exportTransformationJobApi(workspaceId, job.id, 'VIDEO')
      if (res.downloadUrl) {
        const a = document.createElement('a')
        a.href = res.downloadUrl
        a.download = res.fileName || `${title}.mp4`
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (err) {
      console.error('Download failed', err)
    } finally {
      setDownloadingJobId(null)
    }
  }

  const handleRerun = async (e: React.MouseEvent, job: MediaJob) => {
    e.stopPropagation()
    const failedStage =
      job.stages?.find((s) => s.status === 'FAILED') ??
      job.stages?.find((s) => s.status === 'PARTIALLY_FAILED') ??
      currentStage(job)
    const stageName = failedStage?.stageName ?? job.stages?.[0]?.stageName ?? 'RENDER'

    setRerunningJobId(job.id)
    try {
      await rerunTransformationStageApi(workspaceId, job.id, stageName)
      onRefresh?.()
    } catch (err) {
      console.error('Rerun failed', err)
    } finally {
      setRerunningJobId(null)
    }
  }

  const assetMap = useMemo(() => {
    return new Map(assets.map((asset) => [asset.id, asset.fileName]))
  }, [assets])

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
              <th className="!text-center" style={{ width: 140, textAlign: 'center' }}>
                {t('media:col.action', { defaultValue: language === 'vi' ? 'Hành động' : 'Actions' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageJobs.map((job) => {
              const stage = currentStage(job)
              const progress = overallProgress(job)
              const videoTitle = assetMap.get(job.rootAssetId) || `Video ${job.id.slice(0, 8)}`
              return (
                <tr
                  key={job.id}
                  className="cursor-pointer"
                  onClick={() => onOpen(job.id)}
                >
                  <td>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="media-job-thumb shrink-0">
                        <IconVideo size={16} />
                      </div>
                      <div className="min-w-0 max-w-[260px]">
                        <div
                          className="font-semibold text-[13px] truncate"
                          title={videoTitle}
                        >
                          {videoTitle}
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
                        <div className="text-[12.5px] font-medium text-[var(--color-text-primary)]">
                          {t(`media:stages.${stage.stageName}`, {
                            defaultValue: stage.stageName.replaceAll('_', ' '),
                          })}
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
                      {(() => {
                        const phase = resolveEffectivePhase(job)
                        if (!phase || isRedundantPhaseBadge({ status: job.status, domainPhase: phase })) {
                          return null
                        }
                        return (
                          <div
                            className="text-[11px] text-[var(--color-text-tertiary)]"
                            title={String(phase)}
                          >
                            {t(`media:${domainPhaseLabelKey(phase)}`, {
                              defaultValue: String(phase).replaceAll('_', ' '),
                            })}
                          </div>
                        )
                      })()}
                    </div>
                  </td>
                  <td className="text-xs text-[var(--color-text-tertiary)]">
                    {formatRelativeTime(job.createdAt, language)}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
                    <div className="flex items-center justify-center gap-1">
                      {job.status === 'COMPLETED' && (
                        <>
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            title={language === 'vi' ? 'Xem video' : 'Watch video'}
                            aria-label={language === 'vi' ? 'Xem video' : 'Watch video'}
                            data-testid={`preview-job-${job.id}`}
                            onClick={(e) => handlePreview(e, job, videoTitle)}
                          >
                            <IconPlayerPlay size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            title={language === 'vi' ? 'Tải video' : 'Download video'}
                            aria-label={language === 'vi' ? 'Tải video' : 'Download video'}
                            data-testid={`download-job-${job.id}`}
                            disabled={downloadingJobId === job.id}
                            onClick={(e) => handleDownload(e, job, videoTitle)}
                          >
                            {downloadingJobId === job.id ? (
                              <IconLoader2 size={16} className="animate-spin text-[var(--color-accent)]" />
                            ) : (
                              <IconDownload size={16} />
                            )}
                          </button>
                        </>
                      )}
                      {(job.status === 'FAILED' || job.status === 'PARTIALLY_FAILED') && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-red-500 hover:text-red-600 dark:text-red-400"
                          title={language === 'vi' ? 'Chạy lại' : 'Rerun'}
                          aria-label={language === 'vi' ? 'Chạy lại' : 'Rerun'}
                          data-testid={`rerun-job-${job.id}`}
                          disabled={rerunningJobId === job.id}
                          onClick={(e) => handleRerun(e, job)}
                        >
                          {rerunningJobId === job.id ? (
                            <IconLoader2 size={16} className="animate-spin text-red-500" />
                          ) : (
                            <IconRotate2 size={16} />
                          )}
                        </button>
                      )}
                      <Link
                        to={`/w/${workspaceId}/media/jobs/${job.id}`}
                        className="btn-ghost btn-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        title={language === 'vi' ? 'Chi tiết pipeline' : 'Pipeline details'}
                        aria-label={language === 'vi' ? 'Chi tiết pipeline' : 'Pipeline details'}
                      >
                        <IconChevronRight size={16} />
                      </Link>
                    </div>
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

      {previewJob && (
        <Modal
          open={true}
          onClose={() => setPreviewJob(null)}
          title={previewJob.title}
          description={`Job ID: ${previewJob.job.id}`}
          size="lg"
          footer={
            <div className="flex w-full items-center justify-between">
              <div>
                {previewJob.videoUrl && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = previewJob.videoUrl!
                      a.download = `${previewJob.title || 'video'}.mp4`
                      a.target = '_blank'
                      a.rel = 'noopener noreferrer'
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                    }}
                  >
                    <IconDownload size={14} />
                    <span>{language === 'vi' ? 'Tải video' : 'Download video'}</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setPreviewJob(null)}
              >
                {t('common:actions.close', { defaultValue: 'Đóng' })}
              </button>
            </div>
          }
        >
          {previewJob.loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-[var(--color-text-tertiary)]">
              <IconLoader2 size={32} className="animate-spin text-[var(--color-accent)]" />
              <span className="text-sm">
                {language === 'vi' ? 'Đang tải video…' : 'Loading video…'}
              </span>
            </div>
          ) : previewJob.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              {previewJob.error}
            </div>
          ) : previewJob.videoUrl ? (
            <div className="flex flex-col items-center">
              <video
                src={previewJob.videoUrl}
                controls
                autoPlay
                className="max-h-[65vh] w-full rounded-lg bg-black object-contain shadow"
              />
            </div>
          ) : null}
        </Modal>
      )}
    </div>
  )
}
