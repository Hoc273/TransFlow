import { describe, expect, it } from 'vitest'
import {
  domainPhaseLabelKey,
  isAwaitingPlanSelection,
  isCutPlanProposal,
  isGenerativeRecipe,
  isProposalSelectionLocked,
  isSelectedProposalActivated,
  recipeModeBadgeClass,
  recipePlanPanelKind,
  resolveProposalPlanKind,
  resolveProposalSelectionUiState,
  resolveRecipeId,
} from './media'
import type { MediaJob, MediaSummaryProposal } from '@/types/media'

function job(partial: Partial<MediaJob>): MediaJob {
  return {
    id: 'j1',
    documentId: 'd1',
    rootAssetId: 'a1',
    processingMode: 'HYBRID',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'PROCESSING',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: 60,
    selectedProposalId: null,
    createdAt: new Date().toISOString(),
    stages: [],
    ...partial,
  }
}

describe('recipe-aware helpers', () => {
  it('prefers recipeId over processingMode placeholder', () => {
    const generative = job({
      recipeId: 'summary.generative',
      processingMode: 'HYBRID',
    })
    expect(resolveRecipeId(generative)).toBe('summary.generative')
    expect(isGenerativeRecipe(generative)).toBe(true)
    expect(recipePlanPanelKind(generative)).toBe('narrative_plan')
    expect(recipeModeBadgeClass(generative)).toBe('GENERATIVE')
  })

  it('falls back processingMode only when recipeId missing', () => {
    expect(resolveRecipeId(job({ recipeId: null, processingMode: 'TRANSLATE_ONLY' }))).toBe(
      'localization.full',
    )
    expect(recipePlanPanelKind(job({ recipeId: null, processingMode: 'HYBRID' }))).toBe(
      'cut_plan',
    )
  })

  it('detects plan selection gate from stages, not invented voice waits', () => {
    const awaiting = job({
      recipeId: 'summary.extractive',
      selectedProposalId: null,
      stages: [
        {
          id: 's',
          stageName: 'SUMMARIZE',
          stageOrder: 3,
          status: 'COMPLETED',
          progressPercent: 100,
          startedAt: null,
          completedAt: null,
        },
      ],
    })
    expect(isAwaitingPlanSelection(awaiting)).toBe(true)

    const selected = job({ ...awaiting, selectedProposalId: 'p1' })
    expect(isAwaitingPlanSelection(selected)).toBe(false)
    expect(isProposalSelectionLocked(selected)).toBe(true)
  })

  it('marks activated after select when translate is pending/queued', () => {
    const j = job({
      recipeId: 'summary.extractive',
      selectedProposalId: 'p1',
      domainPhase: 'MATERIALIZING',
      stages: [
        {
          id: 't',
          stageName: 'TRANSLATE',
          stageOrder: 4,
          status: 'PENDING',
          progressPercent: 0,
          startedAt: null,
          completedAt: null,
        },
      ],
    })
    expect(isSelectedProposalActivated(j)).toBe(true)
    expect(resolveProposalSelectionUiState(j, 'p1')).toBe('activated')
    expect(resolveProposalSelectionUiState(j, 'other')).toBe('candidate')
  })

  it('resolves plan kind from proposal first, then recipe', () => {
    const proposal: Pick<MediaSummaryProposal, 'planKind'> = { planKind: 'NARRATIVE_PLAN' }
    expect(resolveProposalPlanKind(proposal, job({ recipeId: 'summary.extractive' }))).toBe(
      'NARRATIVE_PLAN',
    )
    expect(
      resolveProposalPlanKind({ planKind: null }, job({ recipeId: 'summary.extractive' })),
    ).toBe('CUT_PLAN')
    expect(
      isCutPlanProposal(
        { planKind: 'CUT_PLAN', planBody: null },
        job({ recipeId: 'summary.extractive' }),
      ),
    ).toBe(true)
  })

  it('maps only real backend domain phases', () => {
    expect(domainPhaseLabelKey('PLANNING')).toBe('domainPhase.PLANNING')
    expect(domainPhaseLabelKey('MATERIALIZING')).toBe('domainPhase.MATERIALIZING')
    expect(domainPhaseLabelKey('WAITING_VOICE')).toBe('domainPhase.unknown')
  })
})
