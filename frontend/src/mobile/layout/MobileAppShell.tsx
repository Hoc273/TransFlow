import { Suspense, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { MobileHeader } from './MobileHeader'
import { MobileBottomNav } from './MobileBottomNav'
import { MobileMenuDrawer } from './MobileMenuDrawer'
import { GlobalSearchModal } from '@/components/layout/GlobalSearchModal'

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

export function MobileAppShell() {
  const { workspaceId } = useParams()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 overflow-x-clip">
      <MobileHeader workspaceId={workspaceId} onOpenSearch={() => setSearchOpen(true)} />
      <main className="mx-auto w-full max-w-xl min-w-0 flex-1 px-4 py-3 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] overflow-x-clip">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <MobileBottomNav workspaceId={workspaceId} onOpenMenu={() => setMenuOpen(true)} />
      <MobileMenuDrawer isOpen={menuOpen} onClose={() => setMenuOpen(false)} workspaceId={workspaceId} />
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} workspaceId={workspaceId ?? ''} />
    </div>
  )
}
