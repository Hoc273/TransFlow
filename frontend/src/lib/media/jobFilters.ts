import type { MediaJob } from '@/types/media'
import { isActiveMediaJobStatus, recipeLabelKey } from '@/lib/media'

export type JobSortKey = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'

export type JobFilterState = {
  search?: string
  status?: string
  targetLang?: string
  mode?: string
  sortBy?: JobSortKey
}

export type JobCounts = {
  all: number
  active: number
  needReview: number
  failed: number
  completed: number
}

export function isNeedReviewJob(job: MediaJob): boolean {
  if (job.status === 'WAITING_APPROVAL' || job.status === 'WAITING_INPUT') return true
  if (job.workflowMode === 'MANUAL') {
    const isPaused = job.stages?.some(
      (s) => s.status === 'WAITING_APPROVAL' || s.status === 'WAITING_INPUT' || s.status === 'PAUSED',
    )
    if (isPaused) return true
  }
  return false
}

export function computeJobCounts(jobs: MediaJob[]): JobCounts {
  let active = 0
  let needReview = 0
  let failed = 0
  let completed = 0

  for (const job of jobs) {
    if (isActiveMediaJobStatus(job.status)) active++
    if (job.status === 'FAILED' || job.status === 'PARTIALLY_FAILED') failed++
    if (job.status === 'COMPLETED') completed++
    if (isNeedReviewJob(job)) needReview++
  }

  return {
    all: jobs.length,
    active,
    needReview,
    failed,
    completed,
  }
}

export function filterAndSortJobs(
  jobs: MediaJob[],
  assetMap: Map<string, string>,
  filters: JobFilterState,
): MediaJob[] {
  const {
    search = '',
    status = 'ALL',
    targetLang = 'ALL',
    mode = 'ALL',
    sortBy = 'created_desc',
  } = filters

  const normalizedSearch = search.trim().toLowerCase()

  const filtered = jobs.filter((job) => {
    // Search filter: check asset file name or job ID
    if (normalizedSearch) {
      const fileName = (assetMap.get(job.rootAssetId) || '').toLowerCase()
      const jobId = job.id.toLowerCase()
      if (!fileName.includes(normalizedSearch) && !jobId.includes(normalizedSearch)) {
        return false
      }
    }

    // Status filter
    if (status && status !== 'ALL') {
      if (status === 'ACTIVE') {
        if (!isActiveMediaJobStatus(job.status)) return false
      } else if (status === 'FAILED') {
        if (job.status !== 'FAILED' && job.status !== 'PARTIALLY_FAILED') return false
      } else if (status === 'COMPLETED') {
        if (job.status !== 'COMPLETED') return false
      } else if (status === 'NEED_REVIEW') {
        if (!isNeedReviewJob(job)) return false
      } else {
        if (job.status !== status) return false
      }
    }

    // Target language filter
    if (targetLang && targetLang !== 'ALL') {
      if (job.targetLang?.toLowerCase() !== targetLang.toLowerCase()) {
        return false
      }
    }

    // Mode filter
    if (mode && mode !== 'ALL') {
      if (mode === 'AUTO' || mode === 'MANUAL') {
        if (job.workflowMode !== mode) return false
      } else {
        const recipeKey = recipeLabelKey(job)
        if (recipeKey !== mode) return false
      }
    }

    return true
  })

  return filtered.sort((a, b) => {
    if (sortBy === 'created_asc') {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    }
    if (sortBy === 'created_desc') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    if (sortBy === 'name_asc' || sortBy === 'name_desc') {
      const nameA = assetMap.get(a.rootAssetId) || a.id
      const nameB = assetMap.get(b.rootAssetId) || b.id
      const cmp = nameA.localeCompare(nameB)
      return sortBy === 'name_asc' ? cmp : -cmp
    }
    return 0
  })
}
