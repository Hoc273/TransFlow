import { describe, expect, it } from 'vitest'
import {
  clipScoreInfo,
  creativeErrorCode,
  creativeFlowNodes,
  currentCreativeStage,
  flowNodeState,
  formatBytes,
  formatDurationMs,
  formatUsd,
  hasActiveCreativeStages,
  isActiveCreativeJobStatus,
  isCancellableCreativeJob,
  objectKeyFromRef,
  orderedCreativeStages,
  overallCreativeProgress,
  pipelineLabelKey,
  qualityBadgeClass,
  scriptFromArtifact,
} from './creative'
import type { CreativeJob } from '@/api/creative'

function job(partial: Partial<CreativeJob>): CreativeJob {
  return {
    id: 'j1',
    workspaceId: 'w1',
    projectId: 'p1',
    pipelineId: 'clip_factory',
    manifestVersion: '1.1.0',
    workflowMode: 'GUIDED_TEAM',
    status: 'PROCESSING',
    hardBudgetCapUsd: 50,
    reservedAmountUsd: 0,
    spentAmountUsd: 0,
    createdByUserId: 'u1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: [],
    ...partial,
  }
}

function stage(key: string, order: number, status: string, extra = {}) {
  return {
    id: `s-${key}`,
    productionJobId: 'j1',
    stageKey: key,
    stageOrder: order,
    unitIndex: 0,
    status,
    attemptCount: 1,
    ...extra,
  }
}

