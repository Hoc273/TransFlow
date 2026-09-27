import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconCheck, IconChevronDown, IconPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { initialsFromName } from '@/lib/format'
import { cn } from '@/lib/cn'

interface WorkspaceSwitcherProps {
  className?: string
}

/** B.2 — lists workspaces from GET /workspaces, switch route, create modal. */
export function WorkspaceSwitcher({ className }: WorkspaceSwitcherProps) {
  const { t } = useTranslation('common')
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const { workspaceId } = useParams()
  const navigate = useNavigate()
  const current = useAuthStore((s) => s.currentWorkspace)
  const setCurrentWorkspace = useAuthStore((s) => s.setCurrentWorkspace)
  const { data: workspaces = [] } = useWorkspaces()
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const getRoleLabel = (role?: string) => {
    if (!role) return t('workspace.demoRole')
    const key = role.toLowerCase()
    return t(`roles.${key}`, { defaultValue: role })
  }

  const name = current?.name || t('workspace.demoName')
  const roleLabel = getRoleLabel(current?.myRole)
  const avatar = initialsFromName(name)

  const onSelect = (id: string) => {
    const ws = workspaces.find((w) => w.id === id)
    if (ws) setCurrentWorkspace(ws)
    setOpen(false)
    if (id !== workspaceId) navigate(`/w/${id}`)
  }

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        className="workspace-bar w-full"
        title={t('workspace.switcherHint')}
        aria-label={t('workspace.switcherHint')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="workspace-avatar">{avatar}</div>
        <div className={cn('workspace-info min-w-0 flex-1', collapsed && 'hidden')}>
          <div className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
            {name}
          </div>
          <div className="text-[11px] tracking-wide text-[var(--color-text-tertiary)] uppercase">
            {roleLabel}
          </div>
        </div>
        {!collapsed && (
          <IconChevronDown size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
        )}
      </button>

      {open && !collapsed && (
        <div className="absolute top-full right-2 left-2 z-40 mt-1 max-h-72 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] py-1 shadow-lg">
          {workspaces.length === 0 && (
            <div className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
              {t('workspace.emptyList')}
            </div>
          )}
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-[13px] hover:bg-[var(--color-bg-surface-2)]',
                ws.id === current?.id && 'text-[var(--color-accent)]',
              )}
              onClick={() => onSelect(ws.id)}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{ws.name}</span>
              <span className="text-[10px] text-[var(--color-text-tertiary)] uppercase">
                {getRoleLabel(ws.myRole)}
              </span>
              {ws.id === current?.id && <IconCheck size={14} className="shrink-0" />}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-[13px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-bg-surface-2)]"
            onClick={() => {
              setOpen(false)
              setCreateOpen(true)
            }}
          >
            <IconPlus size={16} />
            {t('workspace.create')}
          </button>
        </div>
      )}

      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
