import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  IconAlertCircle,
  IconChevronLeft,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconVideo,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { MobileCard } from '../../components/MobileCard'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { UploadConsentPanel } from '@/components/media-studio/UploadConsentPanel'
import { useProjects } from '@/hooks/useProjects'
import { useMediaJobs, useProjectMediaAssets } from '@/hooks/useMedia'
import { usePermission } from '@/hooks/usePermission'
import { isActiveMediaJobStatus, overallProgress } from '@/lib/media'
import type { MediaAsset } from '@/types/media'
import { useTranslation } from 'react-i18next'

function getStatusBadgeStyle(status?: string) {
  switch (status?.toUpperCase()) {
    case 'COMPLETED':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    case 'FAILED':
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
    case 'PARTIALLY_FAILED':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    case 'PROCESSING':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
    case 'PENDING':
    default:
      return 'bg-primary/10 text-primary border-primary/20'
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * Mobile Media Hub — same data and actions as desktop MediaListPage:
 * job list per project (#overview) and the create-job flow (#upload).
 */
export function MobileMediaListPage() {
  const { t } = useTranslation(['mobile', 'media'])
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const canUpload = usePermission('document.upload')

  const { data: projects = [] } = useProjects(workspaceId)
  // Accept both ?project= (canonical, desktop) and ?projectId= (dashboard / project list links).
  const queryProjectId = searchParams.get('project') || searchParams.get('projectId') || ''
  const selectedProjectId = queryProjectId || projects[0]?.id

  const {
    data: jobs = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useMediaJobs(workspaceId, selectedProjectId)
  const { data: assets = [] } = useProjectMediaAssets(workspaceId, selectedProjectId)
  const assetById = useMemo(
    () => new Map<string, MediaAsset>(assets.map((a) => [a.id, a])),
    [assets],
  )

  const showUpload = location.hash === '#upload' && Boolean(selectedProjectId)
  const setPanel = (panel: 'overview' | 'upload') =>
    navigate({ pathname: location.pathname, search: location.search, hash: `#${panel}` }, { replace: true })

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const filterOptions = [
    { id: 'ALL', label: t('mobile:media.filterAll') },
    { id: 'PROCESSING', label: t('mobile:media.filterProcessing') },
    { id: 'COMPLETED', label: t('mobile:media.filterCompleted') },
    { id: 'FAILED', label: t('mobile:media.filterFailed') },
  ]

  const titleOf = (jobId: string, rootAssetId: string) =>
    assetById.get(rootAssetId)?.fileName ||
    t('mobile:media.fallbackTitle', { id: jobId.slice(0, 8) })

  const filtered = jobs.filter((j) => {
    const matchSearch = titleOf(j.id, j.rootAssetId).toLowerCase().includes(search.toLowerCase())
    const status = String(j.status ?? '').toUpperCase()
    const matchStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'PROCESSING' ? isActiveMediaJobStatus(status) : status === statusFilter)
    return matchSearch && matchStatus
  })

  const selectProject = (projectId: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('project', projectId)
        next.delete('projectId')
        return next
      },
      { replace: true },
    )
  }

  if (showUpload && selectedProjectId) {
    return (
      <div className="w-full min-w-0 space-y-3 overflow-x-clip pb-8">
        <button
          type="button"
          onClick={() => setPanel('overview')}
          className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500"
        >
          <IconChevronLeft size={17} />
          {t('media:backToList')}
        </button>
        <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">{t('media:newJob')}</h1>
        <div className="min-w-0 overflow-x-clip">
          <UploadConsentPanel
            workspaceId={workspaceId}
            projectId={selectedProjectId}
            onCreated={() => setPanel('overview')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">{t('mobile:media.title')}</h1>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {jobs.length > 0 ? t('mobile:media.fileCount', { count: jobs.length }) : t('mobile:media.subtitle')}
          </p>
        </div>
        {selectedProjectId && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label={t('mobile:common.retry')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 text-neutral-600 active:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            <IconRefresh size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>
        )}
        <Link
          to={`/w/${workspaceId}/media/presets`}
          className="flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl border border-neutral-200 dark:border-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800 transition-colors"
        >
          {t('mobile:media.presets')}
        </Link>
      </div>

      {canUpload && selectedProjectId && (
        <button
          type="button"
          data-testid="mobile-media-new-job"
          onClick={() => setPanel('upload')}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-white shadow-xs active:scale-[0.98] transition-transform"
        >
          <IconPlus size={17} />
          {t('media:newJob')}
        </button>
      )}

      {/* Project Switcher if multiple projects */}
      {projects.length > 1 && (
        <div className="no-scrollbar -mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1">
          <IconFolder size={16} className="text-neutral-400 shrink-0 ml-1" />
          {projects.map((p) => {
            const isCurrent = p.id === selectedProjectId
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProject(p.id)}
                className={clsx(
                  'max-w-[160px] shrink-0 truncate min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border',
                  isCurrent
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400'
                )}
                title={p.name}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Search and Status Filter */}
      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder={t('mobile:media.searchPlaceholder')}
        filters={filterOptions}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      {!selectedProjectId ? (
        <MobileEmptyState
          icon={<IconFolder size={36} />}
          title={t('media:noProjectTitle')}
          description={t('media:noProjectDesc')}
        />
      ) : isLoading ? (
        <div className="space-y-3 py-2">
          <div className="py-6 text-center text-sm text-neutral-400">
            {t('mobile:media.loading')}
          </div>
          {[1, 2, 3].map((i) => (
            <MobileCard key={i} className="animate-pulse space-y-3 p-4">
              <div className="flex gap-3">
                <div className="h-16 w-24 shrink-0 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-3 w-1/4 rounded bg-neutral-100 dark:bg-neutral-800" />
                </div>
              </div>
            </MobileCard>
          ))}
        </div>
      ) : error ? (
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="text-red-500 mb-2" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            {t('mobile:media.loadFailed')}
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {error.message || t('mobile:common.networkError')}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200"
          >
            <IconRefresh size={14} />
            <span>{t('mobile:common.retry')}</span>
          </button>
        </MobileCard>
      ) : jobs.length === 0 ? (
        <MobileEmptyState
          icon={<IconVideo size={36} />}
          title={t('mobile:media.emptyTitle')}
          description={t('mobile:media.emptyDesc')}
        />
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconVideo size={36} />}
          title={t('mobile:media.noMatchTitle')}
          description={t('mobile:media.noMatchDesc')}
          action={
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setStatusFilter('ALL')
              }}
              className="rounded-xl bg-neutral-100 dark:bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              {t('mobile:common.clearFilters')}
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => {
            const asset = assetById.get(job.rootAssetId)
            const itemTitle = titleOf(job.id, job.rootAssetId)
            const duration =
              typeof asset?.durationMs === 'number'
                ? formatDuration(asset.durationMs / 1000)
                : typeof job.requestedDurationSeconds === 'number'
                  ? formatDuration(job.requestedDurationSeconds)
                  : null
            const progress = overallProgress(job)
            const isProcessing =
              isActiveMediaJobStatus(job.status) || String(job.status).toUpperCase() === 'CANCEL_REQUESTED'

            return (
              <Link key={job.id} to={`/w/${workspaceId}/media/jobs/${job.id}`} className="block min-w-0">
                <MobileCard interactive className="min-w-0 space-y-3">
                  <div className="flex min-w-0 gap-3">
                    <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
                      <IconVideo size={24} className="text-neutral-400" />
                      {duration && (
                        <span className="absolute bottom-1 right-1 rounded-sm bg-black/70 px-1 py-0.5 text-[9px] font-semibold whitespace-nowrap text-white">
                          {duration}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-white" title={itemTitle}>
                        {itemTitle}
                      </h3>
                      <div className="mt-1.5 flex min-w-0 items-center flex-wrap gap-1.5">
                        <span
                          className={clsx(
                            'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold border',
                            getStatusBadgeStyle(job.status)
                          )}
                        >
                          {job.status}
                        </span>
                        {job.targetLang && (
                          <span className="shrink-0 rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-400 uppercase">
                            {job.targetLang.toUpperCase()}
                          </span>
                        )}
                        {(job.recipeId || job.processingMode) && (
                          <span className="min-w-0 truncate text-[10px] text-neutral-400 max-w-[120px]">
                            {job.recipeId || job.processingMode}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isProcessing && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-neutral-500">
                        <span>{t('mobile:media.filterProcessing')}</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </MobileCard>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
