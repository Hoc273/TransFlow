import { create } from 'zustand'

/**
 * One source video staged in the Media Studio create form. Lives in a store (not component state)
 * because the create panel is remounted when the layout switches between the mobile and desktop
 * shells (768px, e.g. a phone rotating): uploads still running must keep reporting into the same
 * rows and finished ones must survive the remount.
 */
export type StagedVideo = {
  key: string
  fileName: string
  fileSizeBytes: number
  durationMs: number | null
  assetId: string | null
  documentId: string | null
  consented: boolean
  uploadStatus: 'uploading' | 'ready' | 'failed'
  progress: number
  createStatus: 'idle' | 'creating' | 'created' | 'failed'
  jobId: string | null
  error: string | null
}

const EMPTY: StagedVideo[] = []

type StagedUploadState = {
  /** Keyed by `${workspaceId}:${projectId}`. */
  byScope: Record<string, StagedVideo[]>
  update: (scope: string, updater: (prev: StagedVideo[]) => StagedVideo[]) => void
  clear: (scope: string) => void
}

export const useStagedUploadStore = create<StagedUploadState>()((set) => ({
  byScope: {},
  update: (scope, updater) =>
    set((state) => {
      const next = updater(state.byScope[scope] ?? EMPTY)
      const byScope = { ...state.byScope }
      if (next.length === 0) delete byScope[scope]
      else byScope[scope] = next
      return { byScope }
    }),
  clear: (scope) =>
    set((state) => {
      if (!(scope in state.byScope)) return state
      const byScope = { ...state.byScope }
      delete byScope[scope]
      return { byScope }
    }),
}))

export const stagedScope = (workspaceId: string, projectId: string) => `${workspaceId}:${projectId}`

export function selectStaged(scope: string) {
  return (state: StagedUploadState) => state.byScope[scope] ?? EMPTY
}

/** Uploads in flight, per staged row — module level so a remounted panel can still cancel them. */
export const uploadAborts = new Map<string, AbortController>()
/** Rows removed before their upload started (still queued behind others): they must never start. */
export const removedStagedKeys = new Set<string>()
