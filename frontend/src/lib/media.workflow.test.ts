import { describe, expect, it } from 'vitest'
import {
  canContinueCut,
  checkpointOf,
  isRedundantPhaseBadge,
  isRenderConfirmationRecipe,
  isReviewBlocked,
  presetVoiceLangMismatchKey,
  resolveWorkflowMode,
} from './media'
import { ApiError } from '@/types/api'
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
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-08-11T00:00:00Z',
    stages: [],
    ...partial,
  }
}

describe('workflow mode helpers — W0 (docs/17 Q-M-WORKFLOW-01/02)', () => {
  it('resolveWorkflowMode: explicit wins, legacy derives recipe default', () => {
    expect(resolveWorkflowMode(job({ recipeId: 'localization.full' }))).toBe('AUTO')
    expect(resolveWorkflowMode(job({ recipeId: 'summary.extractive' }))).toBe('MANUAL')
    expect(resolveWorkflowMode(job({ recipeId: 'summary.generative' }))).toBe('MANUAL')
    expect(
      resolveWorkflowMode(job({ recipeId: 'localization.full', workflowMode: 'MANUAL' })),
    ).toBe('MANUAL')
    expect(
      resolveWorkflowMode(job({ recipeId: 'summary.extractive', workflowMode: 'AUTO' })),
    ).toBe('AUTO')
    // Legacy row without recipeId: TRANSLATE_ONLY → AUTO.
    expect(resolveWorkflowMode(job({ recipeId: null }))).toBe('AUTO')
  })

  it('isRenderConfirmationRecipe: CP-B scope = every MANUAL job (C2, docs/97 §19.14)', () => {
    // MANUAL (explicit or derived) — any recipe, any subtitle mode.
    expect(
      isRenderConfirmationRecipe(job({ recipeId: 'summary.generative', subtitleMode: 'HARD_SUB' })),
    ).toBe(true)
    expect(
      isRenderConfirmationRecipe(job({ recipeId: 'summary.generative', subtitleMode: 'SOFT_SUB' })),
    ).toBe(true)
    expect(
      isRenderConfirmationRecipe(
        job({ recipeId: 'summary.generative', subtitleMode: 'HARD_SUB', workflowMode: 'MANUAL' }),
      ),
    ).toBe(true)
    expect(
      isRenderConfirmationRecipe(
        job({ recipeId: 'localization.full', subtitleMode: 'HARD_SUB', workflowMode: 'MANUAL' }),
      ),
    ).toBe(true)
    // C2 extension: MANUAL localization + SOFT_SUB and extractive now confirm.
    expect(
      isRenderConfirmationRecipe(
        job({ recipeId: 'localization.full', subtitleMode: 'SOFT_SUB', workflowMode: 'MANUAL' }),
      ),
    ).toBe(true)
    expect(
      isRenderConfirmationRecipe(job({ recipeId: 'summary.extractive', subtitleMode: 'HARD_SUB' })),
    ).toBe(true)
    // AUTO (explicit or derived) never confirms.
    expect(
      isRenderConfirmationRecipe(
        job({ recipeId: 'summary.generative', subtitleMode: 'HARD_SUB', workflowMode: 'AUTO' }),
      ),
    ).toBe(false)
    expect(
      isRenderConfirmationRecipe(
        job({ recipeId: 'localization.full', subtitleMode: 'SOFT_SUB', workflowMode: 'AUTO' }),
      ),
    ).toBe(false)
    // Legacy row without recipeId: TRANSLATE_ONLY → AUTO → no confirm.
    expect(isRenderConfirmationRecipe(job({ recipeId: null }))).toBe(false)
  })

  it('checkpoint helpers read the projection', () => {
    const cpJob = job({
      workflowCheckpoints: [
        { id: 'CUT', state: 'PENDING', canContinue: true },
        { id: 'REVIEW', state: 'BLOCKED', canContinue: false },
        { id: 'EXPORT', state: 'PENDING', canContinue: false },
      ],
    })
    expect(canContinueCut(cpJob)).toBe(true)
    expect(isReviewBlocked(cpJob)).toBe(true)
    expect(checkpointOf(cpJob, 'EXPORT')?.state).toBe('PENDING')
    expect(canContinueCut(job({}))).toBe(false)
    expect(isReviewBlocked(job({}))).toBe(false)
  })
})

describe('isRedundantPhaseBadge — header de-duplication (terminal status)', () => {
  it('hides the phase badge when status and phase say the same terminal thing', () => {
    expect(isRedundantPhaseBadge(job({ status: 'COMPLETED', domainPhase: 'COMPLETED' }))).toBe(true)
    expect(isRedundantPhaseBadge(job({ status: 'FAILED', domainPhase: 'FAILED' }))).toBe(true)
    expect(isRedundantPhaseBadge(job({ status: 'CANCELLED', domainPhase: 'CANCELLED' }))).toBe(true)
  })

  it('keeps the phase badge while the job is still running', () => {
    expect(isRedundantPhaseBadge(job({ status: 'PROCESSING', domainPhase: 'UNDERSTANDING' }))).toBe(
      false,
    )
    expect(isRedundantPhaseBadge(job({ status: 'PENDING', domainPhase: 'DRAFT' }))).toBe(false)
  })

  it('keeps the badge when only the status is terminal (mismatched phase)', () => {
    expect(isRedundantPhaseBadge(job({ status: 'COMPLETED', domainPhase: 'COMPOSING' }))).toBe(
      false,
    )
  })

  it('is false without a phase', () => {
    expect(isRedundantPhaseBadge(job({ status: 'COMPLETED' }))).toBe(false)
    expect(isRedundantPhaseBadge(null)).toBe(false)
  })
})

describe('presetVoiceLangMismatchKey — FE mapping for WORKFLOW_PRESET_VOICE_LANG_MISMATCH', () => {
  it('maps the fail-closed preset voice language mismatch to the friendly i18n key', () => {
    const e = new ApiError({
      status: 422,
      code: 'WORKFLOW_PRESET_VOICE_LANG_MISMATCH',
      message: 'Voice language does not match job target language: en vs vi',
    })
    expect(presetVoiceLangMismatchKey(e)).toBe('media:workflowPreset.voiceLangMismatch')
  })

  it('returns null for every other error (caller falls back to raw/generic)', () => {
    const other = new ApiError({ status: 422, code: 'WORKFLOW_PRESET_CONFIG_INVALID', message: 'x' })
    expect(presetVoiceLangMismatchKey(other)).toBeNull()
    expect(presetVoiceLangMismatchKey(new Error('boom'))).toBeNull()
    expect(presetVoiceLangMismatchKey(null)).toBeNull()
  })
})
