import { describe, expect, it } from 'vitest'
import {
  hasActiveMediaStages,
  isActiveMediaJobStatus,
  isTerminalMediaJobStatus,
} from './media'
import type { MediaJob, MediaJobStage } from '@/types/media'

function stage(status: MediaJobStage['status']): MediaJobStage {
  return {
    id: `s-${status}`,
    stageName: 'RENDER',
    stageOrder: 6,
    status,
    progressPercent: 0,
    startedAt: null,
    completedAt: null,
  }
}

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

describe('isActiveMediaJobStatus', () => {
  it.each(['PENDING', 'PROCESSING'])('returns true for %s', (status) => {
    expect(isActiveMediaJobStatus(status)).toBe(true)
  })

  it.each(['COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'])(
    'returns false for terminal %s',
    (status) => {
      expect(isActiveMediaJobStatus(status)).toBe(false)
    },
  )

  it('returns false for non-existent Media job statuses', () => {
    // WAITING_APPROVAL and CANCEL_REQUESTED are NOT MediaJob.Status values
    // (WAITING_APPROVAL = Creative ProductionJob; CANCEL_REQUESTED = stage only).
    // They must never be treated as active job statuses.
    expect(isActiveMediaJobStatus('WAITING_APPROVAL')).toBe(false)
    expect(isActiveMediaJobStatus('CANCEL_REQUESTED')).toBe(false)
  })

  it('is null-safe and case-insensitive', () => {
    expect(isActiveMediaJobStatus(null)).toBe(false)
    expect(isActiveMediaJobStatus(undefined)).toBe(false)
    expect(isActiveMediaJobStatus('processing')).toBe(true)
  })
})

describe('isTerminalMediaJobStatus', () => {
  it.each(['COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'])(
    'returns true for %s',
    (status) => {
      expect(isTerminalMediaJobStatus(status)).toBe(true)
    },
  )

  it.each(['PENDING', 'PROCESSING'])('returns false for %s', (status) => {
    expect(isTerminalMediaJobStatus(status)).toBe(false)
  })
})

describe('hasActiveMediaStages', () => {
  it.each(['PENDING', 'PROCESSING', 'CANCEL_REQUESTED'])(
    'returns true when a stage is %s',
    (status) => {
      expect(hasActiveMediaStages(job({ stages: [stage(status as MediaJobStage['status'])] }))).toBe(
        true,
      )
    },
  )

  it.each(['COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED'])(
    'returns false when all stages are terminal %s',
    (status) => {
      expect(hasActiveMediaStages(job({ stages: [stage(status as MediaJobStage['status'])] }))).toBe(
        false,
      )
    },
  )

  it('returns false when a stage is STALE (stable state, no background progression)', () => {
    expect(hasActiveMediaStages(job({ stages: [stage('STALE')] }))).toBe(false)
  })

  it('returns true if any one stage is in-flight among many terminal', () => {
    const j = job({
      stages: [stage('COMPLETED'), stage('SKIPPED'), stage('PROCESSING'), stage('CANCELLED')],
    })
    expect(hasActiveMediaStages(j)).toBe(true)
  })

  it('returns false for empty stages', () => {
    expect(hasActiveMediaStages(job({ stages: [] }))).toBe(false)
  })

  it('is null-safe', () => {
    expect(hasActiveMediaStages(null)).toBe(false)
    expect(hasActiveMediaStages(undefined)).toBe(false)
  })

  it('is case-insensitive on stage status', () => {
    expect(hasActiveMediaStages(job({ stages: [stage('processing')] }))).toBe(true)
    expect(hasActiveMediaStages(job({ stages: [stage('pending')] }))).toBe(true)
  })
})

describe('polling decision (useMediaJob/useMediaJobs)', () => {
  // Mirrors the refetchInterval predicate in useMedia.ts.
  function shouldPoll(job: MediaJob): boolean {
    return isActiveMediaJobStatus(job.status) || hasActiveMediaStages(job)
  }

  it('AC-1: COMPLETED job with PENDING stage (after rerun) keeps polling', () => {
    expect(
      shouldPoll(job({ status: 'COMPLETED', stages: [stage('COMPLETED'), stage('PENDING')] })),
    ).toBe(true)
  })

  it('AC-2: COMPLETED job with all terminal stages stops polling', () => {
    expect(
      shouldPoll(
        job({ status: 'COMPLETED', stages: [stage('COMPLETED'), stage('COMPLETED')] }),
      ),
    ).toBe(false)
  })

  it('AC-3: PROCESSING job keeps polling regardless of stages', () => {
    expect(shouldPoll(job({ status: 'PROCESSING', stages: [stage('COMPLETED')] }))).toBe(true)
    expect(shouldPoll(job({ status: 'PROCESSING', stages: [] }))).toBe(true)
  })

  it('AC-4: CANCELLED job with all CANCELLED stages stops polling', () => {
    expect(
      shouldPoll(
        job({ status: 'CANCELLED', stages: [stage('CANCELLED'), stage('CANCELLED')] }),
      ),
    ).toBe(false)
  })

  it('AC-5: COMPLETED job with STALE stage does NOT poll (STALE excluded)', () => {
    expect(shouldPoll(job({ status: 'COMPLETED', stages: [stage('STALE')] }))).toBe(false)
  })

  it('AC-1 variant: COMPLETED + CANCEL_REQUESTED stage keeps polling (graceful cancel)', () => {
    expect(
      shouldPoll(job({ status: 'COMPLETED', stages: [stage('CANCEL_REQUESTED')] })),
    ).toBe(true)
  })

  it('PARTIALLY_FAILED with all terminal stages stops polling', () => {
    expect(
      shouldPoll(
        job({
          status: 'PARTIALLY_FAILED',
          stages: [stage('COMPLETED'), stage('FAILED'), stage('SKIPPED')],
        }),
      ),
    ).toBe(false)
  })

  it('FAILED job with a leftover PENDING stage still polls (safety)', () => {
    expect(shouldPoll(job({ status: 'FAILED', stages: [stage('PENDING')] }))).toBe(true)
  })
})
