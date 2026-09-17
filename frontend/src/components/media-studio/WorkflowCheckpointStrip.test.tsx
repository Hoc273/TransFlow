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
const { WorkflowCheckpointStrip } = await import('./WorkflowCheckpointStrip')

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

describe('WorkflowCheckpointStrip — W0 (docs/19 §1.8.2)', () => {
  it('renders mode badge and all three checkpoint states', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointStrip workspaceId="ws" job={job({})} />,
    )
    expect(html).toContain('media:workflow.manual')
    expect(html).toContain('media:workflow.cut')
    expect(html).toContain('media:workflow.review')
    expect(html).toContain('media:workflow.export')
    expect(html).toContain('media:workflow.state.PENDING')
  })

  it('shows Continue only when the CUT checkpoint canContinue (MANUAL)', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointStrip workspaceId="ws" job={job({})} />,
    )
    expect(html).toContain('media:workflow.continueCut')
    expect(html).not.toContain('media:workflow.resume')
  })

  it('hides Continue once CUT is confirmed', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointStrip
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
    expect(html).not.toContain('media:workflow.continueCut')
  })

  it('shows Resume when REVIEW is gate-blocked (QA resume)', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointStrip
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
    expect(html).toContain('media:workflow.resume')
  })

  it('AUTO renders a read-only strip without any action buttons', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointStrip
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
    expect(html).toContain('media:workflow.auto')
    expect(html).toContain('media:workflow.state.SKIPPED')
    expect(html).not.toContain('media:workflow.continueCut')
    expect(html).not.toContain('media:workflow.resume')
  })

  it('legacy job without workflowMode derives the recipe default (AUTO)', () => {
    const html = renderToStaticMarkup(
      <WorkflowCheckpointStrip
        workspaceId="ws"
        job={job({ workflowMode: null, workflowCheckpoints: null })}
      />,
    )
    // localization.full legacy → AUTO badge, no actions.
    expect(html).toContain('media:workflow.auto')
  })
})
