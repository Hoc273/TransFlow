import { useMemo, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlay } from '@tabler/icons-react'
import { cn } from '@/lib/cn'
import type { SegmentItem } from '@/types/media'
import type { QaBadgeSummary } from '@/components/media-studio/MediaQaPanel'

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>
  videoUrl?: string | null
  segments: SegmentItem[]
  qaCounts: QaBadgeSummary
  selectedCueId: string | null
  onTimeUpdate?: (timeMs: number) => void
}

/**
 * Review workbench — sticky video pane. Shows the source video with the
 * currently-playing cue as a live subtitle overlay; clicking a cue in the
 * list seeks here (parent owns the ref). QA band chips summarize review state
 * at a glance (same bands as the accordion trigger).
 */
export function ReviewVideoPane({
  videoRef,
  videoUrl,
  segments,
  qaCounts,
  selectedCueId,
  onTimeUpdate,
}: Props) {
  const { t } = useTranslation('media')
  const [timeMs, setTimeMs] = useState(0)

  const activeCue = useMemo(() => {
    let current: SegmentItem | null = null
    for (const seg of segments) {
      const start = seg.startMs ?? 0
      const end = seg.endMs ?? start
      if (timeMs >= start && timeMs < end) return seg
      if (timeMs >= end) current = seg
    }
    return current
  }, [segments, timeMs])

  return (
    <div className="media-review-video-col">
      <div className="media-review-frame">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            muted
            className="h-full w-full object-contain"
            data-testid="review-video"
            onTimeUpdate={(e) => {
              const ms = e.currentTarget.currentTime * 1000
              setTimeMs(ms)
              onTimeUpdate?.(ms)
            }}
          />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-white/60">
            {t('review.videoPending')}
          </div>
        )}
        {videoUrl && activeCue?.targetText != null && activeCue.targetText !== '' && (
          <div
            className={cn(
              'media-review-cue-overlay',
              selectedCueId === activeCue.id && 'selected',
            )}
            data-testid="review-current-cue"
          >
            {activeCue.targetText}
          </div>
        )}
      </div>

      <div className="media-review-qa-summary" data-testid="review-qa-summary">
        {qaCounts.high > 0 && <span className="qa-seg qa-seg-critical">{qaCounts.high}</span>}
        {qaCounts.medium > 0 && <span className="qa-seg qa-seg-warning">{qaCounts.medium}</span>}
        {qaCounts.low > 0 && <span className="qa-seg qa-seg-ok">{qaCounts.low}</span>}
        {qaCounts.high + qaCounts.medium + qaCounts.low === 0 && (
          <span className="qa-seg qa-seg-ok">✓</span>
        )}
        <span className="media-review-cue-hint">
          <IconPlayerPlay size={12} />
          {t('review.seekHint')}
        </span>
      </div>
    </div>
  )
}
