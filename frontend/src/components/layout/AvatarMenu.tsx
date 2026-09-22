import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconLogout, IconSettings, IconShieldCheck, IconUser } from '@tabler/icons-react'
import { useAuthStore, getLastWorkspaceId } from '@/store/authStore'
import { useLogout } from '@/hooks/useAuth'
import { initialsFromName } from '@/lib/format'

export function AvatarMenu() {
  const { t } = useTranslation('common')
  const { workspaceId } = useParams()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const currentWs = useAuthStore((s) => s.currentWorkspace?.id)
  const logout = useLogout()

  const wsId = workspaceId ?? currentWs ?? getLastWorkspaceId()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const name = user?.fullName || t('user.demoName')
  const email = user?.email || t('user.demoEmail')
  const initials = user ? initialsFromName(user.fullName) : t('user.demoInitials')

  const close = () => setOpen(false)

  return (
    <div className="app-dropdown" ref={ref}>
      <button
        type="button"
        className="app-avatar overflow-hidden"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={name}
      >
        {user?.avatarUrl ? (
          <img src={user.avatarUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </button>
      {open && (
        <div className="app-dropdown-menu" role="menu">
          <div className="border-b border-[var(--color-border)] px-2.5 py-2.5">
            <div className="text-[13px] font-semibold">{name}</div>
            <div className="text-[11px] text-[var(--color-text-tertiary)]">{email}</div>
            {role && (
              <div className="mt-1">
                <span className="status-badge status-badge-processing text-[10px]">{role}</span>
              </div>
            )}
          </div>
          {wsId ? (
            <>
              <Link
                to={`/w/${wsId}/account/profile`}
                className="app-dropdown-item"
                role="menuitem"
                onClick={close}
              >
                <IconUser size={15} />
                {t('profile')}
              </Link>
              <Link
                to={`/w/${wsId}/account/security`}
                className="app-dropdown-item"
                role="menuitem"
                onClick={close}
              >
                <IconSettings size={15} />
                {t('settings')}
              </Link>
            </>
          ) : (
            <>
              <button type="button" className="app-dropdown-item" role="menuitem" disabled>
                <IconUser size={15} />
                {t('profile')}
              </button>
              <button type="button" className="app-dropdown-item" role="menuitem" disabled>
                <IconSettings size={15} />
                {t('settings')}
              </button>
            </>
          )}
          {Boolean(user?.isPlatformAdmin) && (
            <>
              <div className="app-dropdown-divider" />
              <Link
                to="/platform"
                className="app-dropdown-item text-[var(--color-accent)] font-medium"
                role="menuitem"
                onClick={close}
              >
                <IconShieldCheck size={15} />
                <span>{t('common:nav.platformAdmin', { defaultValue: 'Platform Super Admin' })}</span>
              </Link>
            </>
          )}
          <div className="app-dropdown-divider" />
          <button
            type="button"
            className="app-dropdown-item"
            style={{ color: 'var(--color-status-failed)' }}
            role="menuitem"
            onClick={() => {
              close()
              logout()
            }}
          >
            <IconLogout size={15} />
            {t('logout')}
          </button>
        </div>
      )}
    </div>
  )
}
