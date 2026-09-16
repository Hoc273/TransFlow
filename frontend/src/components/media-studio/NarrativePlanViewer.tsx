import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClock, IconLink, IconMessage, IconScript } from '@tabler/icons-react'
import { formatDurationMs } from '@/lib/media'
import type { NarrativePlan } from '@/types/media'

type CutRange = { startMs: number; endMs: number }

export type SourceDialogueSegment = {
  startMs?: number | null
  endMs?: number | null
  sourceText?: string | null
}

type Props = {
  plan: NarrativePlan
  /**
   * Rendering references (backend denormalized union of source_refs).
   * NOT the narrative source of truth — shown only as an internal rendering
   * reference and is not editable. Primary visualization comes from
   * `plan.sections[].source_refs` + `plan.sections[].script_source_lang`.
   */
  cutRanges?: CutRange[]
  /** Proposal total_duration_ms for timeline scale when present. */
  totalDurationMs?: number | null
  /** Optional linked original dialogue segments from STT/Translate. */
  sourceSegments?: SourceDialogueSegment[]
}

export function NarrativePlanViewer({
  plan,
  cutRanges = [],
  totalDurationMs,
  sourceSegments = [],
}: Props) {
  const { t } = useTranslation('media')

  const sectionSpans = useMemo(() => {
    return plan.sections.map((section) => {
      const startMs = section.source_refs[0]?.start_ms
      const endMs = section.source_refs[section.source_refs.length - 1]?.end_ms
      const durationMs = section.source_refs.reduce(
        (total, ref) => total + Math.max(0, ref.end_ms - ref.start_ms),
        0,
      )
      return { startMs, endMs, durationMs }
    })
  }, [plan.sections])

  const timelineMaxMs = useMemo(() => {
    const fromSections = Math.max(
      0,
      ...plan.sections.flatMap((s) => s.source_refs.map((r) => r.end_ms)),
    )
    const fromCuts = Math.max(0, ...cutRanges.map((r) => r.endMs))
    const fromTotal = totalDurationMs ?? 0
    const fromTarget = plan.target_duration_ms ?? 0
    return Math.max(fromSections, fromCuts, fromTotal, fromTarget, 1)
  }, [plan.sections, plan.target_duration_ms, cutRanges, totalDurationMs])

  const matchedDialoguesBySection = useMemo(() => {
    if (!sourceSegments || sourceSegments.length === 0) return []
    return sectionSpans.map((span) => {
      if (span.startMs == null || span.endMs == null) return []
      return sourceSegments
        .filter((seg) => {
          if (seg.startMs == null || seg.endMs == null) return false
          return seg.startMs < span.endMs! && seg.endMs > span.startMs! && Boolean(seg.sourceText?.trim())
        })
        .map((seg) => seg.sourceText!.trim())
    })
  }, [sectionSpans, sourceSegments])

  return (
    <div className="space-y-3" data-testid="narrative-plan-viewer">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {plan.title && <h4 className="m-0 text-sm font-semibold">{plan.title}</h4>}
          {plan.global_reasoning_note && (
            <p className="mb-0 mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {plan.global_reasoning_note}
            </p>
          )}
        </div>
        {plan.target_duration_ms != null && (
          <span className="media-range-chip inline-flex items-center gap-1">
            <IconClock size={12} />
            {formatDurationMs(plan.target_duration_ms)}
          </span>
        )}
      </div>

      {/* Section beat timeline — source-grounded spans on the original timeline.
          Primary narrative visualization, derived from plan_body.source_refs
          (the narrative source of truth), NOT from denormalized cut_ranges. */}
      {plan.sections.length > 0 && (
        <div className="media-narrative-timeline" data-testid="narrative-section-timeline">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            {t('narrative.sectionTimeline')}
          </div>
          <div className="media-narrative-timeline-track">
            {plan.sections.map((section, idx) => {
              const span = sectionSpans[idx]
              if (span.startMs == null || span.endMs == null) return null
              const left = Math.max(0, Math.min(100, (span.startMs / timelineMaxMs) * 100))
              const width = Math.max(
                2,
                Math.min(100 - left, ((span.endMs - span.startMs) / timelineMaxMs) * 100),
              )
              const matched = matchedDialoguesBySection[idx] ?? []
              const tooltipStyle: React.CSSProperties =
                left < 20
                  ? { left: '0', transform: 'none' }
                  : left > 80
                    ? { right: '0', left: 'auto', transform: 'none' }
                    : { left: '50%', transform: 'translateX(-50%)' }

              return (
                <span
                  key={section.seq}
                  className="media-narrative-timeline-seg group"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  tabIndex={0}
                >
                  {section.seq}

                  <div
                    className="media-narrative-tooltip pointer-events-none absolute bottom-full mb-2 hidden group-hover:block group-focus:block z-50 w-72 sm:w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 text-left shadow-2xl transition-all"
                    style={tooltipStyle}
                    data-testid={`narrative-tooltip-${section.seq}`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] pb-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[var(--color-media,var(--color-accent))] text-[10px] font-bold text-white">
                        #{section.seq}
                      </span>
                      <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                        {section.heading || t('narrative.section', { n: section.seq })}
                      </span>
                      {section.beat_type && (
                        <span className="rounded bg-[var(--color-bg-surface-3)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
                          {section.beat_type}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                      <IconClock size={13} className="shrink-0" />
                      <span className="font-mono">
                        {formatDurationMs(span.startMs)} – {formatDurationMs(span.endMs)}
                      </span>
                      <span>({formatDurationMs(span.durationMs)})</span>
                    </div>

                    {section.script_source_lang && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-media,var(--color-accent))]">
                          <IconScript size={12} />
                          <span>{t('narrative.tooltipSummaryScript')}</span>
                        </div>
                        <p className="m-0 text-xs leading-relaxed text-[var(--color-text-primary)] line-clamp-3">
                          {section.script_source_lang}
                        </p>
                      </div>
                    )}

                    <div className="mt-2 border-t border-[var(--color-border)]/60 pt-2 space-y-1">
                      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                        <IconMessage size={12} />
                        <span>{t('narrative.tooltipOriginalDialogue')}</span>
                      </div>
                      <p className="m-0 text-xs italic leading-relaxed text-[var(--color-text-secondary)] line-clamp-3">
                        {matched.length > 0 ? matched.join(' ') : t('narrative.tooltipNoDialogue')}
                      </p>
                    </div>
                  </div>
                </span>
              )
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--color-text-tertiary)]">
            <span>0:00</span>
            <span>{formatDurationMs(timelineMaxMs)}</span>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {plan.sections.map((section, idx) => {
          const span = sectionSpans[idx]

          return (
            <section
              key={section.seq}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="media-proposal-rank">{section.seq}</span>
                <span className="text-sm font-semibold">
                  {section.heading || t('narrative.section', { n: section.seq })}
                </span>
                {section.beat_type && (
                  <span className="media-range-chip">
                    {t('narrative.beat')}: {section.beat_type}
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-[var(--color-text-tertiary)]">
                  {span.durationMs > 0 ? formatDurationMs(span.durationMs) : '—'}
                </span>
              </div>

              <div className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-[var(--color-text-primary)]">
                <IconScript size={14} className="mt-0.5 shrink-0 text-[var(--color-media)]" />
                <span>{section.script_source_lang}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
                  <IconLink size={12} />
                  {t('narrative.sourceRefs')}
                </span>
                {section.source_refs.map((ref, index) => (
                  <span key={`${ref.start_ms}-${ref.end_ms}-${index}`} className="media-range-chip">
                    {formatDurationMs(ref.start_ms)}–{formatDurationMs(ref.end_ms)}
                  </span>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--color-text-tertiary)]">
                <span>
                  {t('narrative.timeline')}:{' '}
                  {span.startMs != null ? formatDurationMs(span.startMs) : '—'}–
                  {span.endMs != null ? formatDurationMs(span.endMs) : '—'}
                </span>
                <span>
                  {t('narrative.duration')}:{' '}
                  {span.durationMs > 0 ? formatDurationMs(span.durationMs) : '—'}
                </span>
              </div>
            </section>
          )
        })}
      </div>

      {/* Rendering references (denormalized cut_ranges) — secondary, internal,
          non-editable. Not the authoritative narrative body; shown for
          transparency into the render pipeline's coverage only. */}
      {cutRanges.length > 0 && (
        <div className="media-narrative-engine-cuts" data-testid="narrative-engine-cuts">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            {t('narrative.engineCuts')}
          </div>
          <p className="mb-2 mt-0 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
            {t('narrative.engineCutsHint')}
          </p>
          <div className="media-cut-timeline-track media-cut-timeline-track-engine" aria-hidden>
            {cutRanges.map((r, i) => {
              const left = Math.max(0, Math.min(100, (r.startMs / timelineMaxMs) * 100))
              const width = Math.max(
                1.5,
                Math.min(100 - left, ((r.endMs - r.startMs) / timelineMaxMs) * 100),
              )
              return (
                <span
                  key={i}
                  className="media-cut-timeline-seg engine"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              )
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {cutRanges.map((r, i) => (
              <span key={i} className="media-range-chip">
                {formatDurationMs(r.startMs)}–{formatDurationMs(r.endMs)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
