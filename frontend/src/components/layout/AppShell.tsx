import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { TopNav } from './TopNav'
import { SidebarNav } from './SidebarNav'

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="app-shell">
      <TopNav onMobileMenu={() => setMobileOpen((v) => !v)} />
      <SidebarNav mobileOpen={mobileOpen} />
      <main className="app-content">
        <Outlet />
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
