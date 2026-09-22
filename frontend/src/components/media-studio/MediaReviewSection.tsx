import { useMemo, useRef, useState } from 'react'
import { MediaQaPanel } from '@/components/media-studio/MediaQaPanel'
import { MediaSubtitleEditor } from '@/components/media-studio/MediaSubtitleEditor'
import { ReviewVideoPane } from '@/components/media-studio/ReviewVideoPane'
import { countIssuesByBand } from '@/components/media-studio/MediaQaPanel'
import { useMediaLinkedJob, useRenderConfig } from '@/hooks/useMedia'
import type { MediaJob, SegmentItem } from '@/types/media'

type Props = {
  workspaceId: string
  job: MediaJob
  onProceedToNextStep?: () => void
}

/**
 * Review workbench (docs/19 §1.8.2 redesign): two synchronized columns —
 * sticky video left (live cue overlay + QA band summary) and the QA issue
 * strip + subtitle cue list right. Selecting a cue from QA issues or the list
 * seeks the video; playback highlights the matching cue row.
 */
export function MediaReviewSection({ workspaceId, job, onProceedToNextStep }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null)
  const [playingTimeMs, setPlayingTimeMs] = useState(0)

  const { data: linkedJob } = useMediaLinkedJob(workspaceId, job.translationJobId)
  const translateReady = job.stages.some(
    (stage) => stage.stageName === 'TRANSLATE' && stage.status === 'COMPLETED',
  )
  const configQuery = useRenderConfig(workspaceId, job.id, translateReady)

  const segments: SegmentItem[] = useMemo(() => linkedJob?.segments ?? [], [linkedJob])
  const qaCounts = useMemo(
    () => countIssuesByBand(segments.flatMap((s) => s.qaIssues ?? [])),
    [segments],
  )

  const seekToCue = (seg: SegmentItem) => {
    setSelectedCueId(seg.id)
    if (videoRef.current && seg.startMs != null) {
      videoRef.current.currentTime = seg.startMs / 1000
    }
  }

  return (
    <div className="media-review-grid" data-testid="media-review-section">
      <ReviewVideoPane
        videoRef={videoRef}
        videoUrl={configQuery.data?.sourceVideoUrl ?? null}
        segments={segments}
        qaCounts={qaCounts}
        selectedCueId={selectedCueId}
        onTimeUpdate={setPlayingTimeMs}
      />
      <div className="min-w-0 space-y-3">
        <MediaQaPanel workspaceId={workspaceId} job={job} onSelectIssue={seekToCue} />
        <MediaSubtitleEditor
          workspaceId={workspaceId}
          job={job}
          selectedCueId={selectedCueId}
          onSelectCue={seekToCue}
          playingTimeMs={playingTimeMs}
          onProceedToNextStep={onProceedToNextStep}
        />
      </div>
    </div>
  )
}
