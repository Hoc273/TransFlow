import { NavLink } from 'react-router-dom'
import {
  IconFolder,
  IconLayoutDashboard,
  IconMenu2,
  IconVideo,
} from '@tabler/icons-react'
import clsx from 'clsx'

interface MobileBottomNavProps {
  workspaceId?: string
  onOpenMenu: () => void
}

export function MobileBottomNav({ workspaceId, onOpenMenu }: MobileBottomNavProps) {
  const base = workspaceId ? `/w/${workspaceId}` : ''

  const navItems = [
    { label: 'Dashboard', to: base, icon: <IconLayoutDashboard size={20} />, end: true },
    { label: 'Projects', to: `${base}/projects`, icon: <IconFolder size={20} /> },
    { label: 'Media', to: `${base}/media`, icon: <IconVideo size={20} /> },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 overflow-x-clip">
      <div className="mx-auto flex w-full max-w-xl min-w-0 items-stretch justify-around px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            clsx(
              'flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-medium transition-colors active:bg-neutral-100 dark:active:bg-neutral-800',
              isActive
                ? 'text-primary dark:text-primary font-semibold'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
            )
          }
        >
          {item.icon}
          <span className="truncate leading-tight">{item.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors active:bg-neutral-100 dark:active:bg-neutral-800"
      >
        <IconMenu2 size={20} />
        <span className="truncate leading-tight">Menu</span>
      </button>
      </div>
    </nav>
  )
}
