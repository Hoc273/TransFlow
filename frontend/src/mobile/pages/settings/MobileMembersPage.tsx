import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  IconPlus,
  IconUser,
  IconUsers,
  IconTrash,
  IconSearch,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { useAddMember, useMembers, useRemoveMember } from '@/hooks/useMembers'
import { usePermission } from '@/hooks/usePermission'
import { type Role } from '@/lib/permissions'
import { useAuthStore } from '@/store/authStore'
import { ApiError } from '@/types/api'
import type { WorkspaceMember } from '@/types/member'
import { Trans, useTranslation } from 'react-i18next'

// RBAC 3 vai trò (SRS v1.4b): LEAD được auto-gán khi tạo workspace, chỉ mời MEMBER/CLIENT.
const INVITE_ROLES: Role[] = ['MEMBER', 'CLIENT']
const FILTER_ROLES: Role[] = ['LEAD', 'MEMBER', 'CLIENT']

interface NormalizedMember {
  id: string
  userId: string
  name: string
  email: string
  role: Role
  avatarChar: string
}

export function MobileMembersPage() {
  const { t } = useTranslation(['mobile', 'settings', 'common'])
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const canManage = usePermission('workspace.manage_members')

  const { data: rawMembers = [], isLoading, isError, refetch } = useMembers(workspaceId)
  const addMember = useAddMember(workspaceId)
  const removeMember = useRemoveMember(workspaceId)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('MEMBER')
  const [formError, setFormError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [memberToRemove, setMemberToRemove] = useState<NormalizedMember | null>(null)
  const [search, setSearch] = useState('')
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('ALL')

  const roleLabel = (r: string) => t(`settings:roles.${r}`, { defaultValue: r })

  const members: NormalizedMember[] = useMemo(() => {
    return rawMembers.map((m: WorkspaceMember) => {
      const memberEmail = m.email ?? ''
      const name = m.fullName || memberEmail.split('@')[0] || t('mobile:members.fallbackName')
      return {
        id: m.memberId,
        userId: m.userId,
        name,
        email: memberEmail,
        role: m.role,
        avatarChar: (name[0] || memberEmail[0] || 'U').toUpperCase(),
      }
    })
  }, [rawMembers, t])

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return members.filter((m) => {
      const matchesSearch =
        !term || m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term)
      const matchesRole = selectedRoleFilter === 'ALL' || m.role === selectedRoleFilter
      return matchesSearch && matchesRole
    })
  }, [members, search, selectedRoleFilter])

  const openInvite = () => {
    setEmail('')
    setRole('MEMBER')
    setFormError(null)
    setInviteOpen(true)
  }

  const handleInvite = () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setFormError(t('settings:members.emailRequired'))
      return
    }
    addMember.mutate(
      { email: trimmedEmail, role },
      {
        onSuccess: () => setInviteOpen(false),
        onError: (err) =>
          setFormError(err instanceof ApiError ? err.message : t('common:error.generic')),
      },
    )
  }

  const handleConfirmRemove = () => {
    if (!memberToRemove) return
    setRowError(null)
    removeMember.mutate(memberToRemove.id, {
      onError: (err) =>
        setRowError(err instanceof ApiError ? err.message : t('common:error.generic')),
    })
    setMemberToRemove(null)
  }

  const roleFilterOptions = [
    { id: 'ALL', label: t('mobile:members.filterAll') },
    ...FILTER_ROLES.map((r) => ({ id: r, label: roleLabel(r) })),
  ]

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">
            {t('mobile:members.title')}
          </h1>
          <p className="text-xs text-neutral-500 line-clamp-2">
            {canManage ? t('mobile:members.subtitle') : t('mobile:members.readOnlyHint')}
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openInvite}
            className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
          >
            <IconPlus size={16} />
            <span>{t('mobile:members.invite')}</span>
          </button>
        )}
      </div>

      {rowError && (
        <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {rowError}
        </div>
      )}

      {/* Search & Filter */}
      {members.length > 0 && (
        <MobileSearchFilter
          value={search}
          onChange={setSearch}
          placeholder={t('mobile:members.searchPlaceholder')}
          filters={roleFilterOptions}
          activeFilter={selectedRoleFilter}
          onFilterChange={setSelectedRoleFilter}
        />
      )}

      {/* Main Content */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">
          {t('mobile:members.loading')}
        </div>
      ) : isError ? (
        <MobileEmptyState
          icon={<IconUsers size={36} />}
          title={t('common:error.loadFailed')}
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-transform"
            >
              {t('common:retry')}
            </button>
          }
        />
      ) : members.length === 0 ? (
        <MobileEmptyState
          icon={<IconUsers size={36} />}
          title={t('mobile:members.emptyTitle')}
          description={t('mobile:members.emptyDesc')}
          action={
            canManage ? (
              <button
                type="button"
                onClick={openInvite}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-transform"
              >
                <IconPlus size={16} />
                <span>{t('mobile:members.inviteFirst')}</span>
              </button>
            ) : undefined
          }
        />
      ) : filteredMembers.length === 0 ? (
        <MobileEmptyState
          icon={<IconSearch size={36} />}
          title={t('mobile:members.noMatchTitle')}
          description={t('mobile:members.noMatchDesc')}
        />
      ) : (
        <div className="min-w-0 space-y-2.5">
          {filteredMembers.map((m) => {
            const isSelf = m.userId === currentUserId
            return (
              <MobileCard key={m.id} className="flex min-w-0 items-center justify-between gap-2 p-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-neutral-800 dark:text-neutral-300 font-bold text-sm">
                    {m.avatarChar || <IconUser size={18} />}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-neutral-900 dark:text-white" title={m.name}>
                      {m.name}
                      {isSelf && (
                        <span className="ml-1 font-normal text-neutral-500">
                          ({t('settings:members.you')})
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-neutral-500" title={m.email}>{m.email}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`max-w-[96px] truncate whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      m.role === 'LEAD'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                    }`}
                    title={roleLabel(m.role)}
                  >
                    {roleLabel(m.role)}
                  </span>
                  {canManage && m.role !== 'LEAD' && (
                    <button
                      type="button"
                      onClick={() => setMemberToRemove(m)}
                      aria-label={t('mobile:members.remove', { name: m.name })}
                      data-testid={`remove-member-${m.id}`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 active:scale-95 transition-colors"
                    >
                      <IconTrash size={16} />
                    </button>
                  )}
                </div>
              </MobileCard>
            )
          })}
        </div>
      )}

      {/* Invite Member BottomSheet */}
      <BottomSheet
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('mobile:members.inviteTitle')}
      >
        <div className="space-y-3.5">
          <div className="space-y-1">
            <label htmlFor="mobile-invite-email" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              {t('mobile:members.email')}
            </label>
            <input
              id="mobile-invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 text-base focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="mobile-invite-role" className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              {t('mobile:members.role')}
            </label>
            <select
              id="mobile-invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 text-base focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </div>

          {formError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}

          <button
            type="button"
            onClick={handleInvite}
            disabled={addMember.isPending}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-xs active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {addMember.isPending ? t('settings:members.inviting') : t('mobile:members.sendInvite')}
          </button>
        </div>
      </BottomSheet>

      {/* Remove Confirmation BottomSheet */}
      <BottomSheet
        isOpen={Boolean(memberToRemove)}
        onClose={() => setMemberToRemove(null)}
        title={t('mobile:members.removeTitle')}
      >
        <div className="space-y-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            <Trans
              i18nKey="mobile:members.removeConfirm"
              values={{ name: memberToRemove?.name ?? '', email: memberToRemove?.email ?? '' }}
              components={{ strong: <strong className="text-neutral-900 dark:text-white" /> }}
            />
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMemberToRemove(null)}
              className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-700 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              {t('mobile:members.cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmRemove}
              className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white shadow-xs active:scale-[0.98] transition-transform"
            >
              {t('mobile:members.confirmRemove')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}
