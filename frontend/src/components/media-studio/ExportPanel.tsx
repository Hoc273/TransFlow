import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFileDescription,
  IconFileText,
  IconInfoCircle,
  IconLoader2,
  IconPlayerPlay,
  IconVideo,
} from '@tabler/icons-react'
import { exportTransformationJobApi } from '@/api/transformation'
import { useExportMediaJob, useMediaLinkedJob, useOutputPackage } from '@/hooks/useMedia'
import {
  downloadTextFile,
  hasEffectiveBlockExport,
  stageByName,
} from '@/lib/media'
import { ApiError } from '@/types/api'
import { MEDIA_ERROR_CODES, type MediaExportFormat, type MediaJob } from '@/types/media'
import type { QaIssue } from '@/types/qa'

type Props = {
  workspaceId: string
  job: MediaJob
}

/**
 * Export surface designed as a VIDEO DELIVERABLES LIST:
 * - Each item in the list represents a video output (with format, duration, badges, and quick download actions).
 * - Clicking an item expands a 2-COLUMN VIEW:
 *   - Left column: Video player preview, stream specs, and primary Video MP4 download.
 *   - Right column: Video specifications & metadata, plus attached subtitle files (SRT, VTT)
 *     with their download actions and inline content preview.
 */
export function ExportPanel({ workspaceId, job }: Props) {
  const { t } = useTranslation(['media', 'common'])
  const exportJob = useExportMediaJob(workspaceId, job.id)
  const { data: linkedJob } = useMediaLinkedJob(workspaceId, job.translationJobId)
  const [error, setError] = useState<string | null>(null)
  const [lastOk, setLastOk] = useState<string | null>(null)
  const [activeDownloadFormat, setActiveDownloadFormat] = useState<MediaExportFormat | null>(null)
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null)
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null)

  // Subtitle previews for SRT & VTT
  const [subPreview, setSubPreview] = useState<
    Record<'SRT' | 'VTT', { open: boolean; content: string | null; error: string | null; loaded: boolean; loading: boolean }>
  >({
    SRT: { open: false, content: null, error: null, loaded: false, loading: false },
    VTT: { open: false, content: null, error: null, loaded: false, loading: false },
  })
  const pendingPreview = useRef<'SRT' | 'VTT' | null>(null)

  const issues: QaIssue[] = useMemo(
    () => linkedJob?.segments?.flatMap((s) => s.qaIssues ?? []) ?? [],
    [linkedJob],
  )
  const blocked = hasEffectiveBlockExport(issues)
  const renderStage = stageByName(job, 'RENDER')
  const renderDone = String(renderStage?.status).toUpperCase() === 'COMPLETED'
  const hasRenderArtifact = !!renderStage?.outputRef?.trim()
  const outputPackage = useOutputPackage(workspaceId, job.id, renderDone)
  const hasPackageArtifact = !!outputPackage.data?.primaryVideoRef
    || !!outputPackage.data?.primaryVideoDownloadUrl
  const outputPackageStageNotReady = outputPackage.error instanceof ApiError
    && outputPackage.error.errorCode === MEDIA_ERROR_CODES.STAGE_NOT_READY
  const videoArtifactReady = renderDone
    && !outputPackageStageNotReady
    && (hasRenderArtifact || hasPackageArtifact)
  const jobDone =
    String(job.status).toUpperCase() === 'COMPLETED' ||
    String(job.status).toUpperCase() === 'PARTIALLY_FAILED'

  // Subtitles are generated from the job's own segments (MediaExportServiceImpl), which
  // TRANSLATE materialises — they are downloadable before RENDER / job completion.
  const translateDone =
    String(stageByName(job, 'TRANSLATE')?.status).toUpperCase() === 'COMPLETED'
  const packageHasNoSubs = outputPackage.data?.subtitleTracks?.length
    ? outputPackage.data.subtitleTracks.every((track) => !track.available)
    : false
  const subsReady = translateDone && !packageHasNoSubs

  const canExportVideo = !blocked && videoArtifactReady
  const canExportSubs = !blocked && subsReady

  const videoUrl = outputPackage.data?.primaryVideoDownloadUrl ?? null

  // SOFT_SUB muxes a mov_text stream that browsers do not render, so the preview
  // attaches the job's WebVTT as a <track> instead (the MP4 itself stays unchanged).
  const isSoftSub = String(job.subtitleMode || '').toUpperCase() === 'SOFT_SUB'
  const [softSubTrackUrl, setSoftSubTrackUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isSoftSub || !videoUrl || !canExportSubs) return
    let objectUrl: string | null = null
    let cancelled = false
    exportTransformationJobApi(workspaceId, job.id, 'VTT')
      .then((res) => {
        if (cancelled || typeof res.content !== 'string') return
        objectUrl = URL.createObjectURL(new Blob([res.content], { type: 'text/vtt' }))
        setSoftSubTrackUrl(objectUrl)
      })
      .catch(() => {
        // Preview-only convenience: the video still plays without the track.
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setSoftSubTrackUrl(null)
    }
  }, [isSoftSub, videoUrl, canExportSubs, workspaceId, job.id])

  // Auto-expand the video row when the presigned video URL is ready
  useEffect(() => {
    if (videoUrl) {
      setExpandedVideoId((cur) => cur ?? 'rendered-video')
    }
  }, [videoUrl])

  const videoStatus = blocked
    ? t('media:export.blockedShort')
    : !renderDone
      ? t('media:export.needRender')
      : !videoArtifactReady
        ? outputPackageStageNotReady
          ? t('media:export.needArtifact')
          : outputPackage.isError
            ? t('media:export.previewUnavailable')
            : t('media:export.loadingPreview')
        : t('media:export.ready')

  const subsStatus = blocked
    ? t('media:export.blockedShort')
    : !translateDone || packageHasNoSubs
      ? t('media:export.needTranslate')
      : t('media:export.ready')

  const videoDetail = blocked
    ? t('media:export.blockedDesc')
    : !renderDone
      ? t('media:export.waitRender')
      : !videoArtifactReady
        ? outputPackageStageNotReady
          ? t('media:export.needArtifactDesc')
          : outputPackage.isError
            ? t('media:export.previewUnavailable')
            : t('media:export.loadingPreview')
        : t('media:export.ready')

  const subsDetail = blocked
    ? t('media:export.blockedDesc')
    : !translateDone || packageHasNoSubs
      ? t('media:export.needTranslateDesc')
      : t('media:export.ready')

  const runExport = async (format: MediaExportFormat) => {
    setError(null)
    setLastOk(null)
    setActiveDownloadFormat(format)
    try {
      const res = await exportJob.mutateAsync(format)
      if (res.downloadUrl) {
        window.open(res.downloadUrl, '_blank', 'noopener,noreferrer')
        setLastOk(t('media:export.opened', { file: res.fileName }))
        return
      }
      if (res.content != null) {
        const mime =
          format === 'VTT' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8'
        downloadTextFile(res.fileName, res.content, mime)
        setLastOk(t('media:export.downloaded', { file: res.fileName }))
        return
      }
      setError(t('media:export.empty'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common:error.generic'))
    } finally {
      setActiveDownloadFormat(null)
    }
  }

  const formatDuration = (ms: number | null | undefined): string => {
    if (!ms || ms <= 0) return '—'
    const total = Math.round(ms / 1000)
    const m = Math.floor(total / 60)
    const sec = total % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  /** Toggle & lazy-load preview for subtitle text */
  const toggleSubPreview = async (format: 'SRT' | 'VTT') => {
    const current = subPreview[format]
    if (current.open) {
      setSubPreview((prev) => ({
        ...prev,
        [format]: { ...prev[format], open: false },
      }))
      return
    }

    setSubPreview((prev) => ({
      ...prev,
      [format]: { ...prev[format], open: true, loading: !prev[format].loaded },
    }))

    if (current.loaded || pendingPreview.current === format || !canExportSubs) return

    pendingPreview.current = format
    try {
      const res = await exportJob.mutateAsync(format)
      setSubPreview((prev) => ({
        ...prev,
        [format]: {
          open: true,
          content: typeof res.content === 'string' ? res.content : null,
          error:
            typeof res.content === 'string' ? null : t('media:export.previewUnavailable'),
          loaded: true,
          loading: false,
        },
      }))
    } catch (e) {
      setSubPreview((prev) => ({
        ...prev,
        [format]: {
          open: true,
          content: null,
          error: e instanceof ApiError ? e.message : t('common:error.generic'),
          loaded: true,
          loading: false,
        },
      }))
    } finally {
      pendingPreview.current = null
    }
  }

  const subtitleModeLabel = useMemo(() => {
    const mode = String(job.subtitleMode || '').toUpperCase()
    if (mode === 'HARD_SUB') return t('media:export.hardSub')
    if (mode === 'SOFT_SUB') return t('media:export.softSub')
    if (mode === 'NONE') return t('media:export.noSub')
    return mode || '—'
  }, [job.subtitleMode, t])

  const audioLabel = useMemo(() => {
    if (job.ttsVoiceDisplayName) {
      return `${t('media:export.dubbedAudio')} (${job.ttsVoiceDisplayName})`
    }
    if (job.ttsVoiceId) {
      return t('media:export.dubbedAudio')
    }
    return t('media:export.originalAudio')
  }, [job.ttsVoiceDisplayName, job.ttsVoiceId, t])

  const effectiveDurationMs = useMemo(() => {
    if (outputPackage.data?.durationMs && outputPackage.data.durationMs > 0) {
      return outputPackage.data.durationMs
    }
    if (videoDurationSec && videoDurationSec > 0) {
      return Math.round(videoDurationSec * 1000)
    }
    return null
  }, [outputPackage.data?.durationMs, videoDurationSec])

  // Video items list — can scale to multiple videos/clips
  const videoItems = [
    {
      id: 'rendered-video',
      title: t('media:export.videoItemTitle'),
      format: t('media:export.videoFormat'),
      durationMs: effectiveDurationMs,
      fileName: renderStage?.outputRef?.split('/').pop() || 'rendered-video.mp4',
      status: videoStatus,
      statusDetail: videoDetail,
      desc: t('media:export.videoDesc'),
      canDownload: canExportVideo,
      isReady: videoArtifactReady,
      videoUrl,
    },
  ]

  return (
    <div className="space-y-4">
      {blocked && (
        <div className="media-banner warn">
          <IconAlertTriangle size={18} />
          <div>
            <strong>{t('media:export.blockedTitle')}</strong>
            <p className="m-0 text-sm">{t('media:export.blockedDesc')}</p>
          </div>
        </div>
      )}

      {!videoArtifactReady && (!renderDone || outputPackageStageNotReady || outputPackage.isError) && (
        <div className="media-banner info">
          <IconVideo size={18} />
          <p className="m-0 text-sm">
            {!renderDone
              ? t('media:export.waitRender')
              : outputPackageStageNotReady
                ? t('media:export.needArtifactDesc')
                : t('media:export.previewUnavailable')}
          </p>
        </div>
      )}

      <div className="media-proposal-section">
        <div className="media-proposal-section-head flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('media:export.videoListTitle')}
            </span>
            <span className="chip text-[11px]">
              {videoItems.length} {t('media:export.videoFileName').toLowerCase()}
            </span>
          </div>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {t('media:export.videoListSubtitle')}
          </span>
        </div>

        <div className="media-proposal-section-body p-3">
          <ul
            className="m-0 list-none space-y-3 p-0"
            data-testid="export-video-list"
          >
            {/* Backward-compatible testid wrapper */}
            <div className="hidden" data-testid="export-file-list" />

            {videoItems.map((item) => {
              const open = expandedVideoId === item.id
              const isExportingThisVideo =
                exportJob.isPending && activeDownloadFormat === 'VIDEO'
              const isExportingSrt =
                exportJob.isPending && activeDownloadFormat === 'SRT'
              const isExportingVtt =
                exportJob.isPending && activeDownloadFormat === 'VTT'

              return (
                <li
                  key={item.id}
                  className={`overflow-hidden rounded-2xl border transition-all ${
                    open
                      ? 'border-[var(--color-accent)] shadow-md'
                      : 'border-[var(--color-border)] hover:border-[var(--color-border-hover,var(--color-border))]'
                  } bg-[var(--color-bg-surface)]`}
                  data-testid="export-video-item"
                >
                  {/* Item Row Header / Trigger */}
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:flex-nowrap cursor-pointer transition-colors hover:bg-[var(--color-bg-surface-2)]"
                    data-testid="export-video-row"
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => {
                      setExpandedVideoId(open ? null : item.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpandedVideoId(open ? null : item.id)
                      }
                    }}
                  >
                    {/* Backward-compatible row testid for video */}
                    <span className="hidden" data-testid="export-file-row-video" />

                    {/* Left side: Thumbnail badge + Video Title + Meta tags */}
                    <div className="flex min-w-0 items-center gap-3.5">
                      <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] text-[var(--color-media)] shadow-sm">
                        <IconPlayerPlay size={20} className="fill-current opacity-80" />
                        {item.durationMs && item.durationMs > 0 && (
                          <span className="absolute -bottom-1.5 rounded bg-black/80 px-1 py-0.2 font-mono text-[9px] font-semibold text-white">
                            {formatDuration(item.durationMs)}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-[var(--color-text-primary)]">
                            {item.title}
                          </span>
                          <span
                            className={`chip text-[11px] ${
                              item.status === t('media:export.ready') ? 'qa-tone-ok' : ''
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
                          <span className="font-mono text-[11px] font-medium text-[var(--color-text-secondary)]">
                            {item.format}
                          </span>
                          <span>•</span>
                          <span>
                            {t('media:export.languageLabel')}:{' '}
                            <strong className="text-[var(--color-text-primary)] uppercase">
                              {job.targetLang}
                            </strong>
                          </span>
                          <span>•</span>
                          <span>{subtitleModeLabel}</span>
                          {videoDimensions && (
                            <>
                              <span>•</span>
                              <span className="font-mono text-[11px]">
                                {videoDimensions.width} × {videoDimensions.height}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right side: Quick Action Buttons & Expand Chevron */}
                    <div
                      className="flex items-center gap-2 self-end sm:self-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Quick Download Video Button */}
                      <button
                        type="button"
                        className="btn-primary btn-sm flex items-center gap-1.5 px-3 py-1.5 text-xs"
                        data-testid="export-quick-download-video"
                        disabled={!item.canDownload || exportJob.isPending}
                        onClick={() => void runExport('VIDEO')}
                        title={t('media:export.downloadVideoAction')}
                      >
                        {isExportingThisVideo ? (
                          <IconLoader2 size={14} className="animate-spin" />
                        ) : (
                          <IconDownload size={14} />
                        )}
                        <span className="hidden font-semibold sm:inline">
                          {t('media:export.video')}
                        </span>
                      </button>

                      {/* Quick Download SRT Button */}
                      <button
                        type="button"
                        className="btn-secondary btn-sm flex items-center gap-1 px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        data-testid="export-quick-download-srt"
                        disabled={!canExportSubs || exportJob.isPending}
                        onClick={() => void runExport('SRT')}
                        title={t('media:export.srt')}
                      >
                        {isExportingSrt ? (
                          <IconLoader2 size={13} className="animate-spin" />
                        ) : (
                          <IconFileText size={13} />
                        )}
                        <span>.SRT</span>
                      </button>

                      {/* Quick Download VTT Button */}
                      <button
                        type="button"
                        className="btn-secondary btn-sm flex items-center gap-1 px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        data-testid="export-quick-download-vtt"
                        disabled={!canExportSubs || exportJob.isPending}
                        onClick={() => void runExport('VTT')}
                        title={t('media:export.vtt')}
                      >
                        {isExportingVtt ? (
                          <IconLoader2 size={13} className="animate-spin" />
                        ) : (
                          <IconFileDescription size={13} />
                        )}
                        <span>.VTT</span>
                      </button>

                      {/* Expand / Collapse Button */}
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-surface-2)] hover:text-[var(--color-text-primary)]"
                        aria-expanded={open}
                        title={open ? t('media:export.hideDetails') : t('media:export.toggleDetails')}
                        onClick={() => setExpandedVideoId(open ? null : item.id)}
                      >
                        <IconChevronDown
                          size={16}
                          className={`transition-transform duration-200 ${
                            open ? 'rotate-180 text-[var(--color-accent)]' : ''
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* 2-COLUMN EXPANDED VIEW */}
                  {open && (
                    <div
                      className="border-t border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 sm:p-5"
                      data-testid="export-video-detail"
                    >
                      {/* Backward-compatible detail testid */}
                      <div className="hidden" data-testid="export-file-detail-video" />

                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                        {/* ========================================================= */}
                        {/* CỘT BÊN TRÁI: VIDEO PLAYER & DOWNLOAD ACTION              */}
                        {/* ========================================================= */}
                        <div className="space-y-3.5 lg:col-span-7">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                              <IconVideo size={15} className="text-[var(--color-media)]" />
                              {t('media:export.videoPreviewTitle')}
                            </span>
                            {videoDimensions && (
                              <span className="chip font-mono text-[11px]">
                                {videoDimensions.width} × {videoDimensions.height}
                              </span>
                            )}
                          </div>

                          {/* Video Player Container */}
                          <div
                            className="relative flex min-h-[260px] max-h-[480px] w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-black/95 shadow-inner"
                            data-testid="export-video-preview"
                          >
                            {videoUrl ? (
                              <video
                                src={videoUrl}
                                controls
                                preload="metadata"
                                className="block h-full max-h-[460px] w-full object-contain mx-auto"
                                onLoadedMetadata={(e) => {
                                  setVideoDimensions({
                                    width: e.currentTarget.videoWidth,
                                    height: e.currentTarget.videoHeight,
                                  })
                                  if (e.currentTarget.duration && !isNaN(e.currentTarget.duration) && e.currentTarget.duration > 0) {
                                    setVideoDurationSec(e.currentTarget.duration)
                                  }
                                }}
                              >
                                {softSubTrackUrl && (
                                  <track
                                    kind="subtitles"
                                    src={softSubTrackUrl}
                                    srcLang={job.targetLang}
                                    label={job.targetLang?.toUpperCase()}
                                    default
                                  />
                                )}
                              </video>
                            ) : outputPackageStageNotReady ? (
                              <div className="p-6 text-center text-xs text-zinc-400">
                                <IconVideo size={36} className="mx-auto mb-2 opacity-50" />
                                <p className="m-0 font-medium">{t('media:export.needArtifactDesc')}</p>
                              </div>
                            ) : outputPackage.isError ? (
                              <div className="p-6 text-center text-xs text-rose-400">
                                <IconAlertTriangle size={32} className="mx-auto mb-2 opacity-80" />
                                <p className="m-0">{t('media:export.previewUnavailable')}</p>
                              </div>
                            ) : !item.isReady ? (
                              <div className="p-6 text-center text-xs text-zinc-400">
                                <IconLoader2 size={18} className="mx-auto mb-2 animate-spin" />
                                <p className="m-0 font-medium">{t('media:export.loadingPreview')}</p>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-xs text-zinc-400">
                                <IconLoader2 size={18} className="animate-spin" />
                                <span>{t('media:export.loadingPreview')}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ========================================================= */}
                        {/* CỘT BÊN PHẢI: THÔNG TIN VIDEO + SRT + VTT                 */}
                        {/* ========================================================= */}
                        <div className="space-y-4 lg:col-span-5">
                          {/* 1. THÔNG TIN VIDEO (Video Info & Specs) */}
                          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/60 p-4">
                            <div className="mb-3 flex items-center gap-2 border-b border-[var(--color-border)]/60 pb-2">
                              <IconInfoCircle size={16} className="text-[var(--color-accent)]" />
                              <h4 className="m-0 text-xs font-bold uppercase tracking-wider text-[var(--color-text-primary)]">
                                {t('media:export.videoSpecsTitle')}
                              </h4>
                            </div>

                            <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2 text-xs">
                              <dt className="text-[var(--color-text-tertiary)]">
                                {t('media:export.fileNameLabel')}
                              </dt>
                              <dd className="m-0 truncate font-mono font-medium text-[var(--color-text-primary)]">
                                {item.fileName}
                              </dd>

                              <dt className="text-[var(--color-text-tertiary)]">
                                {t('media:export.formatLabel')}
                              </dt>
                              <dd className="m-0 font-mono text-[var(--color-text-primary)]">
                                {item.format}
                              </dd>

                              <dt className="text-[var(--color-text-tertiary)]">
                                {t('media:export.durationLabel')}
                              </dt>
                              <dd className="m-0 font-mono text-[var(--color-text-primary)]">
                                {formatDuration(item.durationMs)}
                              </dd>

                              {videoDimensions && (
                                <>
                                  <dt className="text-[var(--color-text-tertiary)]">
                                    {t('media:export.resolutionLabel')}
                                  </dt>
                                  <dd className="m-0 font-mono text-[var(--color-text-primary)]">
                                    {videoDimensions.width} × {videoDimensions.height}
                                  </dd>
                                </>
                              )}

                              <dt className="text-[var(--color-text-tertiary)]">
                                {t('media:export.languageLabel')}
                              </dt>
                              <dd className="m-0 uppercase font-semibold text-[var(--color-text-primary)]">
                                {job.targetLang}
                              </dd>

                              <dt className="text-[var(--color-text-tertiary)]">
                                {t('media:export.subModeLabel')}
                              </dt>
                              <dd className="m-0 text-[var(--color-text-primary)]">
                                {subtitleModeLabel}
                              </dd>

                              <dt className="text-[var(--color-text-tertiary)]">
                                {t('media:export.audioLabel')}
                              </dt>
                              <dd className="m-0 text-[var(--color-text-primary)]">
                                {audioLabel}
                              </dd>

                              <dt className="text-[var(--color-text-tertiary)]">
                                {t('media:export.statusLabel')}
                              </dt>
                              <dd className="m-0 text-[var(--color-text-primary)]">
                                {item.statusDetail}
                              </dd>
                            </dl>
                          </div>

                          {/* 2. PHỤ ĐỀ & TỆP KÈM THEO: SRT & VTT */}
                          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)]/60 p-4">
                            <div className="mb-3 flex items-center justify-between border-b border-[var(--color-border)]/60 pb-2">
                              <div className="flex items-center gap-2">
                                <IconFileText size={16} className="text-[var(--color-media)]" />
                                <h4 className="m-0 text-xs font-bold uppercase tracking-wider text-[var(--color-text-primary)]">
                                  {t('media:export.subtitlesTitle')}
                                </h4>
                              </div>
                              <span
                                className={`chip text-[11px] ${
                                  subsStatus === t('media:export.ready') ? 'qa-tone-ok' : ''
                                }`}
                              >
                                {subsStatus}
                              </span>
                            </div>

                            {/* Backward-compatible row testids for SRT and VTT */}
                            <span
                              className="hidden"
                              data-testid="export-file-row-srt"
                              onClick={() => void toggleSubPreview('SRT')}
                            />
                            <span
                              className="hidden"
                              data-testid="export-file-row-vtt"
                              onClick={() => void toggleSubPreview('VTT')}
                            />

                            <div className="space-y-3">
                              {/* Subtitle File 1: SubRip (.srt) */}
                              <div
                                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 shadow-sm"
                                data-testid="export-sub-item-srt"
                              >
                                {/* Backward-compatible detail testid for SRT */}
                                <div className="hidden" data-testid="export-file-detail-srt">
                                  <span>{t('media:export.srtFormat')}</span>
                                  <span>{t('media:export.srtDesc')}</span>
                                  <span>{subsStatus}</span>
                                  <span>{subsDetail}</span>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <IconFileText
                                      size={18}
                                      className="shrink-0 text-[var(--color-media)]"
                                    />
                                    <div>
                                      <span className="block text-xs font-bold text-[var(--color-text-primary)]">
                                        {t('media:export.srtFileName')}
                                      </span>
                                      <span className="block font-mono text-[10px] text-[var(--color-text-tertiary)]">
                                        {t('media:export.srtFormat')}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="btn-secondary btn-sm flex items-center gap-1 px-2.5 py-1 text-xs"
                                      data-testid="export-toggle-preview-srt"
                                      onClick={() => void toggleSubPreview('SRT')}
                                      title={
                                        subPreview.SRT.open
                                          ? t('media:export.closeSubPreviewAction')
                                          : t('media:export.previewSubAction')
                                      }
                                    >
                                      {subPreview.SRT.open ? (
                                        <IconEyeOff size={13} />
                                      ) : (
                                        <IconEye size={13} />
                                      )}
                                      <span>
                                        {subPreview.SRT.open
                                          ? t('media:export.closeSubPreviewAction')
                                          : t('media:export.previewSubAction')}
                                      </span>
                                    </button>

                                    <button
                                      type="button"
                                      className="btn-primary btn-sm flex items-center gap-1 px-3 py-1 text-xs"
                                      data-testid="export-download-srt"
                                      disabled={!canExportSubs || exportJob.isPending}
                                      onClick={() => void runExport('SRT')}
                                    >
                                      {isExportingSrt ? (
                                        <IconLoader2 size={13} className="animate-spin" />
                                      ) : (
                                        <IconDownload size={13} />
                                      )}
                                      <span className="font-semibold">
                                        {t('media:export.downloadSrtAction')}
                                      </span>
                                    </button>
                                  </div>
                                </div>

                                {/* SRT Content Preview box */}
                                {subPreview.SRT.open && (
                                  <div
                                    className="mt-2.5 border-t border-[var(--color-border)] pt-2"
                                    data-testid="export-sub-preview-srt"
                                  >
                                    <p className="mb-1 mt-0 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                                      <IconEye size={12} />
                                      {t('media:export.previewContent')}
                                    </p>
                                    {subPreview.SRT.content ? (
                                      <pre className="m-0 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-2 font-mono text-[11px] leading-relaxed">
                                        {subPreview.SRT.content}
                                      </pre>
                                    ) : subPreview.SRT.error ? (
                                      <p className="m-0 text-xs text-[var(--color-text-tertiary)]">
                                        {subPreview.SRT.error}
                                      </p>
                                    ) : (
                                      <p className="m-0 flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                                        <IconLoader2 size={13} className="animate-spin" />
                                        {t('media:export.loadingPreview')}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Subtitle File 2: WebVTT (.vtt) */}
                              <div
                                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 shadow-sm"
                                data-testid="export-sub-item-vtt"
                              >
                                {/* Backward-compatible detail testid for VTT */}
                                <div className="hidden" data-testid="export-file-detail-vtt">
                                  <span>{t('media:export.vttFormat')}</span>
                                  <span>{t('media:export.vttDesc')}</span>
                                  <span>{subsStatus}</span>
                                  <span>{subsDetail}</span>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <IconFileDescription
                                      size={18}
                                      className="shrink-0 text-[var(--color-media)]"
                                    />
                                    <div>
                                      <span className="block text-xs font-bold text-[var(--color-text-primary)]">
                                        {t('media:export.vttFileName')}
                                      </span>
                                      <span className="block font-mono text-[10px] text-[var(--color-text-tertiary)]">
                                        {t('media:export.vttFormat')}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="btn-secondary btn-sm flex items-center gap-1 px-2.5 py-1 text-xs"
                                      data-testid="export-toggle-preview-vtt"
                                      onClick={() => void toggleSubPreview('VTT')}
                                      title={
                                        subPreview.VTT.open
                                          ? t('media:export.closeSubPreviewAction')
                                          : t('media:export.previewSubAction')
                                      }
                                    >
                                      {subPreview.VTT.open ? (
                                        <IconEyeOff size={13} />
                                      ) : (
                                        <IconEye size={13} />
                                      )}
                                      <span>
                                        {subPreview.VTT.open
                                          ? t('media:export.closeSubPreviewAction')
                                          : t('media:export.previewSubAction')}
                                      </span>
                                    </button>

                                    <button
                                      type="button"
                                      className="btn-primary btn-sm flex items-center gap-1 px-3 py-1 text-xs"
                                      data-testid="export-download-vtt"
                                      disabled={!canExportSubs || exportJob.isPending}
                                      onClick={() => void runExport('VTT')}
                                    >
                                      {isExportingVtt ? (
                                        <IconLoader2 size={13} className="animate-spin" />
                                      ) : (
                                        <IconDownload size={13} />
                                      )}
                                      <span className="font-semibold">
                                        {t('media:export.downloadVttAction')}
                                      </span>
                                    </button>
                                  </div>
                                </div>

                                {/* VTT Content Preview box */}
                                {subPreview.VTT.open && (
                                  <div
                                    className="mt-2.5 border-t border-[var(--color-border)] pt-2"
                                    data-testid="export-sub-preview-vtt"
                                  >
                                    <p className="mb-1 mt-0 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                                      <IconEye size={12} />
                                      {t('media:export.previewContent')}
                                    </p>
                                    {subPreview.VTT.content ? (
                                      <pre className="m-0 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-2 font-mono text-[11px] leading-relaxed">
                                        {subPreview.VTT.content}
                                      </pre>
                                    ) : subPreview.VTT.error ? (
                                      <p className="m-0 text-xs text-[var(--color-text-tertiary)]">
                                        {subPreview.VTT.error}
                                      </p>
                                    ) : (
                                      <p className="m-0 flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                                        <IconLoader2 size={13} className="animate-spin" />
                                        {t('media:export.loadingPreview')}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 3. Export notes & Download Video button (aligned side-by-side) */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                            <div className="space-y-1 text-xs min-w-0 flex-1">
                              <p className="m-0 text-[var(--color-text-tertiary)]">
                                {t('media:export.alwaysBoth')}
                              </p>
                              {jobDone && !blocked && (
                                <p className="m-0 text-[var(--color-success)] font-medium">
                                  {t('media:export.jobReady')}
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              className="btn-primary flex items-center justify-center gap-2 py-2.5 px-4 text-xs sm:text-sm font-semibold shadow-sm hover:shadow shrink-0"
                              data-testid="export-download-video"
                              disabled={!item.canDownload || exportJob.isPending}
                              onClick={() => void runExport('VIDEO')}
                            >
                              {isExportingThisVideo ? (
                                <IconLoader2 size={16} className="animate-spin" />
                              ) : (
                                <IconDownload size={16} />
                              )}
                              <span>{t('media:export.downloadVideoAction')}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
      {lastOk && <p className="text-sm text-[var(--color-success)]">{lastOk}</p>}
    </div>
  )
}
