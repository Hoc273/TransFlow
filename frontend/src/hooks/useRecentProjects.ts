import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { recentScopeKey, useRecentProjectsStore } from '@/store/recentProjectsStore'

/** Scope key of the current user in the given workspace ('' when unknown). */
export function useRecentScope(workspaceId: string | undefined) {
  const userId = useAuthStore((s) => s.user?.id)
  return recentScopeKey(userId, workspaceId)
}

/**
 * Records that the user opened a project (Media Studio of that project).
 * Re-records when the project changes or its name first becomes known.
 */
export function useRecordProjectVisit(
  workspaceId: string | undefined,
  projectId: string | undefined | null,
  projectName?: string,
) {
  const scope = useRecentScope(workspaceId)
  const recordVisit = useRecentProjectsStore((s) => s.recordVisit)

  useEffect(() => {
    if (!scope || !projectId) return
    recordVisit(scope, projectId, projectName)
  }, [scope, projectId, projectName, recordVisit])
}
