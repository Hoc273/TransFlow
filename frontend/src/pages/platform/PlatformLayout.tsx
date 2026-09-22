import { NavLink, Outlet } from 'react-router-dom'

const tabs = [
  { to: '/platform', label: 'Tổng quan', end: true },
  { to: '/platform/status', label: 'Trạng thái' },
  { to: '/platform/users', label: 'Người dùng' },
  { to: '/platform/workspaces', label: 'Workspace' },
  { to: '/platform/audit', label: 'Audit' },
]

export function PlatformLayout() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Quản trị nền tảng</h1>
      <nav className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => (isActive ? 'btn-primary text-xs' : 'btn-secondary text-xs')}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
