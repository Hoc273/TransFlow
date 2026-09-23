import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { IconTrash, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Modal } from '@/components/shared/Modal'
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

/** Workspace members — dashboard widget shown below Batch + Recent Projects. */
export function WorkspaceMembersWidget() {
  const { t } = useTranslation(['settings', 'common'])
  const { workspaceId = '' } = useParams()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const canManage = usePermission('workspace.manage_members')

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
    if (current === 'ADMIN' && next !== 'ADMIN' && userId === currentUserId && adminCount <= 1) {
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
    <div className="app-card flex flex-col" aria-busy={isLoading}>
      {/* Header — same style as QueueBatch / RecentProjects widgets */}
      <div className="app-card-header flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 bg-[var(--color-bg-surface-2)]/30">
        <div className="flex items-center gap-2">
          <IconUsers size={16} className="text-[var(--color-accent)]" />
          <h3 className="font-semibold text-xs text-[var(--color-text-primary)]">
            {t('settings:members.title')}
          </h3>
          {!isLoading && !isError && members.length > 0 && (
            <span className="rounded-full bg-[var(--color-bg-surface-3)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)] tabular-nums">
              {members.length}
            </span>
          )}
        </div>
        {canManage && (
          <button type="button" onClick={openInvite} className="btn-ghost-sm no-underline flex items-center gap-1 text-[11px] py-1 px-2">
            <IconUserPlus size={13} />
            <span>{t('settings:members.invite')}</span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="text-[11px] text-[var(--color-text-tertiary)] px-1 pb-2">
          {t('settings:members.subtitle')}
        </div>

        {rowError && (
          <div className="mb-3 rounded-lg border border-[var(--color-error)] bg-[var(--color-error-bg)] px-3 py-2 text-xs text-[var(--color-error)]">
            {rowError}
          </div>
        )}

        {isLoading && (
          <div className="py-8 text-center text-xs text-[var(--color-text-tertiary)]">
            {t('common:loading')}
          </div>
        )}

        {isError && !isLoading && (
          <EmptyState
            icon={<IconUsers size={32} stroke={1.25} />}
            title={t('common:error.loadFailed')}
            description={error instanceof ApiError ? error.message : undefined}
            className="py-6"
          >
            <button type="button" className="btn-secondary mt-4" onClick={() => void refetch()}>
              {t('common:retry')}
            </button>
          </EmptyState>
        )}

        {!isLoading && !isError && (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]/80">
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
                  const disableDemote = m.role === 'ADMIN' && isSelf && adminCount <= 1
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
                            title={disableDemote ? t('settings:members.lastAdminGuard') : undefined}
                          >
                            {['MEMBER', 'CLIENT'].map((r) => (
                              <option key={r} value={r}>
                                {t(`settings:roles.${r}`, { defaultValue: r })}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="role-pill">
                            {t(`settings:roles.${m.role}`, { defaultValue: m.role })}
                          </span>
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
              form="invite-member-form-dashboard"
              className="btn-primary"
              disabled={addMember.isPending}
            >
              {addMember.isPending ? t('settings:members.inviting') : t('settings:members.invite')}
            </button>
          </>
        }
      >
        <form id="invite-member-form-dashboard" onSubmit={onInvite} className="space-y-3">
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
