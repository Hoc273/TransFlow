import { useTranslation } from 'react-i18next'
import {
  IconClipboardCheck,
  IconMovie,
  IconPlayerPlay,
  IconRefresh,
  IconSubtitles,
} from '@tabler/icons-react'
import { useWorkflowContinue, useWorkflowResume } from '@/hooks/useMedia'
import { checkpointOf, resolveWorkflowMode } from '@/lib/media'
import type { MediaJob, WorkflowCheckpoint, WorkflowCheckpointState } from '@/types/media'

type Props = {
  workspaceId: string
  job: MediaJob
}

const STATE_CLASS: Record<WorkflowCheckpointState, string> = {
  PENDING: 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
  CONFIRMED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  SKIPPED: 'border-[var(--color-border)] bg-transparent text-[var(--color-text-tertiary)]',
  BLOCKED: 'border-amber-300 bg-amber-50 text-amber-800',
  COMPLETED: 'border-emerald-300 bg-emerald-50 text-emerald-800',
}

/**
 * W0 — read-only workflow checkpoint projection strip (docs/19 §1.8.2):
 * workflow mode + CUT / REVIEW / EXPORT states from `workflowCheckpoints`.
 * MANUAL shows the Continue action when the CUT checkpoint `canContinue`;
 * a gate-blocked REVIEW shows the QA Resume action. AUTO renders the same
 * strip as a frozen/read-only summary — no actions, no bypass.
 */
export function WorkflowCheckpointStrip({ workspaceId, job }: Props) {
  const { t } = useTranslation('media')
  const continueCut = useWorkflowContinue(workspaceId, job.id)
  const resume = useWorkflowResume(workspaceId, job.id)
  const mode = resolveWorkflowMode(job)

  const cut = checkpointOf(job, 'CUT')
  const review = checkpointOf(job, 'REVIEW')
  const exportCp = checkpointOf(job, 'EXPORT')

  const items: Array<{ cp: WorkflowCheckpoint | null; icon: React.ReactNode; label: string }> = [
    { cp: cut, icon: <IconClipboardCheck size={14} />, label: t('media:workflow.cut') },
    { cp: review, icon: <IconSubtitles size={14} />, label: t('media:workflow.review') },
    { cp: exportCp, icon: <IconMovie size={14} />, label: t('media:workflow.export') },
  ]

  const busy = continueCut.isPending || resume.isPending

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-3">
      <span
        className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
          mode === 'MANUAL'
            ? 'border-[var(--color-media)]/40 bg-[var(--color-media-soft)] text-[var(--color-media)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
        }`}
      >
        {mode === 'MANUAL' ? t('media:workflow.manual') : t('media:workflow.auto')}
      </span>

      {items.map((item) => (
        <span
          key={item.cp?.id ?? item.label}
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
            item.cp ? STATE_CLASS[item.cp.state] : STATE_CLASS.PENDING
          }`}
        >
          {item.icon}
          {item.label}
          {item.cp ? ` · ${t(`media:workflow.state.${item.cp.state}`)}` : ''}
        </span>
      ))}

      {cut?.canContinue && (
        <button
          type="button"
          className="btn-primary btn-sm ml-auto"
          disabled={busy}
          onClick={() => void continueCut.mutateAsync('CUT')}
        >
          <IconPlayerPlay size={14} className={continueCut.isPending ? 'animate-pulse' : undefined} />
          {t('media:workflow.continueCut')}
        </button>
      )}

      {review?.state === 'BLOCKED' && (
        <button
          type="button"
          className="btn-secondary btn-sm ml-auto"
          disabled={busy}
          onClick={() => void resume.mutateAsync()}
        >
          <IconRefresh size={14} className={resume.isPending ? 'animate-spin' : undefined} />
          {t('media:workflow.resume')}
        </button>
      )}
    </div>
  )
}
