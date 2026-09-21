import { useMemo, useState, type FormEvent } from 'react'
import { IconChevronRight, IconTrash, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import {
  useAddMember,
  useMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/hooks/useMembers'
import { usePermission } from '@/hooks/usePermission'
import { type Role } from '@/lib/permissions'
import { useAuthStore } from '@/store/authStore'
import { ApiError } from '@/types/api'

const INVITE_ROLES: Role[] = ['MEMBER', 'CLIENT']

/** B.3 Member Management — GET/POST/PUT/DELETE /workspaces/{ws}/members */
export function MembersPage() {
  const { t } = useTranslation(['settings', 'common'])
  const { workspaceId = '' } = useParams()
  const workspaceName = useAuthStore((s) => s.currentWorkspace?.name)
  const currentUserId = useAuthStore((s) => s.user?.id)
  const canManage = usePermission('workspace.manage_members')
  useDocumentTitle(t('settings:members.title'))

  const { data: members = [], isLoading, isError, error, refetch } = useMembers(workspaceId)
  const addMember = useAddMember(workspaceId)
  const updateRole = useUpdateMemberRole(workspaceId)
  const removeMember = useRemoveMember(workspaceId)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('MEMBER')
  const [formError, setFormError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const adminCount = useMemo(
    () => members.filter((m) => m.role === 'ADMIN' || m.role === 'LEAD').length,
    [members],
  )

  const openInvite = () => {
    setEmail('')
    setRole('MEMBER')
    setFormError(null)
    setInviteOpen(true)
  }

  const onInvite = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const trimmed = email.trim()
    if (!trimmed) {
      setFormError(t('settings:members.emailRequired'))
      return
    }
    addMember.mutate(
      { email: trimmed, role },
      {
        onSuccess: () => setInviteOpen(false),
        onError: (err) => {
          setFormError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  const onRoleChange = (memberId: string, next: Role, current: Role, userId: string) => {
    setRowError(null)
    if (next === current) return
    // FE guard: last Admin cannot demote self (BE also protects owner remove).
    if (
      current === 'ADMIN' &&
      next !== 'ADMIN' &&
      userId === currentUserId &&
      adminCount <= 1
    ) {
      setRowError(t('settings:members.lastAdminGuard'))
      return
    }
    updateRole.mutate(
      { memberId, body: { role: next } },
      {
        onError: (err) => {
          setRowError(err instanceof ApiError ? err.message : t('common:error.generic'))
        },
      },
    )
  }

  const onRemove = (memberId: string, userId: string, memberRole: Role) => {
    setRowError(null)
    if (userId === currentUserId && memberRole === 'ADMIN' && adminCount <= 1) {
      setRowError(t('settings:members.lastAdminGuard'))
      return
    }
    if (!window.confirm(t('settings:members.confirmRemove'))) return
    removeMember.mutate(memberId, {
      onError: (err) => {
        setRowError(err instanceof ApiError ? err.message : t('common:error.generic'))
      },
    })
  }

  return (
    <div>
      <div className="breadcrumb">
        <span>{workspaceName || t('common:workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{t('settings:members.title')}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings:members.title')}</h1>
          <div className="page-subtitle">{t('settings:members.subtitle')}</div>
        </div>
        {canManage && (
          <button type="button" className="btn-primary" onClick={openInvite}>
            <IconUserPlus size={16} />
            {t('settings:members.invite')}
          </button>
        )}
      </div>

      {rowError && (
        <div className="mb-3 rounded-lg border border-[var(--color-error)] bg-[var(--color-error-bg)] px-3 py-2 text-xs text-[var(--color-error)]">
          {rowError}
        </div>
      )}

      <div className="app-card overflow-hidden">
        {isLoading && (
          <div className="py-12 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            icon={<IconUsers size={40} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-12"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        )}

        {!isLoading && !isError && (
          <div className="overflow-x-auto">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('settings:members.col.name')}</th>
                  <th>{t('settings:members.col.email')}</th>
                  <th>{t('settings:members.col.role')}</th>
                  {canManage && <th style={{ width: 100 }}>{t('settings:members.col.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isSelf = m.userId === currentUserId
                  const disableDemote =
                    m.role === 'ADMIN' && isSelf && adminCount <= 1
                  return (
                    <tr key={m.memberId}>
                      <td className="font-medium">
                        {m.fullName || t('settings:members.unnamed')}
                        {isSelf && (
                          <span className="ml-2 text-[11px] text-[var(--color-text-tertiary)]">
                            ({t('settings:members.you')})
                          </span>
                        )}
                      </td>
                      <td className="text-[var(--color-text-secondary)]">{m.email || '—'}</td>
                      <td>
                        {m.role === 'LEAD' ? (
                          <span className="role-pill font-semibold text-[var(--color-accent)]">
                            {t('settings:roles.LEAD', { defaultValue: 'Lead' })}
                          </span>
                        ) : canManage ? (
                          <select
                            className="field-select"
                            value={m.role}
                            disabled={updateRole.isPending || disableDemote}
                            onChange={(e) =>
                              onRoleChange(m.memberId, e.target.value as Role, m.role, m.userId)
                            }
                            title={
                              disableDemote ? t('settings:members.lastAdminGuard') : undefined
                            }
                          >
                            {['MEMBER', 'CLIENT'].map((r) => (
                              <option key={r} value={r}>
                                {t(`settings:roles.${r}`, { defaultValue: r })}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="role-pill">{t(`settings:roles.${m.role}`, { defaultValue: m.role })}</span>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <button
                            type="button"
                            className="btn-icon-danger"
                            disabled={removeMember.isPending || disableDemote}
                            title={t('settings:members.remove')}
                            onClick={() => onRemove(m.memberId, m.userId, m.role)}
                          >
                            <IconTrash size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => !addMember.isPending && setInviteOpen(false)}
        title={t('settings:members.inviteTitle')}
        description={t('settings:members.inviteDesc')}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={addMember.isPending}
              onClick={() => setInviteOpen(false)}
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="submit"
              form="invite-member-form"
              className="btn-primary"
              disabled={addMember.isPending}
            >
              {addMember.isPending ? t('settings:members.inviting') : t('settings:members.invite')}
            </button>
          </>
        }
      >
        <form id="invite-member-form" onSubmit={onInvite} className="space-y-3">
          <label className="field-label">
            <span>{t('settings:members.emailLabel')}</span>
            <input
              type="email"
              className="field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              autoFocus
              required
            />
          </label>
          <label className="field-label">
            <span>{t('settings:members.roleLabel')}</span>
            <select
              className="field-input"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`settings:roles.${r}`, { defaultValue: r })}
                </option>
              ))}
            </select>
          </label>
          {formError && <p className="field-error">{formError}</p>}
        </form>
      </Modal>
    </div>
  )
}