describe('creative helpers', () => {
  it('treats terminal job statuses as inactive', () => {
    for (const s of ['COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED']) {
      expect(isActiveCreativeJobStatus(s)).toBe(false)
    }
    for (const s of ['PENDING', 'WAITING_APPROVAL', 'PROCESSING', 'CANCEL_REQUESTED']) {
      expect(isActiveCreativeJobStatus(s)).toBe(true)
    }
    expect(isActiveCreativeJobStatus('weird')).toBe(true)
  })

  it('detects active stages including READY_TO_PROCESS, ignores STALE', () => {
    expect(hasActiveCreativeStages(job({ stages: [stage('INGEST', 0, 'COMPLETED'), stage('COMPOSE', 1, 'STALE')] as never }))).toBe(false)
    expect(hasActiveCreativeStages(job({ stages: [stage('COMPOSE', 1, 'READY_TO_PROCESS')] as never }))).toBe(true)
    expect(hasActiveCreativeStages(job({ stages: [] }))).toBe(false)
  })

  it('cancels only non-terminal jobs', () => {
    expect(isCancellableCreativeJob(job({ status: 'PROCESSING' }))).toBe(true)
    expect(isCancellableCreativeJob(job({ status: 'CANCEL_REQUESTED' }))).toBe(false)
    for (const s of ['COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED']) {
      expect(isCancellableCreativeJob(job({ status: s }))).toBe(false)
    }
    expect(isCancellableCreativeJob(null)).toBe(false)
  })

  it('orders stages and picks the current one', () => {
    const j = job({
      stages: [
        stage('COMPOSE', 2, 'PENDING'),
        stage('INGEST', 0, 'COMPLETED'),
        stage('STT_WORD_LEVEL', 1, 'PROCESSING'),
      ] as never,
    })
    expect(orderedCreativeStages(j).map((s) => s.stageKey)).toEqual(['INGEST', 'STT_WORD_LEVEL', 'COMPOSE'])
    expect(currentCreativeStage(j)?.stageKey).toBe('STT_WORD_LEVEL')
    expect(currentCreativeStage(job({ stages: [] }))).toBeNull()
  })

  it('computes overall progress', () => {
    const j = job({
      stages: [
        stage('A', 0, 'COMPLETED'),
        stage('B', 1, 'SKIPPED'),
        stage('C', 2, 'PROCESSING', { progressPercent: 50 }),
        stage('D', 3, 'PENDING'),
      ] as never,
    })
    expect(overallCreativeProgress(j)).toBe(63) // (100+100+50+0)/4 rounded
    expect(overallCreativeProgress(job({ stages: [] }))).toBe(0)
  })

  it('maps pipeline and quality badges', () => {
    expect(pipelineLabelKey('animated_explainer')).toBe('pipeline.animated_explainer')
    expect(pipelineLabelKey('unknown')).toBe('pipeline.clip_factory')
    expect(qualityBadgeClass('DEGRADED')).toBe('status-badge-failed')
    expect(qualityBadgeClass('SYNTHETIC')).toBe('status-badge-partial')
    expect(qualityBadgeClass('REAL')).toBe('status-badge-completed')
    expect(qualityBadgeClass(undefined)).toBe('status-badge-completed')
  })

  it('formats usd, duration and bytes', () => {
    expect(formatUsd(50)).toBe('$50')
    expect(formatUsd(null)).toBe('$0')
    expect(formatDurationMs(1500)).toBe('1.5s')
    expect(formatDurationMs(90000)).toBe('1:30')
    expect(formatDurationMs(null)).toBe('—')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(null)).toBe('—')
  })

  it('collapses the VISUAL_GEN fan-out into one aggregate node', () => {
    const j = job({
      pipelineId: 'animated_explainer',
      stages: [
        stage('RESEARCH', 0, 'COMPLETED'),
        stage('VISUAL_GEN', 1, 'PROCESSING', { isVirtual: true, unitIndex: 0, progressPercent: 0 }),
        stage('VISUAL_GEN', 1, 'COMPLETED', { unitIndex: 1 }),
        stage('VISUAL_GEN', 2, 'PROCESSING', { unitIndex: 2, progressPercent: 40 }),
        stage('VISUAL_GEN', 3, 'PENDING', { unitIndex: 3 }),
      ] as never,
    })
    const nodes = creativeFlowNodes(j)
    expect(nodes.map((n) => n.key)).toEqual(['RESEARCH', 'VISUAL_GEN'])
    const visual = nodes[1]
    expect(visual.childTotal).toBe(3)
    expect(visual.childDone).toBe(1)
    expect(visual.progress).toBe(33) // 1/3 children completed
    expect(flowNodeState(visual)).toBe('processing')
    expect(flowNodeState(nodes[0])).toBe('done')
  })

  it('marks a flow node failed when the parent or any child failed', () => {
    const j = job({
      pipelineId: 'animated_explainer',
      stages: [
        stage('VISUAL_GEN', 1, 'COMPLETED', { isVirtual: true, unitIndex: 0 }),
        stage('VISUAL_GEN', 1, 'COMPLETED', { unitIndex: 1 }),
        stage('VISUAL_GEN', 2, 'FAILED', { unitIndex: 2, errorMessage: 'boom' }),
      ] as never,
    })
    const [visual] = creativeFlowNodes(j)
    expect(flowNodeState(visual)).toBe('failed')
    expect(visual.error).toBe('boom')
  })

  it('extracts the script from artifact contentJson defensively', () => {
    expect(scriptFromArtifact(null)).toBeNull()
    expect(scriptFromArtifact({ scenes: [] })).toBeNull()
    const script = scriptFromArtifact({
      version: '1.2.0',
      aspect: '9:16',
      scenes: [{ id: 'scene-01', type: 'text', voiceText: 'Hello', templateId: 'title_card' }],
      provenance: { lineage: 'BRIEF' },
    })
    expect(script?.version).toBe('1.2.0')
    expect(script?.scenes).toHaveLength(1)
    expect(script?.scenes[0].voiceText).toBe('Hello')
  })

  it('strips bucket prefixes from object refs', () => {
    expect(objectKeyFromRef('transflow-creative/creative/j1/final.mp4')).toBe('creative/j1/final.mp4')
    expect(objectKeyFromRef('transflow-media/creative/w1/j1/tts_s1_ab12cd34.mp3')).toBe('creative/w1/j1/tts_s1_ab12cd34.mp3')
    expect(objectKeyFromRef('creative/j1/scene.png')).toBe('creative/j1/scene.png')
    expect(objectKeyFromRef(null)).toBe('')
  })

  it('parses clip rank scores defensively', () => {
    expect(clipScoreInfo(undefined).total).toBeNull()
    const info = clipScoreInfo({
      scores: { hook: 0.8, coherence: 0.6, broken: 'x' },
      total: 0.71,
      reasons: ['strong hook', 42, 'good duration'],
    })
    expect(info.scores).toEqual([
      { label: 'hook', value: 0.8 },
      { label: 'coherence', value: 0.6 },
    ])
    expect(info.total).toBe(0.71)
    expect(info.reasons).toEqual(['strong hook', 'good duration'])
    const nested = clipScoreInfo({ rank: { scores: { hook: 0.9 }, total: 0.9, reasons: ['r1'] } })
    expect(nested.total).toBe(0.9)
    expect(nested.scores).toEqual([{ label: 'hook', value: 0.9 }])
  })

  it('maps known backend error codes and ignores unknown ones', () => {
    expect(creativeErrorCode({ code: 'BUDGET_HARD_CAP', message: 'x' })).toBe('BUDGET_HARD_CAP')
    expect(creativeErrorCode(new Error('SOME_UNKNOWN_CODE: nope'))).toBeNull()
    expect(creativeErrorCode({ code: 'NOT_A_KNOWN_CODE' })).toBeNull()
    expect(creativeErrorCode(null)).toBeNull()
  })
})
