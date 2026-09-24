import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFilter,
  IconLoader2,
  IconMovie,
  IconPlayerPlay,
  IconPlus,
  IconRotate2,
  IconSearch,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  exportTransformationJobApi,
  getTransformationRenderConfigApi,
  rerunTransformationStageApi,
} from '@/api/transformation'
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
import {
  computeJobCounts,
  filterAndSortJobs,
  type JobSortKey,
} from '@/lib/media/jobFilters'
import { formatRelativeTime } from '@/lib/format'
import { formatLanguageOption } from '@/lib/languages'
import { asJobStatus } from '@/lib/status'
import type { MediaAsset, MediaJob } from '@/types/media'

type PreviewView = 'source' | 'output'

export interface JobsTableProps {
  workspaceId: string
  projectId: string
  jobs: MediaJob[]
  assets?: MediaAsset[]
  isLoading: boolean
  language: string
  page: number
  pageSize: number
  pageSizeOptions?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  onOpen: (id: string) => void
  onRefresh?: () => void
  onCreateNew?: () => void
  // Optional initial filter values from URL params
  initialSearch?: string
  initialStatus?: string
  initialLang?: string
  initialMode?: string
  initialSort?: JobSortKey
  onFilterChange?: (filters: {
    search: string
    status: string
    targetLang: string
    mode: string
    sortBy: JobSortKey
  }) => void
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
  pageSizeOptions = [8, 10, 20, 50],
  onPageChange,
  onPageSizeChange,
  onOpen,
  onRefresh,
  onCreateNew,
  initialSearch = '',
  initialStatus = 'ALL',
  initialLang = 'ALL',
  initialMode = 'ALL',
  initialSort = 'created_desc',
  onFilterChange,
}: JobsTableProps) {
  const { t } = useTranslation(['media', 'common'])

  // Filter state
  const [search, setSearch] = useState(initialSearch)
  const [status, setStatus] = useState(initialStatus)
  const [targetLang, setTargetLang] = useState(initialLang)
  const [mode, setMode] = useState(initialMode)
  const [sortBy, setSortBy] = useState<JobSortKey>(initialSort)

  // Preview & Action states
  // Before/after preview: 'source' = uploaded video, 'output' = rendered result.
  const [previewJob, setPreviewJob] = useState<{
    job: MediaJob
    title: string
    view: PreviewView
    urls: Partial<Record<PreviewView, string>>
    loading: boolean
    error: string | null
  } | null>(null)
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null)
  const [rerunningJobId, setRerunningJobId] = useState<string | null>(null)
  const [rerunConfirmJob, setRerunConfirmJob] = useState<{
    job: MediaJob
    stageName: string
    videoTitle: string
  } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const assetMap = useMemo(() => {
    return new Map(assets.map((asset) => [asset.id, asset.fileName]))
  }, [assets])

  const availableLangs = useMemo(() => {
    const set = new Set<string>()
    for (const job of jobs) {
      if (job.targetLang) set.add(job.targetLang)
    }
    return Array.from(set).sort()
  }, [jobs])

  const counts = useMemo(() => computeJobCounts(jobs), [jobs])

  const updateFilters = (newValues: {
    search?: string
    status?: string
    targetLang?: string
    mode?: string
    sortBy?: JobSortKey
  }) => {
    const nextSearch = newValues.search !== undefined ? newValues.search : search
    const nextStatus = newValues.status !== undefined ? newValues.status : status
    const nextLang = newValues.targetLang !== undefined ? newValues.targetLang : targetLang
    const nextMode = newValues.mode !== undefined ? newValues.mode : mode
    const nextSort = newValues.sortBy !== undefined ? newValues.sortBy : sortBy

    if (newValues.search !== undefined) setSearch(newValues.search)
    if (newValues.status !== undefined) setStatus(newValues.status)
    if (newValues.targetLang !== undefined) setTargetLang(newValues.targetLang)
    if (newValues.mode !== undefined) setMode(newValues.mode)
    if (newValues.sortBy !== undefined) setSortBy(newValues.sortBy)

    onPageChange(0)
    onFilterChange?.({
      search: nextSearch,
      status: nextStatus,
      targetLang: nextLang,
      mode: nextMode,
      sortBy: nextSort,
    })
  }

  const resetFilters = () => {
    updateFilters({
      search: '',
      status: 'ALL',
      targetLang: 'ALL',
      mode: 'ALL',
      sortBy: 'created_desc',
    })
  }

  const isFiltered =
    Boolean(search) || status !== 'ALL' || targetLang !== 'ALL' || mode !== 'ALL' || sortBy !== 'created_desc'

  const filteredJobs = useMemo(() => {
    return filterAndSortJobs(jobs, assetMap, {
      search,
      status,
      targetLang,
      mode,
      sortBy,
    })
  }, [jobs, assetMap, search, status, targetLang, mode, sortBy])

  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pageJobs = useMemo(() => {
    const start = safePage * pageSize
    return filteredJobs.slice(start, start + pageSize)
  }, [filteredJobs, safePage, pageSize])

  const loadPreview = async (job: MediaJob, view: PreviewView) => {
    try {
      const url =
        view === 'source'
          ? (await getTransformationRenderConfigApi(workspaceId, job.id)).sourceVideoUrl
          : (await exportTransformationJobApi(workspaceId, job.id, 'VIDEO')).downloadUrl
      setPreviewJob((prev) => {
        if (!prev || prev.job.id !== job.id) return prev
        const urls = url ? { ...prev.urls, [view]: url } : prev.urls
        if (prev.view !== view) return { ...prev, urls }
        return { ...prev, urls, loading: false, error: url ? null : t('media:previewNoVideo') }
      })
    } catch (err) {
      setPreviewJob((prev) =>
        prev && prev.job.id === job.id && prev.view === view
          ? { ...prev, loading: false, error: err instanceof Error ? err.message : t('media:previewFailed') }
          : prev,
      )
    }
  }

  const openPreview = (e: React.MouseEvent, job: MediaJob, title: string, view: PreviewView) => {
    e.stopPropagation()
    setPreviewJob({ job, title, view, urls: {}, loading: true, error: null })
    void loadPreview(job, view)
  }

  const switchPreviewView = (view: PreviewView) => {
    if (!previewJob || previewJob.view === view) return
    const cached = previewJob.urls[view]
    setPreviewJob({ ...previewJob, view, loading: !cached, error: null })
    if (!cached) void loadPreview(previewJob.job, view)
  }

  const handleDownload = async (e: React.MouseEvent, job: MediaJob, title: string) => {
    e.stopPropagation()
    setDownloadingJobId(job.id)
    setActionError(null)
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
      setActionError(err instanceof Error ? err.message : t('media:downloadError'))
    } finally {
      setDownloadingJobId(null)
    }
  }

  const handleRerunClick = (e: React.MouseEvent, job: MediaJob, videoTitle: string) => {
    e.stopPropagation()
    const failedStage =
      job.stages?.find((s) => s.status === 'FAILED') ??
      job.stages?.find((s) => s.status === 'PARTIALLY_FAILED') ??
      currentStage(job)
    const stageName = failedStage?.stageName ?? job.stages?.[0]?.stageName ?? 'RENDER'

    setRerunConfirmJob({ job, stageName, videoTitle })
  }

  const executeRerun = async (job: MediaJob, stageName: string) => {
    setRerunningJobId(job.id)
    setActionError(null)
    try {
      await rerunTransformationStageApi(workspaceId, job.id, stageName)
      setRerunConfirmJob(null)
      onRefresh?.()
    } catch (err) {
      console.error('Rerun failed', err)
      setActionError(err instanceof Error ? err.message : t('media:rerunError'))
    } finally {
      setRerunningJobId(null)
    }
  }

  const previewUrl = previewJob ? previewJob.urls[previewJob.view] ?? null : null

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
      <div className="py-12 text-center">
        <EmptyState
          icon={<IconVideo size={40} stroke={1.25} />}
          title={t('media:emptyTitle')}
          description={t('media:emptyDesc')}
          className="py-6"
        />
        {onCreateNew && (
          <button
            type="button"
            className="btn-primary mt-2 inline-flex items-center gap-1.5"
            onClick={onCreateNew}
          >
            <IconPlus size={16} />
            <span>{t('media:newJob')}</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <div
          role="alert"
          className="media-panel-error-toast flex items-center justify-between gap-2"
          data-testid="job-action-error"
        >
          <span>{actionError}</span>
          <button
            type="button"
            className="btn-ghost btn-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            onClick={() => setActionError(null)}
            aria-label={t('common:actions.close')}
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="jobs-filter">
        <div className="jobs-filter__row">
          <div className="jobs-filter__search">
            <IconSearch size={15} className="jobs-filter__search-icon" aria-hidden />
            <input
              type="text"
              placeholder={t('media:filter.searchPlaceholder', {
                defaultValue: 'Tìm theo tên video hoặc ID…',
              })}
              value={search}
              onChange={(e) => updateFilters({ search: e.target.value })}
            />
            {search && (
              <button
                type="button"
                className="jobs-filter__search-clear"
                onClick={() => updateFilters({ search: '' })}
                aria-label={t('common:actions.close')}
              >
                <IconX size={13} />
              </button>
            )}
          </div>

          <div className="jobs-filter__selects">
            {availableLangs.length > 0 && (
              <select
                className="jobs-filter__select"
                value={targetLang}
                onChange={(e) => updateFilters({ targetLang: e.target.value })}
                aria-label={t('media:filter.langAll', { defaultValue: 'Ngôn ngữ đích' })}
              >
                <option value="ALL">{t('media:filter.langAll', { defaultValue: 'Tất cả ngôn ngữ' })}</option>
                {availableLangs.map((lang) => (
                  <option key={lang} value={lang}>
                    {formatLanguageOption(lang, language)}
                  </option>
                ))}
              </select>
            )}

            <select
              className="jobs-filter__select"
              value={mode}
              onChange={(e) => updateFilters({ mode: e.target.value })}
              aria-label={t('media:filter.modeAll', { defaultValue: 'Chế độ' })}
            >
              <option value="ALL">{t('media:filter.modeAll', { defaultValue: 'Tất cả chế độ' })}</option>
              <option value="modeTranslateOnly">{t('media:modeTranslateOnly')}</option>
              <option value="modeHybrid">{t('media:modeHybrid')}</option>
              <option value="modeGenerative">{t('media:modeGenerative')}</option>
              <option value="AUTO">{t('media:workflow.auto')}</option>
              <option value="MANUAL">{t('media:workflow.manual')}</option>
            </select>

            <select
              className="jobs-filter__select"
              value={sortBy}
              onChange={(e) => updateFilters({ sortBy: e.target.value as JobSortKey })}
              aria-label={t('media:filter.sortCreatedDesc', { defaultValue: 'Sắp xếp' })}
            >
              <option value="created_desc">{t('media:filter.sortCreatedDesc', { defaultValue: 'Mới nhất' })}</option>
              <option value="created_asc">{t('media:filter.sortCreatedAsc', { defaultValue: 'Cũ nhất' })}</option>
              <option value="name_asc">{t('media:filter.sortNameAsc', { defaultValue: 'Tên A-Z' })}</option>
              <option value="name_desc">{t('media:filter.sortNameDesc', { defaultValue: 'Tên Z-A' })}</option>
            </select>
          </div>
        </div>

        {/* Quick Filter Chips */}
        <div className="jobs-filter__chips-row">
          <div className="jobs-filter__chips" role="group">
            {(
              [
                { value: 'ALL', tone: 'neutral', label: t('media:filter.chipAll', { defaultValue: 'Tất cả' }), count: counts.all },
                { value: 'ACTIVE', tone: 'info', label: t('media:filter.chipActive', { defaultValue: 'Đang chạy' }), count: counts.active },
                ...(counts.needReview > 0
                  ? [{ value: 'NEED_REVIEW', tone: 'warning', label: t('media:filter.chipReview', { defaultValue: 'Cần duyệt' }), count: counts.needReview }]
                  : []),
                { value: 'FAILED', tone: 'danger', label: t('media:filter.chipFailed', { defaultValue: 'Lỗi' }), count: counts.failed },
                { value: 'COMPLETED', tone: 'success', label: t('media:filter.chipCompleted', { defaultValue: 'Xong' }), count: counts.completed },
              ] as const
            ).map((chip) => {
              const active = status === chip.value
              return (
                <button
                  key={chip.value}
                  type="button"
                  className="jobs-filter__chip"
                  data-tone={chip.tone}
                  data-active={active || undefined}
                  aria-pressed={active}
                  aria-label={`${chip.label} (${chip.count})`}
                  onClick={() =>
                    updateFilters({ status: chip.value === 'ALL' || active ? 'ALL' : chip.value })
                  }
                >
                  <span className="jobs-filter__chip-dot" aria-hidden />
                  <span>{chip.label}</span>
                  <span className="jobs-filter__chip-count">{chip.count}</span>
                </button>
              )
            })}
          </div>

          {isFiltered && (
            <button type="button" className="jobs-filter__reset" onClick={resetFilters}>
              <IconFilter size={12} />
              <span>{t('media:filter.clear', { defaultValue: 'Xóa bộ lọc' })}</span>
            </button>
          )}
        </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-1)] p-8 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('media:filter.noMatching', { defaultValue: 'Không tìm thấy job phù hợp với bộ lọc.' })}
          </p>
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={resetFilters}>
            {t('media:filter.clear', { defaultValue: 'Xóa bộ lọc' })}
          </button>
        </div>
      ) : (
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
                  {t('media:col.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {pageJobs.map((job) => {
                const stage = currentStage(job)
                const progress = overallProgress(job)
                const videoTitle = assetMap.get(job.rootAssetId) || `Video ${job.id.slice(0, 8)}`
                const isFailed = job.status === 'FAILED' || job.status === 'PARTIALLY_FAILED'
                return (
                  <tr
                    key={job.id}
                    className={`cursor-pointer ${isFailed ? 'bg-red-500/5 hover:bg-red-500/10' : ''}`}
                    onClick={() => onOpen(job.id)}
                  >
                    <td>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="media-job-thumb shrink-0">
                          <IconVideo size={16} />
                        </div>
                        <div className="min-w-0 max-w-[260px]">
                          <div className="font-semibold text-[13px] truncate" title={videoTitle}>
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
                        <div className="job-preview-pair" role="group" aria-label={t('media:actions.preview')}>
                          <button
                            type="button"
                            title={t('media:actions.previewSource')}
                            data-testid={`preview-source-${job.id}`}
                            onClick={(e) => openPreview(e, job, videoTitle, 'source')}
                          >
                            <IconMovie size={14} />
                            <span>{t('media:actions.previewSourceShort')}</span>
                          </button>
                          <button
                            type="button"
                            title={
                              job.status === 'COMPLETED'
                                ? t('media:actions.previewOutput')
                                : t('media:actions.previewOutputUnavailable')
                            }
                            data-testid={`preview-job-${job.id}`}
                            disabled={job.status !== 'COMPLETED'}
                            onClick={(e) => openPreview(e, job, videoTitle, 'output')}
                          >
                            <IconPlayerPlay size={14} />
                            <span>{t('media:actions.previewOutputShort')}</span>
                          </button>
                        </div>
                        {job.status === 'COMPLETED' && (
                          <>
                            <button
                              type="button"
                              className="btn-ghost btn-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                              title={t('media:actions.download')}
                              aria-label={t('media:actions.download')}
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
                            title={t('media:actions.rerun')}
                            aria-label={t('media:actions.rerun')}
                            data-testid={`rerun-job-${job.id}`}
                            disabled={rerunningJobId === job.id}
                            onClick={(e) => handleRerunClick(e, job, videoTitle)}
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
                          title={t('media:actions.pipelineDetails')}
                          aria-label={t('media:actions.pipelineDetails')}
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
      )}

      {/* Pagination & Page Size */}
      <div className="media-pagination">
        <div className="media-pagination-meta">
          {onPageSizeChange && (
            <label className="media-pagination-size">
              <span>{t('media:filter.pageSize', { defaultValue: 'Dòng / trang:' })}</span>
              <select
                className="field-input media-pagination-select"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

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

      {/* Preview Modal */}
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
                {previewUrl && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = previewUrl
                      a.download = `${previewJob.title || 'video'}.mp4`
                      a.target = '_blank'
                      a.rel = 'noopener noreferrer'
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                    }}
                  >
                    <IconDownload size={14} />
                    <span>{t('media:actions.download')}</span>
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setPreviewJob(null)}
              >
                {t('common:actions.close')}
              </button>
            </div>
          }
        >
          <div className="job-preview-tabs" role="tablist" aria-label={t('media:actions.preview')}>
            {(['source', 'output'] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={previewJob.view === view}
                className={previewJob.view === view ? 'active' : undefined}
                disabled={view === 'output' && previewJob.job.status !== 'COMPLETED'}
                data-testid={`preview-tab-${view}`}
                onClick={() => switchPreviewView(view)}
              >
                {view === 'source' ? <IconMovie size={14} /> : <IconPlayerPlay size={14} />}
                <span>
                  {view === 'source' ? t('media:actions.previewSource') : t('media:actions.previewOutput')}
                </span>
              </button>
            ))}
          </div>
          {previewJob.loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-[var(--color-text-tertiary)]">
              <IconLoader2 size={32} className="animate-spin text-[var(--color-accent)]" />
              <span className="text-sm">{t('media:previewLoading')}</span>
            </div>
          ) : previewJob.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
              {previewJob.error}
            </div>
          ) : previewUrl ? (
            <div className="flex flex-col items-center">
              <video
                key={previewUrl}
                src={previewUrl}
                controls
                autoPlay
                className="max-h-[65vh] w-full rounded-lg bg-black object-contain shadow"
              />
            </div>
          ) : null}
        </Modal>
      )}

      {/* Rerun Confirmation Modal */}
      {rerunConfirmJob && (
        <Modal
          open={true}
          onClose={() => setRerunConfirmJob(null)}
          title={t('media:pipeline.rerunConfirmTitle', {
            stage: t(`media:stages.${rerunConfirmJob.stageName}`, {
              defaultValue: rerunConfirmJob.stageName.replaceAll('_', ' '),
            }),
          })}
          description={`Video: ${rerunConfirmJob.videoTitle} (Job ID: ${rerunConfirmJob.job.id.slice(0, 8)})`}
          footer={
            <div className="flex w-full items-center justify-between">
              <Link
                to={`/w/${workspaceId}/media/jobs/${rerunConfirmJob.job.id}`}
                className="text-xs text-[var(--color-primary)] hover:underline"
                onClick={() => setRerunConfirmJob(null)}
              >
                {t('media:rerunDetailHint')}
              </Link>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setRerunConfirmJob(null)}
                  disabled={rerunningJobId === rerunConfirmJob.job.id}
                >
                  {t('common:actions.cancel')}
                </button>
                <button
                  type="button"
                  className="btn-danger btn-sm inline-flex items-center gap-1.5"
                  data-testid="rerun-confirm-btn"
                  disabled={rerunningJobId === rerunConfirmJob.job.id}
                  onClick={() => void executeRerun(rerunConfirmJob.job, rerunConfirmJob.stageName)}
                >
                  {rerunningJobId === rerunConfirmJob.job.id && (
                    <IconLoader2 size={14} className="animate-spin" />
                  )}
                  <span>{t('media:pipeline.rerunConfirmBtn')}</span>
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            <p>
              {t('media:pipeline.rerunConfirmDesc', {
                stage: t(`media:stages.${rerunConfirmJob.stageName}`, {
                  defaultValue: rerunConfirmJob.stageName.replaceAll('_', ' '),
                }),
              })}
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
