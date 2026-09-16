import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import type { SegmentItem } from '@/types/job'

type Props = {
  segments: SegmentItem[]
  activeId: string | null
  unsavedIds: Set<string>
  draftTargets: Record<string, string>
  onSelect: (id: string) => void
}

const ROW_H = 72

/** E.5 Virtualized segment list. */
export function SegmentList({
  segments,
  activeId,
  unsavedIds,
  draftTargets,
  onSelect,
}: Props) {
  const { t } = useTranslation('job')
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  })

  const activeIndex = useMemo(
    () => segments.findIndex((s) => s.id === activeId),
    [segments, activeId],
  )

  useEffect(() => {
    if (activeIndex >= 0) {
      virtualizer.scrollToIndex(activeIndex, { align: 'auto' })
    }
  }, [activeIndex, virtualizer])

  if (segments.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--color-text-tertiary)]">
        {t('editor.noSegments')}
      </div>
    )
  }

  return (
    <div ref={parentRef} className="segment-list-scroll h-full overflow-y-auto">
      <div
        style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const seg = segments[row.index]
          if (!seg) return null
          const target = draftTargets[seg.id] ?? seg.targetText ?? ''
          const hasQa = (seg.qaIssues ?? []).some((i) => !i.resolved)
          return (
            <button
              key={seg.id}
              type="button"
              className={cn(
                'segment-row',
                activeId === seg.id && 'segment-row-active',
                unsavedIds.has(seg.id) && 'segment-row-unsaved',
              )}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_H,
                transform: `translateY(${row.start}px)`,
              }}
              onClick={() => onSelect(seg.id)}
            >
              <div className="flex items-center gap-2">
                <span className="segment-seq">#{seg.seq}</span>
                <span className={cn('segment-status-dot', `status-${seg.status}`)} />
                {hasQa && <span className="qa-dot" title={t('editor.hasQa')} />}
                {unsavedIds.has(seg.id) && (
                  <span className="unsaved-dot" title={t('editor.unsaved')} />
                )}
              </div>
              <div className="segment-preview source">{seg.sourceText}</div>
              <div className="segment-preview target">{target || '—'}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
