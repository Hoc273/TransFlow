import { useEffect, useRef } from 'react'
import { stageByName } from '@/lib/media'
import type { MediaJob } from '@/types/media'

/** UX milestones that may open a section and scroll once per job session. */
export type WorkflowScrollMilestone =
  | 'stt-completed'
  | 'translate-completed'
  | 'render-completed'

export type WorkflowAutoScrollHandlers = {
  onMilestone: (milestone: WorkflowScrollMilestone) => void
}

/**
 * Fires each milestone at most once per mounted job session, only on a real
 * status transition (or first observation of a completed gate). Polling
 * progress updates alone never re-scroll.
 *
 * Does not invent stage statuses — reads API stage status only.
 */
export function useWorkflowAutoScroll(
  job: MediaJob | null | undefined,
  handlers: WorkflowAutoScrollHandlers,
): void {
  const handledRef = useRef<Set<WorkflowScrollMilestone>>(new Set())
  const prevRef = useRef<{
    jobId: string | null
    stt: string | null
    translate: string | null
    render: string | null
  }>({ jobId: null, stt: null, translate: null, render: null })
  const onMilestoneRef = useRef(handlers.onMilestone)
  onMilestoneRef.current = handlers.onMilestone

  useEffect(() => {
    if (!job) return

    // New job → reset handled milestones so a different job can scroll again.
    if (prevRef.current.jobId !== job.id) {
      handledRef.current = new Set()
      prevRef.current = { jobId: job.id, stt: null, translate: null, render: null }
    }

    const stt = String(stageByName(job, 'STT')?.status ?? '').toUpperCase() || null
    const translate = String(stageByName(job, 'TRANSLATE')?.status ?? '').toUpperCase() || null
    const render = String(stageByName(job, 'RENDER')?.status ?? '').toUpperCase() || null
    const prev = prevRef.current

    const fire = (milestone: WorkflowScrollMilestone) => {
      if (handledRef.current.has(milestone)) return
      handledRef.current.add(milestone)
      onMilestoneRef.current(milestone)
    }

    // STT completed (transition into COMPLETED, or first observation already complete
    // after EXTRACT_AUDIO is done — still only once via handled set).
    if (stt === 'COMPLETED' && prev.stt !== 'COMPLETED') {
      fire('stt-completed')
    }

    if (translate === 'COMPLETED' && prev.translate !== 'COMPLETED') {
      fire('translate-completed')
    }

    if (render === 'COMPLETED' && prev.render !== 'COMPLETED') {
      fire('render-completed')
    }

    prevRef.current = { jobId: job.id, stt, translate, render }
  }, [job])
}

/** Pure helper for tests — whether a status pair is a first-time completion. */
export function isFirstCompletionTransition(
  prev: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return String(next ?? '').toUpperCase() === 'COMPLETED' && String(prev ?? '').toUpperCase() !== 'COMPLETED'
}

/** Scroll a section element into view without inventing layout. */
export function scrollSectionIntoView(sectionId: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById(`studio-section-${sectionId}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
