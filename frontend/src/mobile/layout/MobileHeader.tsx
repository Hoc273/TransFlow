import { Link } from 'react-router-dom'
import { IconBell, IconSearch, IconSparkles } from '@tabler/icons-react'
import { MobileWorkspaceSwitcher } from '../components/MobileWorkspaceSwitcher'
import { AvatarMenu } from '@/components/layout/AvatarMenu'

interface MobileHeaderProps {
  workspaceId?: string
  onOpenSearch?: () => void
}

export function MobileHeader({ workspaceId, onOpenSearch }: MobileHeaderProps) {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-neutral-200 bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 pt-[env(safe-area-inset-top,0px)] overflow-visible">
      <div className="flex h-14 min-w-0 items-center justify-between gap-1 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Link
            to={`/w/${workspaceId}`}
            className="flex shrink-0 items-center gap-1 font-bold text-primary"
            aria-label="TransFlow home"
          >
            <IconSparkles size={20} className="text-primary" />
            <span className="hidden text-base font-semibold tracking-tight text-neutral-900 min-[380px]:inline dark:text-white">
              TransFlow
            </span>
          </Link>
          <div className="min-w-0 flex-1">
            <MobileWorkspaceSwitcher />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
              aria-label="Search"
            >
              <IconSearch size={19} />
            </button>
          )}
          <Link
            to={`/w/${workspaceId}/notifications`}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
            aria-label="Notifications"
          >
            <IconBell size={19} />
          </Link>
          <div className="flex h-10 w-10 items-center justify-center">
            <AvatarMenu />
          </div>
        </div>
      </div>
    </header>
  )
}
