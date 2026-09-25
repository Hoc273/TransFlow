import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconDeviceFloppy,
  IconLanguage,
  IconRefresh,
  IconSearch,
  IconSubtitles,
} from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { severityBand } from '@/components/media-studio/MediaQaPanel'
import {
  useBatchEditMediaSegments,
  useEditMediaSegment,
  useMediaJobQaIssues,
  useMediaSubtitles,
  useRerunTtsRender,
} from '@/hooks/useMedia'
import { cn } from '@/lib/cn'
import { formatDurationMs, resolveWorkflowMode, subtitleToSegmentItem } from '@/lib/media'
import { ApiError } from '@/types/api'
import type { MediaJob, MediaSubtitleCue, RenderFailureDiagnostics, SegmentItem } from '@/types/media'
import type { QaIssue } from '@/types/qa'

type Props = {
  workspaceId: string
  job: MediaJob
  /** Workbench sync: cue selected from the QA strip or video pane. */
  selectedCueId?: string | null
  /** Row click → parent seeks the video to the cue start. */
  onSelectCue?: (seg: SegmentItem) => void
  /** Live playback time (ms) from the video pane, for the playing-row highlight. */
  playingTimeMs?: number
  /** Navigation bridge: proceed to the downstream finish & render step */
  onProceedToNextStep?: () => void
}

type Draft = {
  targetText: string
  startMs: string
  endMs: string
}

type CueFilter = 'all' | 'qa' | 'critical'

const isNumeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Batch save hard limit — mirrors the backend @Size(max=200). */
const MAX_BATCH = 200

/**
 * W3 diagnostics chips (docs/19 §1.8.2): only values actually present and numeric are
 * rendered; missingTailMs is shown ONLY when positive (never presented as missing when
 * negative/absent); videoDurationMs is intentionally not rendered (FE-visible subset).
 */
function DiagnosticChips({ diag, t }: { diag: RenderFailureDiagnostics | null | undefined; t: (k: string) => string }) {
  if (!diag) return null
  const chips: { label: string; value: number }[] = []
  const generative = diag.durationMismatchKind === 'GENERATIVE_TTS_TARGET'
  if (generative) {
    if (isNumeric(diag.actualTtsDurationMs)) {
      chips.push({ label: 'media:subtitles.diag.actualTtsDuration', value: diag.actualTtsDurationMs })
    }
    if (isNumeric(diag.targetDurationMs)) {
      chips.push({ label: 'media:subtitles.diag.targetDuration', value: diag.targetDurationMs })
    }
  } else {
    if (isNumeric(diag.expectedDurationMs)) {
      chips.push({ label: 'media:subtitles.diag.expectedDuration', value: diag.expectedDurationMs })
    }
    if (isNumeric(diag.subtitleTimelineSpanMs)) {
      chips.push({ label: 'media:subtitles.diag.timelineSpan', value: diag.subtitleTimelineSpanMs })
    }
    if (isNumeric(diag.lastCueEndMs)) {
      chips.push({ label: 'media:subtitles.diag.lastCueEnd', value: diag.lastCueEndMs })
    }
  }
  if (isNumeric(diag.missingTailMs) && diag.missingTailMs > 0) {
    chips.push({ label: 'media:subtitles.diag.missingTail', value: diag.missingTailMs })
  }
  if (isNumeric(diag.deltaMs)) {
    chips.push({ label: 'media:subtitles.diag.delta', value: diag.deltaMs })
  }
  if (isNumeric(diag.toleranceMs)) {
    chips.push({ label: 'media:subtitles.diag.tolerance', value: diag.toleranceMs })
  }
  if (!chips.length) return null
  return (
    <div className="media-subtitle-diag-row">
      {chips.map((c) => (
        <span key={c.label} className="media-subtitle-diag-chip">
          {t(c.label)}: {formatDurationMs(Math.abs(c.value))}
        </span>
      ))}
    </div>
  )
}

function draftFor(seg: SegmentItem): Draft {
  return {
    targetText: seg.targetText ?? '',
    startMs: seg.startMs != null ? String(seg.startMs) : '',
    endMs: seg.endMs != null ? String(seg.endMs) : '',
  }
}

