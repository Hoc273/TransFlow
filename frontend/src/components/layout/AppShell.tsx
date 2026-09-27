import { Suspense, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { TopNav } from './TopNav'
import { SidebarNav } from './SidebarNav'

interface AppShellProps {
  children?: ReactNode
}

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

export function AppShell({ children }: AppShellProps = {}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="app-shell">
      <TopNav onMobileMenu={() => setMobileOpen((v) => !v)} />
      <SidebarNav mobileOpen={mobileOpen} />
      <main className="app-content">
        <Suspense fallback={<PageLoader />}>
          {children ?? <Outlet />}
        </Suspense>
      </main>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 top-14 z-20 bg-black/30 md:hidden"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </div>
  )
}
