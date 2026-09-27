import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconClock,
  IconFlame,
  IconLoader2,
  IconMovie,
  IconSparkles,
} from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { cn } from '@/lib/cn'
import { formatDurationMs } from '@/lib/media'
import type { MediaSummaryProposal } from '@/types/media'

type Props = {
  open: boolean
  onClose: () => void
  proposal?: MediaSummaryProposal | null
  totalDurationMs?: number | null
  requestedDurationSeconds?: number | null
  onRefine: (compiledFeedback: string) => Promise<void>
  isPending: boolean
}

type ToneOption = 'balanced' | 'dynamic' | 'informative' | 'dramatic'
type FocusOption = 'balanced' | 'visual' | 'dialogue'

const DURATION_PRESETS = [30, 60, 90, 120, 180]

export function RefineNarrativeModal({
  open,
  onClose,
  proposal,
  totalDurationMs,
  requestedDurationSeconds,
  onRefine,
  isPending,
}: Props) {
  const { t } = useTranslation(['media', 'common'])
  const plan = proposal?.planBody

  const [targetDuration, setTargetDuration] = useState<number | null>(
    requestedDurationSeconds ?? (plan?.target_duration_ms ? Math.round(plan.target_duration_ms / 1000) : null),
  )
  const [tone, setTone] = useState<ToneOption>('balanced')
  const [focus, setFocus] = useState<FocusOption>('balanced')
  const [userFeedback, setUserFeedback] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Section coverage spans derived from proposal plan_body
  const sectionSpans = useMemo(() => {
    if (!plan?.sections) return []
    return plan.sections.map((section) => {
      const refs = section.source_refs ?? []
      const startMs = refs[0]?.start_ms ?? 0
      const endMs = refs[refs.length - 1]?.end_ms ?? 0
      const durationMs = refs.reduce(
        (total, ref) => total + Math.max(0, ref.end_ms - ref.start_ms),
        0,
      )
      return { startMs, endMs, durationMs, refs, section }
    })
  }, [plan?.sections])

  const actualCoverageMs = useMemo(
    () => sectionSpans.reduce((total, span) => total + span.durationMs, 0),
    [sectionSpans],
  )
  const coverageTargetMs = plan?.target_duration_ms ?? (
    requestedDurationSeconds != null ? requestedDurationSeconds * 1000 : null
  )

  const timelineMaxMs = useMemo(() => {
    if (!plan?.sections || plan.sections.length === 0) return 1
    const fromSections = Math.max(
      0,
      ...plan.sections.flatMap((s) => s.source_refs.map((r) => r.end_ms)),
    )
    const fromTotal = totalDurationMs ?? 0
    const fromTarget = plan.target_duration_ms ?? 0
    return Math.max(fromSections, fromTotal, fromTarget, 1)
  }, [plan?.sections, plan?.target_duration_ms, totalDurationMs])

  const quickTags = useMemo(() => [
    t('refine.quickTagList.0', { defaultValue: 'Ưu tiên phân cảnh hành động kịch tính' }),
    t('refine.quickTagList.1', { defaultValue: 'Rút ngắn phần mở đầu, vào thẳng nội dung' }),
    t('refine.quickTagList.2', { defaultValue: 'Giữ chi tiết giới thiệu sản phẩm / món ăn' }),
    t('refine.quickTagList.3', { defaultValue: 'Tăng nhịp điệu kể chuyện sôi động hơn' }),
  ], [t])

  const handleAddTag = (tag: string) => {
    setUserFeedback((prev) => {
      const trimmed = prev.trim()
      if (!trimmed) return tag
      if (trimmed.includes(tag)) return prev
      return `${trimmed}. ${tag}`
    })
  }

  const compileFeedback = (): string => {
    const parts: string[] = []
    if (targetDuration && targetDuration !== requestedDurationSeconds) {
      parts.push(`[${t('refine.targetDuration')}: ${targetDuration}s]`)
    }
    if (tone !== 'balanced') {
      const toneLabels: Record<ToneOption, string> = {
        balanced: t('refine.toneBalanced'),
        dynamic: t('refine.toneDynamic'),
        informative: t('refine.toneInformative'),
        dramatic: t('refine.toneDramatic'),
      }
      parts.push(`[${t('refine.tone')}: ${toneLabels[tone] || tone}]`)
    }
    if (focus !== 'balanced') {
      const focusLabels: Record<FocusOption, string> = {
        balanced: t('refine.focusBalanced'),
        visual: t('refine.focusVisual'),
        dialogue: t('refine.focusDialogue'),
      }
      parts.push(`[${t('refine.focus')}: ${focusLabels[focus] || focus}]`)
    }
    if (userFeedback.trim()) {
      parts.push(userFeedback.trim())
    }
    return parts.join('\n')
  }

  const handleSubmit = async () => {
    const compiled = compileFeedback()
    if (compiled.trim().length < 10) {
      setErrorMsg(t('refine.error.minChars'))
      return
    }
    setErrorMsg(null)
    try {
      await onRefine(compiled)
      setUserFeedback('')
      onClose()
    } catch {
      // Error handled by parent / hook toast
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('refine.modalTitle')}
      description={t('refine.modalDesc')}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[var(--color-text-tertiary)]">
            {t('refine.placeholder')}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isPending}
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              data-testid="narrative-refine-submit"
              disabled={isPending || compileFeedback().trim().length < 10}
              onClick={() => void handleSubmit()}
            >
              {isPending ? (
                <>
                  <IconLoader2 size={16} className="animate-spin" />
                  {t('refine.processing')}
                </>
              ) : (
                <>
                  <IconSparkles size={16} />
                  {t('refine.submit')}
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4" data-testid="narrative-refine-form">
        {/* Section Coverage Timeline */}
        {sectionSpans.length > 0 && (
          <div
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-3"
            data-testid="refine-modal-coverage-timeline"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                {t('refine.sectionCoverage')}
              </span>
              <span className="font-mono text-xs text-[var(--color-text-tertiary)]">
                {sectionSpans.length} {t('narrative.section', { n: '' }).trim()} • {formatDurationMs(timelineMaxMs)}
              </span>
            </div>

            <div
              className="mb-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-secondary)]"
              data-testid="refine-modal-coverage-summary"
            >
              {t('refine.coverageSummary', {
                actual: formatDurationMs(actualCoverageMs),
                target: formatDurationMs(coverageTargetMs),
                defaultValue: `Actual ${formatDurationMs(actualCoverageMs)} / target ${formatDurationMs(coverageTargetMs)}`,
              })}
            </div>

            <div className="media-narrative-timeline-track h-7 rounded-md bg-[var(--color-bg-surface-3)]">
              {sectionSpans.flatMap(({ section, refs }) => refs.map((ref, refIndex) => {
                const startMs = ref.start_ms
                const endMs = ref.end_ms
                const left = Math.max(0, Math.min(100, (startMs / timelineMaxMs) * 100))
                const width = Math.max(
                  2,
                  Math.min(100 - left, ((endMs - startMs) / timelineMaxMs) * 100),
                )
                return (
                  <span
                    key={`${section.seq}-${refIndex}`}
                    className="media-narrative-timeline-seg flex items-center justify-center text-[10px] font-bold"
                    data-testid={`refine-modal-coverage-ref-${section.seq}-${refIndex}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`#${section.seq} ${section.heading || ''} (${formatDurationMs(startMs)}–${formatDurationMs(endMs)})`}
                  >
                    #{section.seq}
                  </span>
                )
              }))}
            </div>

            <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--color-text-tertiary)]">
              <span>00:00</span>
              <span>{formatDurationMs(timelineMaxMs)}</span>
            </div>

            {/* Micro Section Chips */}
            <div className="mt-2 flex flex-wrap gap-1.5 overflow-hidden">
              {sectionSpans.map(({ section, durationMs }) => (
                <span
                  key={section.seq}
                  className="inline-flex items-center gap-1 rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
                >
                  <span className="font-bold text-[var(--color-accent)]">#{section.seq}</span>
                  <span className="truncate max-w-[120px]">{section.heading || section.beat_type}</span>
                  <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
                    {formatDurationMs(durationMs)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Customization Grid: Duration, Tone, Focus */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Target Duration */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] flex items-center gap-1">
              <IconClock size={14} />
              {t('refine.targetDuration')}
            </label>
            <div className="flex flex-wrap gap-1">
              {DURATION_PRESETS.map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setTargetDuration(sec)}
                  className={cn(
                    'px-2 py-1 text-xs rounded border transition-colors',
                    targetDuration === sec
                      ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)] font-medium'
                      : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-text-secondary)]',
                  )}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* Narrative Tone */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] flex items-center gap-1">
              <IconFlame size={14} />
              {t('refine.tone')}
            </label>
            <select
              className="field-input py-1 text-xs"
              value={tone}
              onChange={(e) => setTone(e.target.value as ToneOption)}
            >
              <option value="balanced">{t('refine.toneBalanced')}</option>
              <option value="dynamic">{t('refine.toneDynamic')}</option>
              <option value="informative">{t('refine.toneInformative')}</option>
              <option value="dramatic">{t('refine.toneDramatic')}</option>
            </select>
          </div>

          {/* Content Focus */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-secondary)] flex items-center gap-1">
              <IconMovie size={14} />
              {t('refine.focus')}
            </label>
            <select
              className="field-input py-1 text-xs"
              value={focus}
              onChange={(e) => setFocus(e.target.value as FocusOption)}
            >
              <option value="balanced">{t('refine.focusBalanced')}</option>
              <option value="visual">{t('refine.focusVisual')}</option>
              <option value="dialogue">{t('refine.focusDialogue')}</option>
            </select>
          </div>
        </div>

        {/* Quick Tag Suggestions */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-tertiary)] flex items-center gap-1">
            <IconSparkles size={13} />
            {t('refine.quickTags')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {quickTags.map((tag, idx) => (
              <button
                key={idx}
                type="button"
                className="inline-flex items-center rounded-full border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
                onClick={() => handleAddTag(tag)}
              >
                + {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Feedback Textarea */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-[var(--color-text-secondary)] flex items-center justify-between">
            <span>{t('refine.label')}</span>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {compileFeedback().trim().length}/10 {t('common:characters', { defaultValue: 'ký tự' })}
            </span>
          </label>
          <textarea
            className="field-input min-h-[90px] text-xs leading-relaxed"
            data-testid="narrative-refine-feedback"
            value={userFeedback}
            disabled={isPending}
            onChange={(e) => setUserFeedback(e.target.value)}
            placeholder={t('refine.placeholder')}
          />
        </div>

        {errorMsg && (
          <p className="mb-0 text-xs text-[var(--color-error)]">{errorMsg}</p>
        )}
      </div>
    </Modal>
  )
}