/** A draft is dirty when it would send something different from the server value. */
function isDirty(seg: SegmentItem, d: Draft | undefined): boolean {
  if (!d) return false
  if (d.targetText !== (seg.targetText ?? '')) return true
  if (d.startMs.trim() !== '' && Number(d.startMs) !== seg.startMs) return true
  if (d.endMs.trim() !== '' && Number(d.endMs) !== seg.endMs) return true
  return false
}

/**
 * Media subtitle cue list — review workbench right column (docs/19 §1.8.2
 * redesign). Compact rows with filter/search; clicking a row opens the inline
 * editor and seeks the video. Saves go per-row (PUT …/segments/{id}) or all
 * at once (PUT …/segments/batch) — both mark TTS/RENDER STALE backend-side.
 */
export function MediaSubtitleEditor({
  workspaceId,
  job,
  selectedCueId,
  onSelectCue,
  playingTimeMs = 0,
  onProceedToNextStep,
}: Props) {
  const { t } = useTranslation(['media', 'common'])
  const isManual = resolveWorkflowMode(job) === 'MANUAL'
  const { data: realSubtitles = [], isLoading } = useMediaSubtitles(workspaceId, job.id)
  const { data: realQaIssues = [] } = useMediaJobQaIssues(workspaceId, job.id)
  const edit = useEditMediaSegment(workspaceId, job.id, job.translationJobId)
  const batch = useBatchEditMediaSegments(workspaceId, job.id, job.translationJobId)
  const rerun = useRerunTtsRender(workspaceId, job.id)

  const canRerun = useMemo(() => {
    if (
      job.stages.some(
        (s) =>
          (s.stageName === 'TTS' || s.stageName === 'RENDER') && s.status === 'STALE',
      )
    ) {
      return true
    }
    // W3 dead-end fix (docs/19 §1.8.2): original-only + HARD_SUB may leave TTS SKIPPED
    // while RENDER is gate-FAILED with a structured reason — Reprocess must stay
    // available. Scoped strictly to the two structured reasons; other FAILED renders
    // keep the existing behavior (no button).
    return job.stages.some(
      (s) =>
        s.stageName === 'RENDER' &&
        s.status === 'FAILED' &&
        (s.failureReason === 'EMPTY_CUES' || s.failureReason === 'DURATION_MISMATCH'),
    )
  }, [job.stages])

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  // A pre-selected cue (workbench jump) starts expanded — SSR included.
  const [expandedId, setExpandedId] = useState<string | null>(selectedCueId ?? null)
  const [filter, setFilter] = useState<CueFilter>('all')
  const [query, setQuery] = useState('')
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const segments: SegmentItem[] = useMemo(
    () => realSubtitles.map((sub: MediaSubtitleCue) => subtitleToSegmentItem(sub, realQaIssues)),
    [realSubtitles, realQaIssues],
  )

  // QA cross-check marker (docs/19 §1.8.2): open issues per segment, tone from
  // the worst severity band. Same linked-job data as MediaQaPanel — no extra query.
  const segmentQa: Record<string, QaIssue[]> = useMemo(() => {
    const map: Record<string, QaIssue[]> = {}
    for (const s of segments) {
      const open = (s.qaIssues ?? []).filter((i) => !i.resolved)
      if (open.length > 0) map[s.id] = open
    }
    return map
  }, [segments])

  function qaToneClass(issues: QaIssue[]): string {
    const worst = issues.reduce(
      (acc, i) => {
        const band = severityBand(i.severity)
        if (band === 'HIGH') return 'qa-tone-critical'
        if (band === 'MEDIUM' && acc !== 'qa-tone-critical') return 'qa-tone-warning'
        if (band === 'LOW' && acc === 'qa-tone-neutral') return 'qa-tone-ok'
        return acc
      },
      'qa-tone-neutral' as 'qa-tone-critical' | 'qa-tone-warning' | 'qa-tone-ok' | 'qa-tone-neutral',
    )
    return worst
  }

  useEffect(() => {
    if (!segments.length) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const s of segments) {
        if (!next[s.id]) {
          next[s.id] = draftFor(s)
        }
      }
      return next
    })
  }, [segments])

  // Workbench sync: a cue selected in the QA strip / video pane opens its row.
  useEffect(() => {
    if (!selectedCueId) return
    setExpandedId(selectedCueId)
    const el = rowRefs.current[selectedCueId]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedCueId])

  const dirtyIds = useMemo(
    () => segments.filter((s) => isDirty(s, drafts[s.id])).map((s) => s.id),
    [segments, drafts],
  )
  const dirtySet = useMemo(() => new Set(dirtyIds), [dirtyIds])

  const hasHighSeverityIssues = useMemo(
    () =>
      Object.values(segmentQa).some((issues) =>
        issues.some((i) => severityBand(i.severity) === 'HIGH'),
      ),
    [segmentQa],
  )

  const filteredSegments = useMemo(() => {
    const q = query.trim().toLowerCase()
    return segments.filter((s) => {
      if (filter === 'qa' && !segmentQa[s.id]) return false
      if (filter === 'critical') {
        const worst = (segmentQa[s.id] ?? []).some(
          (i) => severityBand(i.severity) === 'HIGH',
        )
        if (!worst) return false
      }
      if (q) {
        const haystack = `${s.targetText ?? ''}\n${s.sourceText ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [segments, filter, query, segmentQa])

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
        {t('media:subtitles.loading')}
      </div>
    )
  }

  if (segments.length === 0) {
    return (
      <EmptyState
        icon={<IconSubtitles size={36} stroke={1.25} />}
        title={t('media:subtitles.emptyTitle')}
        description={t('media:subtitles.emptyDesc')}
        className="py-10"
      />
    )
  }

  const parseTiming = (d: Draft) => {
    const startMs = d.startMs.trim() === '' ? null : Number(d.startMs)
    const endMs = d.endMs.trim() === '' ? null : Number(d.endMs)
    if (startMs != null && (Number.isNaN(startMs) || startMs < 0)) return { error: 'invalidTiming' as const }
    if (endMs != null && (Number.isNaN(endMs) || endMs < 0)) return { error: 'invalidTiming' as const }
    if (startMs != null && endMs != null && endMs <= startMs) return { error: 'invalidRange' as const }
    return { startMs, endMs }
  }

  const save = (seg: SegmentItem) => {
    const d = drafts[seg.id]
    if (!d) return
    const timing = parseTiming(d)
    if ('error' in timing) {
      setError(t(`media:subtitles.${timing.error}`))
      return
    }
    setError(null)
    setNotice(null)
    setSavedId(null)
    void edit
      .mutateAsync({
        segmentId: seg.id,
        body: {
          targetText: d.targetText,
          startMs: timing.startMs ?? undefined,
          endMs: timing.endMs ?? undefined,
        },
      })
      .then(() => setSavedId(seg.id))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : t('common:error.generic')),
      )
  }

  const saveAll = () => {
    if (dirtyIds.length === 0 || batch.isPending) return
    if (dirtyIds.length > MAX_BATCH) {
      setError(t('media:subtitles.tooManyToSave', { limit: MAX_BATCH }))
      return
    }
    const items = []
    for (const seg of segments) {
      if (!dirtySet.has(seg.id)) continue
      const d = drafts[seg.id]
      const timing = parseTiming(d)
      if ('error' in timing) {
        setError(t(`media:subtitles.${timing.error}Seq`, { seq: seg.seq }))
        setExpandedId(seg.id)
        return
      }
      items.push({
        segmentId: seg.id,
        targetText: d.targetText,
        startMs: timing.startMs ?? undefined,
        endMs: timing.endMs ?? undefined,
      })
    }
    setError(null)
    setNotice(null)
    setSavedId(null)
    void batch
      .mutateAsync(items)
      .then(() => setNotice(t('media:subtitles.savedAll', { count: items.length })))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : t('common:error.generic')),
      )
  }

  const saveAllAndNext = () => {
    if (dirtyIds.length === 0) {
      onProceedToNextStep?.()
      return
    }
    if (batch.isPending) return
    if (dirtyIds.length > MAX_BATCH) {
      setError(t('media:subtitles.tooManyToSave', { limit: MAX_BATCH }))
      return
    }
    const items = []
    for (const seg of segments) {
      if (!dirtySet.has(seg.id)) continue
      const d = drafts[seg.id]
      const timing = parseTiming(d)
      if ('error' in timing) {
        setError(t(`media:subtitles.${timing.error}Seq`, { seq: seg.seq }))
        setExpandedId(seg.id)
        return
      }
      items.push({
        segmentId: seg.id,
        targetText: d.targetText,
        startMs: timing.startMs ?? undefined,
        endMs: timing.endMs ?? undefined,
      })
    }
    setError(null)
    setNotice(null)
    setSavedId(null)
    void batch
      .mutateAsync(items)
      .then(() => {
        setNotice(t('media:subtitles.savedAll', { count: items.length }))
        onProceedToNextStep?.()
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : t('common:error.generic')),
      )
  }

  const toggleRow = (seg: SegmentItem) => {
    setNotice(null)
    setError(null)
    const next = expandedId === seg.id ? null : seg.id
    setExpandedId(next)
    if (next === seg.id) onSelectCue?.(seg)
  }

  return (
    <div className="media-subtitle-editor space-y-3">
      <div className="media-subtitle-toolbar">
        <div className="media-subtitle-toolbar-copy">
          <div className="media-subtitle-toolbar-title">
            <IconSubtitles size={16} className="text-[var(--color-accent)]" />
            {t('media:subtitles.panelTitle')}
          </div>
          <p className="media-subtitle-toolbar-hint">{t('media:subtitles.hint')}</p>
        </div>
        {canRerun && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="btn-media-secondary whitespace-nowrap text-xs"
              disabled={rerun.isPending}
              onClick={() => void rerun.mutateAsync().catch(() => undefined)}
            >
              <IconRefresh size={14} className={rerun.isPending ? 'animate-spin' : undefined} />
              {t('media:subtitles.rerun')}
            </button>
          </div>
        )}
      </div>

      <div className="media-subtitle-filters">
        <div className="flex items-center gap-1">
          {(['all', 'qa', 'critical'] as CueFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={cn(
                'media-subtitle-filter-chip',
                filter === f && 'active',
                f === 'critical' && filter !== 'critical' && hasHighSeverityIssues && 'attention',
              )}
              data-testid={`subtitle-filter-${f}`}
              onClick={() => setFilter(f)}
            >
              {t(`media:subtitles.filter.${f}`)}
            </button>
          ))}
        </div>
        <label className="media-subtitle-search">
          <IconSearch size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('media:subtitles.searchPlaceholder')}
            data-testid="subtitle-search"
          />
        </label>
        <span className="media-subtitle-count" data-testid="subtitle-count">
          {filter === 'all' && query.trim() === ''
            ? t('media:subtitles.segmentCount', { count: segments.length })
            : `${filteredSegments.length}/${segments.length}`}
        </span>
      </div>

      {(() => {
        // W3 structured recovery banner (docs/19 §1.8.2): shown ONLY when the RENDER
        // gate failed with a structured reason — never derived from errorMessage text.
        const renderStage = job.stages.find((s) => s.stageName === 'RENDER')
        if (!renderStage || renderStage.status !== 'FAILED') return null
        if (renderStage.failureReason === 'EMPTY_CUES') {
          return (
            <div className="media-banner warn">
              <IconAlertTriangle size={18} />
              <div className="space-y-1">
                <p className="m-0 text-sm font-semibold">
                  {t('media:subtitles.recovery.emptyCuesTitle')}
                </p>
                <p className="m-0 text-sm">{t('media:subtitles.recovery.emptyCuesBody')}</p>
                <p className="m-0 text-sm">{t('media:subtitles.recovery.action')}</p>
              </div>
            </div>
          )
        }
        if (renderStage.failureReason === 'DURATION_MISMATCH') {
          const diag = renderStage.failureDiagnostics
          const generative = diag?.durationMismatchKind === 'GENERATIVE_TTS_TARGET'
          const actual = isNumeric(diag?.actualTtsDurationMs)
            ? formatDurationMs(diag.actualTtsDurationMs)
            : formatDurationMs(diag?.subtitleTimelineSpanMs ?? 0)
          const target = isNumeric(diag?.targetDurationMs)
            ? formatDurationMs(diag.targetDurationMs)
            : formatDurationMs(diag?.expectedDurationMs ?? 0)
          const missing = formatDurationMs(Math.max(0, diag?.missingTailMs ?? 0))
          return (
            <div className="media-banner warn">
              <IconAlertTriangle size={18} />
              <div className="space-y-1">
                <p className="m-0 text-sm font-semibold">
                  {t(
                    generative
                      ? 'media:subtitles.recovery.generativeTtsTitle'
                      : 'media:subtitles.recovery.durationMismatchTitle',
                  )}
                </p>
                <p className="m-0 text-sm">
                  {generative
                    ? t('media:subtitles.recovery.generativeTtsBody', {
                        actual,
                        target,
                        missing,
                      })
                    : t('media:subtitles.recovery.durationMismatchBody')}
                </p>
                <DiagnosticChips diag={diag} t={t} />
                <p className="m-0 text-sm">
                  {t(
                    generative
                      ? 'media:subtitles.recovery.generativeTtsAction'
                      : 'media:subtitles.recovery.action',
                  )}
                </p>
              </div>
            </div>
          )
        }
        return null
      })()}

      <div className="media-subtitle-meta-bar">
        <span>{t('media:subtitles.timelineNote')}</span>
        <span className="media-subtitle-meta-sep">·</span>
        <span>{t('media:subtitles.seekNote')}</span>
      </div>

      {(error || notice) && (
        <div className={error ? 'media-banner warn' : 'media-banner info'}>
          <p className="m-0 text-sm">{error ?? notice}</p>
        </div>
      )}

      <div className="media-subtitle-list" data-testid="subtitle-list">
        {filteredSegments.map((seg) => {
          const d = drafts[seg.id] ?? draftFor(seg)
          const dirty = dirtySet.has(seg.id)
          const qaIssues = segmentQa[seg.id]
          const expanded = expandedId === seg.id
          const playing =
            seg.startMs != null && seg.endMs != null
            && playingTimeMs >= seg.startMs && playingTimeMs < seg.endMs

          return (
            <div
              key={seg.id}
              ref={(el) => {
                rowRefs.current[seg.id] = el
              }}
              className={cn(
                'media-subtitle-row',
                qaIssues && `has-qa ${qaToneClass(qaIssues)}`,
                playing && 'playing',
                expanded && 'expanded',
              )}
              data-testid={`subtitle-row-${seg.seq}`}
            >
              <button
                type="button"
                className="media-subtitle-row-head"
                onClick={() => toggleRow(seg)}
                aria-expanded={expanded}
                data-testid={`subtitle-row-head-${seg.seq}`}
              >
                <IconChevronDown
                  size={14}
                  className={cn('media-subtitle-row-chevron', !expanded && '-rotate-90')}
                />
                <span className="media-subtitle-seq">#{seg.seq}</span>
                <span className="media-subtitle-time-preview">
                  <IconClock size={12} />
                  {formatDurationMs(seg.startMs ?? 0)} – {formatDurationMs(seg.endMs ?? 0)}
                </span>
                <span className="media-subtitle-row-target">
                  {d.targetText || <span className="italic opacity-60">—</span>}
                </span>
                {dirty && (
                  <span
                    className="media-subtitle-dirty-dot"
                    title={t('media:subtitles.unsaved')}
                    data-testid={`subtitle-dirty-${seg.seq}`}
                  />
                )}
                {qaIssues && (
                  <span
                    className={`media-subtitle-qa-chip ${qaToneClass(qaIssues)}`}
                    title={t('media:subtitles.qaIssues', { count: qaIssues.length })}
                    data-testid={`subtitle-qa-chip-${seg.seq}`}
                  >
                    <IconAlertTriangle size={11} />
                    {qaIssues.length}
                  </span>
                )}
                {savedId === seg.id && (
                  <span className="media-subtitle-saved">{t('media:subtitles.saved')}</span>
                )}
              </button>

              {expanded && (
                <div className="media-subtitle-row-editor">
                  <div className="media-subtitle-source">
                    <span className="media-subtitle-field-label">
                      <IconLanguage size={12} />
                      {t('media:subtitles.sourceLabel')}
                    </span>
                    <p className="media-subtitle-source-text">{seg.sourceText}</p>
                  </div>

                  <label className="media-subtitle-target-label">
                    <span className="media-subtitle-field-label">
                      {t('media:subtitles.targetLabel')}
                    </span>
                    <textarea
                      className="field-input media-subtitle-target-input"
                      value={d.targetText}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [seg.id]: { ...d, targetText: e.target.value },
                        }))
                      }
                      rows={3}
                      data-testid={`subtitle-target-${seg.seq}`}
                    />
                  </label>

                  <div className="media-subtitle-timing-row">
                    <label className="field-label media-subtitle-timing-field">
                      <span>{t('media:subtitles.startMs')}</span>
                      <input
                        className="field-input font-mono text-xs"
                        value={d.startMs}
                        inputMode="numeric"
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [seg.id]: { ...d, startMs: e.target.value },
                          }))
                        }
                      />
                      <span className="field-help">{t('media:subtitles.msHelp')}</span>
                    </label>
                    <label className="field-label media-subtitle-timing-field">
                      <span>{t('media:subtitles.endMs')}</span>
                      <input
                        className="field-input font-mono text-xs"
                        value={d.endMs}
                        inputMode="numeric"
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [seg.id]: { ...d, endMs: e.target.value },
                          }))
                        }
                      />
                      <span className="field-help">{t('media:subtitles.msHelp')}</span>
                    </label>
                    <button
                      type="button"
                      className="btn-media-secondary media-subtitle-save-btn"
                      disabled={edit.isPending}
                      onClick={() => save(seg)}
                    >
                      <IconDeviceFloppy size={14} />
                      {t('media:subtitles.save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {filteredSegments.length === 0 && (
          <p className="m-0 py-6 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('media:subtitles.noMatch')}
          </p>
        )}
      </div>

      {(dirtyIds.length > 0 || onProceedToNextStep) && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
          data-testid="subtitle-footer-bar"
        >
          <div className="text-xs text-[var(--color-text-secondary)]">
            {dirtyIds.length > 0
              ? t('media:subtitles.unsavedEditsHint', { count: dirtyIds.length })
              : t('media:subtitles.readyToProceedHint')}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {dirtyIds.length > 0 ? (
              <>
                <button
                  type="button"
                  className="btn-media-secondary whitespace-nowrap text-xs"
                  disabled={batch.isPending}
                  data-testid="subtitle-save-all"
                  onClick={saveAll}
                >
                  <IconDeviceFloppy size={14} />
                  {t('media:subtitles.saveAll', { count: dirtyIds.length })}
                </button>
                {onProceedToNextStep && (
                  <button
                    type="button"
                    className="btn-primary whitespace-nowrap text-xs"
                    disabled={batch.isPending}
                    data-testid="subtitle-save-and-next"
                    onClick={saveAllAndNext}
                  >
                    <IconCheck size={14} />
                    {isManual
                      ? t('media:subtitles.saveAllAndNextManual')
                      : t('media:subtitles.saveAllAndNext')}
                    <IconChevronRight size={14} />
                  </button>
                )}
              </>
            ) : (
              onProceedToNextStep && (
                <button
                  type="button"
                  className="btn-primary whitespace-nowrap text-xs"
                  data-testid="subtitle-next-step"
                  onClick={onProceedToNextStep}
                >
                  {isManual
                    ? t('media:subtitles.nextStepManual')
                    : t('media:subtitles.nextStep')}
                  <IconChevronRight size={14} />
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
