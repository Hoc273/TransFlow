import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { CreateJobBody, JobDetail, JobSummary } from '@/types/job'

export function listJobsApi(workspaceId: string, documentId: string) {
  return apiRequest<JobSummary[]>(
    buildWorkspacePath(workspaceId, `/documents/${documentId}/jobs`),
  )
}

export function getJobApi(workspaceId: string, jobId: string) {
  return apiRequest<JobDetail>(buildWorkspacePath(workspaceId, `/jobs/${jobId}`))
}

export function createJobApi(workspaceId: string, documentId: string, body: CreateJobBody) {
  return apiRequest<JobDetail>(
    buildWorkspacePath(workspaceId, `/documents/${documentId}/jobs`),
    { method: 'POST', body },
  )
}
