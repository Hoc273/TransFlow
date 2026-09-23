import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Unpinned entries kept per scope; the sidebar shows fewer (RECENT_VISIBLE_LIMIT). */
const RECENT_STORE_LIMIT = 20
export const RECENT_VISIBLE_LIMIT = 5

export type RecentProjectEntry = {
  id: string
  /** Name at visit time — fallback when the project list has not loaded yet. */
  name: string
  visitedAt: number
  /** Epoch ms when pinned; null when not pinned. */
  pinnedAt: number | null
}

interface RecentProjectsState {
  /** Keyed by `${userId}:${workspaceId}` so accounts/workspaces never mix. */
  byScope: Record<string, RecentProjectEntry[]>
  recordVisit: (scope: string, id: string, name?: string) => void
  togglePin: (scope: string, id: string, name?: string) => void
  remove: (scope: string, id: string) => void
}

export function recentScopeKey(userId: string | undefined, workspaceId: string | undefined) {
  return userId && workspaceId ? `${userId}:${workspaceId}` : ''
}

/** Drops the oldest unpinned entries beyond the store limit; pinned entries are always kept. */
function trim(entries: RecentProjectEntry[]): RecentProjectEntry[] {
  const unpinned = entries
    .filter((e) => e.pinnedAt === null)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, RECENT_STORE_LIMIT)
  const keep = new Set(unpinned.map((e) => e.id))
  return entries.filter((e) => e.pinnedAt !== null || keep.has(e.id))
}

/** Pinned first (oldest pin on top, stable order), then unpinned by most recent visit. */
export function orderRecentProjects(entries: RecentProjectEntry[]) {
  const pinned = entries
    .filter((e) => e.pinnedAt !== null)
    .sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0))
  const recent = entries
    .filter((e) => e.pinnedAt === null)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, RECENT_VISIBLE_LIMIT)
  return { pinned, recent }
}

export const useRecentProjectsStore = create<RecentProjectsState>()(
  persist(
    (set) => ({
      byScope: {},
      recordVisit: (scope, id, name) => {
        if (!scope || !id) return
        set((s) => {
          const list = s.byScope[scope] ?? []
          const existing = list.find((e) => e.id === id)
          const entry: RecentProjectEntry = {
            id,
            name: name || existing?.name || '',
            visitedAt: Date.now(),
            pinnedAt: existing?.pinnedAt ?? null,
          }
          const next = trim([entry, ...list.filter((e) => e.id !== id)])
          return { byScope: { ...s.byScope, [scope]: next } }
        })
      },
      togglePin: (scope, id, name) => {
        if (!scope || !id) return
        set((s) => {
          const list = s.byScope[scope] ?? []
          const existing = list.find((e) => e.id === id)
          const entry: RecentProjectEntry = existing
            ? { ...existing, pinnedAt: existing.pinnedAt === null ? Date.now() : null }
            : { id, name: name ?? '', visitedAt: Date.now(), pinnedAt: Date.now() }
          const next = trim([entry, ...list.filter((e) => e.id !== id)])
          return { byScope: { ...s.byScope, [scope]: next } }
        })
      },
      remove: (scope, id) => {
        set((s) => {
          const list = s.byScope[scope]
          if (!list) return s
          return { byScope: { ...s.byScope, [scope]: list.filter((e) => e.id !== id) } }
        })
      },
    }),
    { name: 'tf-recent-projects' },
  ),
)
