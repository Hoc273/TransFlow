import { describe, expect, it, vi } from 'vitest'

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

const continueMutate = vi.fn()
const resumeMutate = vi.fn()

vi.mock('@/hooks/useMedia', () => ({
  useWorkflowContinue: () => ({ isPending: false, mutateAsync: continueMutate }),
  useWorkflowResume: () => ({ isPending: false, mutateAsync: resumeMutate }),
}))

const { renderToStaticMarkup } = await import('react-dom/server')
const { WorkflowCheckpointActions } = await import('./WorkflowCheckpointActions')

import type { MediaJob } from '@/types/media'

function job(partial: Partial<MediaJob>): MediaJob {
  return {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    processingMode: 'TRANSLATE_ONLY',
    sourceLanguage: null,
    targetLang: 'vi',
    status: 'PENDING',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-08-11T00:00:00Z',
    stages: [],
    recipeId: 'localization.full',
    workflowMode: 'MANUAL',
    workflowCheckpoints: [
      { id: 'CUT', state: 'PENDING', canContinue: true },
      { id: 'REVIEW', state: 'PENDING', canContinue: false },
      { id: 'EXPORT', state: 'PENDING', canContinue: false },
    ],
    ...partial,
  }
}

describe('WorkflowCheckpointActions — W0 (docs/19 §1.8.2)', () => {
  it('shows Continue only when the CUT checkpoint canContinue (MANUAL)', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointActions workspaceId="ws" job={job({})} />,
    )
    expect(html).toContain('media:workflow.cutWaiting')
    expect(html).toContain('media:workflow.continueCut')
    expect(html).not.toContain('media:workflow.resume')
  })

  it('renders nothing once CUT is confirmed and REVIEW is not blocked', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointActions
        workspaceId="ws"
        job={job({
          workflowCheckpoints: [
            { id: 'CUT', state: 'CONFIRMED', canContinue: false },
            { id: 'REVIEW', state: 'PENDING', canContinue: true },
            { id: 'EXPORT', state: 'PENDING', canContinue: false },
          ],
        })}
      />,
    )
    expect(html).toBe('')
  })

  it('shows Resume when REVIEW is gate-blocked (QA resume)', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointActions
        workspaceId="ws"
        job={job({
          workflowCheckpoints: [
            { id: 'CUT', state: 'CONFIRMED', canContinue: false },
            { id: 'REVIEW', state: 'BLOCKED', canContinue: false },
            { id: 'EXPORT', state: 'PENDING', canContinue: false },
          ],
        })}
      />,
    )
    expect(html).toContain('media:workflow.reviewBlocked')
    expect(html).toContain('media:workflow.resume')
  })

  it('AUTO job with nothing actionable renders nothing (no read-only strip)', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointActions
        workspaceId="ws"
        job={job({
          workflowMode: 'AUTO',
          workflowCheckpoints: [
            { id: 'CUT', state: 'SKIPPED', canContinue: false },
            { id: 'REVIEW', state: 'CONFIRMED', canContinue: false },
            { id: 'EXPORT', state: 'PENDING', canContinue: false },
          ],
        })}
      />,
    )
    expect(html).toBe('')
  })

  it('legacy job without checkpoints renders nothing', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointActions
        workspaceId="ws"
        job={job({ workflowMode: null, workflowCheckpoints: null })}
      />,
    )
    expect(html).toBe('')
  })
})
