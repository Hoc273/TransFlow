import { useTranslation } from 'react-i18next'
import { IconPlayerPlay, IconRefresh } from '@tabler/icons-react'
import { useWorkflowContinue, useWorkflowResume } from '@/hooks/useMedia'
import { checkpointOf } from '@/lib/media'
import type { MediaJob } from '@/types/media'

type Props = {
  workspaceId: string
  job: MediaJob
}

/**
 * W0 workflow checkpoint actions (docs/19 §1.8.2), projected from
 * `workflowCheckpoints`. Renders nothing unless the user has something to do:
 * MANUAL CUT `canContinue` → Continue; gate-blocked REVIEW → QA Resume.
 * Mode and checkpoint states are already visible in the header / stepper, so
 * no read-only strip is shown.
 */
export function WorkflowCheckpointActions({ workspaceId, job }: Props) {
  const { t } = useTranslation('media')
  const continueCut = useWorkflowContinue(workspaceId, job.id)
  const resume = useWorkflowResume(workspaceId, job.id)

  const cut = checkpointOf(job, 'CUT')
  const review = checkpointOf(job, 'REVIEW')
  const canContinueCut = Boolean(cut?.canContinue)
  const reviewBlocked = review?.state === 'BLOCKED'

  if (!canContinueCut && !reviewBlocked) return null

  const busy = continueCut.isPending || resume.isPending

  return (
    <div className="mb-4 space-y-2" data-testid="workflow-checkpoint-actions">
      {canContinueCut && (
        <div className="media-banner info items-center">
          <IconPlayerPlay size={18} className="shrink-0" />
          <p className="m-0 flex-1 text-sm">{t('media:workflow.cutWaiting')}</p>
          <button
            type="button"
            className="btn-primary btn-sm shrink-0"
            disabled={busy}
            onClick={() => void continueCut.mutateAsync('CUT')}
          >
            <IconPlayerPlay size={14} className={continueCut.isPending ? 'animate-pulse' : undefined} />
            {t('media:workflow.continueCut')}
          </button>
        </div>
      )}

      {reviewBlocked && (
        <div className="media-banner warn items-center">
          <IconRefresh size={18} className="shrink-0" />
          <p className="m-0 flex-1 text-sm">{t('media:workflow.reviewBlocked')}</p>
          <button
            type="button"
            className="btn-secondary btn-sm shrink-0"
            disabled={busy}
            onClick={() => void resume.mutateAsync()}
          >
            <IconRefresh size={14} className={resume.isPending ? 'animate-spin' : undefined} />
            {t('media:workflow.resume')}
          </button>
        </div>
      )}
    </div>
  )
}
