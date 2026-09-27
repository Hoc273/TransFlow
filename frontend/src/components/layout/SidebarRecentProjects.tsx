import { useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconFolder, IconPin, IconPinnedFilled, IconPinnedOff } from '@tabler/icons-react'
import { useProjects } from '@/hooks/useProjects'
import { useRecentScope } from '@/hooks/useRecentProjects'
import {
  orderRecentProjects,
  useRecentProjectsStore,
  type RecentProjectEntry,
} from '@/store/recentProjectsStore'
import { cn } from '@/lib/cn'

interface SidebarRecentProjectsProps {
  workspaceId: string
}

/**
 * Sidebar "Recent" group: projects whose Media Studio the user opened lately,
 * with pinned projects on top. Clicking opens Media Studio for that project.
 */
export function SidebarRecentProjects({ workspaceId }: SidebarRecentProjectsProps) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const scope = useRecentScope(workspaceId)
  const entries = useRecentProjectsStore((s) => (scope ? s.byScope[scope] : undefined))
  const togglePin = useRecentProjectsStore((s) => s.togglePin)
  const { data: projects } = useProjects(workspaceId)

  const { pinned, recent } = useMemo(() => {
    let list = entries ?? []
    if (projects) {
      // Hide projects that were deleted or are no longer assigned; show the current name.
      const byId = new Map(projects.map((p) => [p.id, p.name]))
      list = list
        .filter((e) => byId.has(e.id))
        .map((e) => ({ ...e, name: byId.get(e.id) ?? e.name }))
    }
    return orderRecentProjects(list)
  }, [entries, projects])

  const onMediaStudio = location.pathname === `/w/${workspaceId}/media`
  const activeProjectId = onMediaStudio
    ? searchParams.get('project') || searchParams.get('projectId')
    : null

  const renderItem = (entry: RecentProjectEntry) => {
    const isPinned = entry.pinnedAt !== null
    const label = entry.name || t('nav.untitledProject')
    const Icon = isPinned ? IconPinnedFilled : IconFolder
    return (
      <div key={entry.id} className="nav-recent-row">
        <Link
          to={`/w/${workspaceId}/media?projectId=${entry.id}`}
          className={cn('nav-item', activeProjectId === entry.id && 'active')}
          title={label}
        >
          <Icon size={18} stroke={1.75} className="shrink-0" />
          <span className="nav-label truncate">{label}</span>
        </Link>
        <button
          type="button"
          className={cn('nav-recent-pin', isPinned && 'is-pinned')}
          onClick={() => togglePin(scope, entry.id, entry.name)}
          aria-label={isPinned ? t('nav.unpinProject') : t('nav.pinProject')}
          title={isPinned ? t('nav.unpinProject') : t('nav.pinProject')}
        >
          {isPinned ? <IconPinnedOff size={14} stroke={1.75} /> : <IconPin size={14} stroke={1.75} />}
        </button>
      </div>
    )
  }

  const isEmpty = pinned.length === 0 && recent.length === 0

  return (
    <div className="nav-group">
      <div className="nav-group-title">{t('nav.recent')}</div>
      {isEmpty ? (
        <div className="nav-recent-empty">{t('nav.recentEmpty')}</div>
      ) : (
        <>
          {pinned.map(renderItem)}
          {recent.map(renderItem)}
        </>
      )}
    </div>
  )
}
