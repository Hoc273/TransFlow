import { describe, expect, it } from 'vitest'
import type { MediaJob } from '@/types/media'
import {
  computeJobCounts,
  filterAndSortJobs,
  isNeedReviewJob,
} from './jobFilters'

const mockJobs: MediaJob[] = [
  {
    id: 'job-1',
    documentId: 'doc-1',
    rootAssetId: 'asset-1',
    projectId: 'p-1',
    processingMode: 'LOCALIZATION',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'COMPLETED',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-09-01T10:00:00Z',
  },
  {
    id: 'job-2',
    documentId: 'doc-2',
    rootAssetId: 'asset-2',
    projectId: 'p-1',
    processingMode: 'HYBRID',
    sourceLanguage: 'en',
    targetLang: 'ja',
    status: 'PROCESSING',
    subtitleMode: 'SOFT_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-09-02T10:00:00Z',
  },
  {
    id: 'job-3',
    documentId: 'doc-3',
    rootAssetId: 'asset-3',
    projectId: 'p-1',
    processingMode: 'LOCALIZATION',
    sourceLanguage: 'en',
    targetLang: 'vi',
    status: 'FAILED',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-09-03T10:00:00Z',
  },
  {
    id: 'job-4',
    documentId: 'doc-4',
    rootAssetId: 'asset-4',
    projectId: 'p-1',
    processingMode: 'LOCALIZATION',
    sourceLanguage: 'en',
    targetLang: 'zh',
    status: 'WAITING_APPROVAL',
    subtitleMode: 'HARD_SUB',
    requestedDurationSeconds: null,
    selectedProposalId: null,
    createdAt: '2026-09-04T10:00:00Z',
  },
]

const assetMap = new Map<string, string>([
  ['asset-1', 'Apple keynote.mp4'],
  ['asset-2', 'Banana demo.mp4'],
  ['asset-3', 'Cherry tutorial.mp4'],
  ['asset-4', 'Date presentation.mp4'],
])

describe('jobFilters', () => {
  it('computes correct counts across statuses', () => {
    const counts = computeJobCounts(mockJobs)
    expect(counts.all).toBe(4)
    expect(counts.active).toBe(1) // job-2
    expect(counts.failed).toBe(1) // job-3
    expect(counts.completed).toBe(1) // job-1
    expect(counts.needReview).toBe(1) // job-4
  })

  it('detects need review jobs', () => {
    expect(isNeedReviewJob(mockJobs[3])).toBe(true)
    expect(isNeedReviewJob(mockJobs[0])).toBe(false)
  })

  it('filters by search keyword matching video title or job ID', () => {
    const res = filterAndSortJobs(mockJobs, assetMap, { search: 'banana' })
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('job-2')

    const resId = filterAndSortJobs(mockJobs, assetMap, { search: 'job-3' })
    expect(resId).toHaveLength(1)
    expect(resId[0].id).toBe('job-3')
  })

  it('filters by status chip', () => {
    const active = filterAndSortJobs(mockJobs, assetMap, { status: 'ACTIVE' })
    expect(active.map((j) => j.id)).toEqual(['job-2'])

    const failed = filterAndSortJobs(mockJobs, assetMap, { status: 'FAILED' })
    expect(failed.map((j) => j.id)).toEqual(['job-3'])

    const completed = filterAndSortJobs(mockJobs, assetMap, { status: 'COMPLETED' })
    expect(completed.map((j) => j.id)).toEqual(['job-1'])

    const review = filterAndSortJobs(mockJobs, assetMap, { status: 'NEED_REVIEW' })
    expect(review.map((j) => j.id)).toEqual(['job-4'])
  })

  it('filters by target language', () => {
    const vi = filterAndSortJobs(mockJobs, assetMap, { targetLang: 'vi' })
    expect(vi.map((j) => j.id)).toEqual(['job-3', 'job-1']) // default created_desc
  })

  it('filters by mode / recipe', () => {
    const hybrid = filterAndSortJobs(mockJobs, assetMap, { mode: 'modeHybrid' })
    expect(hybrid.map((j) => j.id)).toEqual(['job-2'])
  })

  it('sorts by created date asc and desc', () => {
    const asc = filterAndSortJobs(mockJobs, assetMap, { sortBy: 'created_asc' })
    expect(asc.map((j) => j.id)).toEqual(['job-1', 'job-2', 'job-3', 'job-4'])

    const desc = filterAndSortJobs(mockJobs, assetMap, { sortBy: 'created_desc' })
    expect(desc.map((j) => j.id)).toEqual(['job-4', 'job-3', 'job-2', 'job-1'])
  })

  it('sorts by video name asc and desc', () => {
    const nameAsc = filterAndSortJobs(mockJobs, assetMap, { sortBy: 'name_asc' })
    expect(nameAsc.map((j) => j.id)).toEqual(['job-1', 'job-2', 'job-3', 'job-4']) // Apple, Banana, Cherry, Date

    const nameDesc = filterAndSortJobs(mockJobs, assetMap, { sortBy: 'name_desc' })
    expect(nameDesc.map((j) => j.id)).toEqual(['job-4', 'job-3', 'job-2', 'job-1'])
  })
})
