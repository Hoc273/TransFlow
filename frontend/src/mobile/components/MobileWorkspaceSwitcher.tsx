import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconCheck, IconChevronDown, IconPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal'
import { useAuthStore } from '@/store/authStore'
import { useWorkspaces } from '@/hooks/useWorkspaces'
import { initialsFromName } from '@/lib/format'
import { cn } from '@/lib/cn'

/** Compact workspace switcher for mobile header — no desktop sidebar styles. */
export function MobileWorkspaceSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation('common')
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

  const name = current?.name || t('workspace.demoName')
  const avatar = initialsFromName(name)

  const onSelect = (id: string) => {
    const ws = workspaces.find((w) => w.id === id)
    if (ws) setCurrentWorkspace(ws)
    setOpen(false)
    if (id !== workspaceId) navigate(`/w/${id}`)
  }

  return (
    <div className={cn('relative min-w-0', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('workspace.switcherHint')}
        className="flex h-9 min-w-0 max-w-[150px] items-center gap-1.5 rounded-lg px-1.5 text-left transition-colors active:bg-neutral-100 dark:active:bg-neutral-800"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-[11px] font-bold text-white">
          {avatar}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-900 dark:text-white">
          {name}
        </span>
        <IconChevronDown size={14} className="shrink-0 text-neutral-400" />
      </button>

      {open && (
        <div className="fixed inset-x-3 top-14 z-50 max-h-[60dvh] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white py-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
          {workspaces.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-400">
              {t('workspace.emptyList')}
            </div>
          )}
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => onSelect(ws.id)}
              className={cn(
                'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-[13px]',
                ws.id === current?.id ? 'text-primary' : 'text-neutral-800 dark:text-neutral-200'
              )}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{ws.name}</span>
              {ws.id === current?.id && <IconCheck size={14} className="shrink-0" />}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-100 dark:border-neutral-800" />
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setCreateOpen(true)
            }}
            className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-primary"
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
