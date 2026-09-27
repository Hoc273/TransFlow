import { beforeEach, describe, expect, it } from 'vitest'
import {
  RECENT_VISIBLE_LIMIT,
  orderRecentProjects,
  recentScopeKey,
  useRecentProjectsStore,
} from '@/store/recentProjectsStore'

const scope = recentScopeKey('user-1', 'ws-1')
const entries = () => useRecentProjectsStore.getState().byScope[scope] ?? []

describe('recentProjectsStore', () => {
  beforeEach(() => {
    useRecentProjectsStore.setState({ byScope: {} })
  })

  it('moves a revisited project to the top without duplicating it', () => {
    const { recordVisit } = useRecentProjectsStore.getState()
    recordVisit(scope, 'p1', 'One')
    recordVisit(scope, 'p2', 'Two')
    recordVisit(scope, 'p1')
    const { recent } = orderRecentProjects(entries())
    expect(recent.map((e) => e.id)).toEqual(['p1', 'p2'])
    expect(recent[0].name).toBe('One')
  })

  it('keeps pinned projects on top and out of the recent limit', () => {
    const { recordVisit, togglePin } = useRecentProjectsStore.getState()
    recordVisit(scope, 'p0', 'Zero')
    togglePin(scope, 'p0')
    for (let i = 1; i <= RECENT_VISIBLE_LIMIT + 2; i++) recordVisit(scope, `p${i}`)
    const { pinned, recent } = orderRecentProjects(entries())
    expect(pinned.map((e) => e.id)).toEqual(['p0'])
    expect(recent).toHaveLength(RECENT_VISIBLE_LIMIT)
    expect(recent.some((e) => e.id === 'p0')).toBe(false)
  })

  it('unpinning returns the project to the recent list', () => {
    const { recordVisit, togglePin } = useRecentProjectsStore.getState()
    recordVisit(scope, 'p1', 'One')
    togglePin(scope, 'p1')
    togglePin(scope, 'p1')
    const { pinned, recent } = orderRecentProjects(entries())
    expect(pinned).toHaveLength(0)
    expect(recent.map((e) => e.id)).toEqual(['p1'])
  })

  it('isolates scopes per user and workspace', () => {
    const other = recentScopeKey('user-2', 'ws-1')
    useRecentProjectsStore.getState().recordVisit(scope, 'p1')
    expect(useRecentProjectsStore.getState().byScope[other]).toBeUndefined()
    expect(recentScopeKey(undefined, 'ws-1')).toBe('')
  })
})
