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
import * as memberHooks from '@/hooks/useMembers'

interface NormalizedMember {
  id: string
  name: string
  email: string
  role: string
  avatarChar: string
  raw: any
}

export function MobileMembersPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()

  // Defensively invoke useMembers with or without workspaceId
  const membersResult =
    typeof memberHooks.useMembers === 'function'
      ? (memberHooks.useMembers as any)(workspaceId)
      : undefined

  // Defensively invoke mutation hooks if available
  const addMutation =
    typeof (memberHooks as any).useAddMember === 'function'
      ? (memberHooks as any).useAddMember(workspaceId)
      : undefined

  const removeMutation =
    typeof (memberHooks as any).useRemoveMember === 'function'
      ? (memberHooks as any).useRemoveMember(workspaceId)
      : undefined

  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('MEMBER')
  const [memberToRemove, setMemberToRemove] = useState<NormalizedMember | null>(null)
  const [search, setSearch] = useState('')
  const [selectedRoleFilter, setSelectedRoleFilter] = useState('ALL')

  // Extract raw list defensively from either mock or react-query shape
  const rawMembers: any[] = membersResult?.members ?? membersResult?.data ?? []
  const isLoading = Boolean(membersResult?.isLoading)

  // Normalize member items
  const members: NormalizedMember[] = useMemo(() => {
    return rawMembers.map((m, idx) => {
      const id = String(m?.memberId || m?.id || m?.userId || `member-${idx}`)
      const name = m?.fullName || m?.name || m?.email?.split('@')[0] || 'Thành viên'
      const memberEmail = m?.email || ''
      const memberRole = m?.role || 'MEMBER'
      const avatarChar = (name[0] || memberEmail[0] || 'U').toUpperCase()

      return {
        id,
        name,
        email: memberEmail,
        role: memberRole,
        avatarChar,
        raw: m,
      }
    })
  }, [rawMembers])

  // Filter members by search text and role
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const term = search.trim().toLowerCase()
      const matchesSearch =
        !term ||
        m.name.toLowerCase().includes(term) ||
        m.email.toLowerCase().includes(term)

      const matchesRole =
        selectedRoleFilter === 'ALL' || m.role.toUpperCase() === selectedRoleFilter

      return matchesSearch && matchesRole
    })
  }, [members, search, selectedRoleFilter])

  const handleInvite = () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return

    if (typeof membersResult?.inviteMember === 'function') {
      membersResult.inviteMember({ email: trimmedEmail, role })
    } else if (addMutation?.mutate) {
      addMutation.mutate({ email: trimmedEmail, role: role as any })
    }

    setEmail('')
    setRole('MEMBER')
    setInviteOpen(false)
  }

  const handleConfirmRemove = () => {
    if (!memberToRemove) return

    if (typeof membersResult?.removeMember === 'function') {
      membersResult.removeMember(memberToRemove.id)
    } else if (removeMutation?.mutate) {
      removeMutation.mutate(memberToRemove.id)
    }

    setMemberToRemove(null)
  }

  const roleFilterOptions = [
    { id: 'ALL', label: 'Tất cả' },
    { id: 'ADMIN', label: 'Admin' },
    { id: 'MEMBER', label: 'Member' },
    { id: 'TRANSLATOR', label: 'Translator' },
    { id: 'OWNER', label: 'Owner' },
  ]

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">
            Thành viên Workspace
          </h1>
          <p className="text-xs text-neutral-500 line-clamp-2">
            Quản lý quyền truy cập và vai trò trong workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
        >
          <IconPlus size={16} />
          <span>Mời</span>
        </button>
      </div>

      {/* Search & Filter */}
      {members.length > 0 && (
        <MobileSearchFilter
          value={search}
          onChange={setSearch}
          placeholder="Tìm theo tên hoặc email..."
          filters={roleFilterOptions}
          activeFilter={selectedRoleFilter}
          onFilterChange={setSelectedRoleFilter}
        />
      )}

      {/* Main Content */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">
          Đang tải danh sách thành viên...
        </div>
      ) : members.length === 0 ? (
        <MobileEmptyState
          icon={<IconUsers size={36} />}
          title="Chưa có thành viên nào"
          description="Workspace hiện tại chưa có thành viên. Hãy mời thêm đồng nghiệp để cùng làm việc."
          action={
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-transform"
            >
              <IconPlus size={16} />
              <span>Mời thành viên đầu tiên</span>
            </button>
          }
        />
      ) : filteredMembers.length === 0 ? (
        <MobileEmptyState
          icon={<IconSearch size={36} />}
          title="Không tìm thấy thành viên"
          description="Không có thành viên nào khớp với bộ lọc tìm kiếm hiện tại."
        />
      ) : (
        <div className="min-w-0 space-y-2.5">
          {filteredMembers.map((m) => (
            <MobileCard key={m.id} className="flex min-w-0 items-center justify-between gap-2 p-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-neutral-800 dark:text-neutral-300 font-bold text-sm">
                  {m.avatarChar || <IconUser size={18} />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-neutral-900 dark:text-white" title={m.name}>
                    {m.name}
                  </span>
                  <span className="truncate text-xs text-neutral-500" title={m.email}>{m.email}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <span className="max-w-[90px] truncate whitespace-nowrap rounded-full bg-neutral-100 dark:bg-neutral-800 px-2.5 py-0.5 text-[10px] font-semibold text-neutral-700 dark:text-neutral-300" title={m.role}>
                  {m.role}
                </span>
                {m.role.toUpperCase() !== 'LEAD' && (
                <button
                  type="button"
                  onClick={() => setMemberToRemove(m)}
                  aria-label={`Xóa ${m.name}`}
                  data-testid={`remove-member-${m.id}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 active:scale-95 transition-colors"
                >
                  <IconTrash size={16} />
                </button>
                )}
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      {/* Invite Member BottomSheet */}
      <BottomSheet
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Mời thành viên mới"
      >
        <div className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Email thành viên
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 text-sm focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Vai trò
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 text-sm focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            >
              <option value="MEMBER">Member (Thành viên)</option>
              <option value="ADMIN">Admin (Quản trị viên)</option>
              <option value="PM">PM (Quản lý dự án)</option>
              <option value="TRANSLATOR">Translator (Biên dịch viên)</option>
              <option value="PROOFREADER">Proofreader (Hiệu đính)</option>
              <option value="CLIENT">Client (Khách hàng)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleInvite}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-xs active:scale-[0.98] transition-transform"
          >
            Gửi lời mời
          </button>
        </div>
      </BottomSheet>

      {/* Remove Confirmation BottomSheet */}
      <BottomSheet
        isOpen={Boolean(memberToRemove)}
        onClose={() => setMemberToRemove(null)}
        title="Xóa thành viên"
      >
        <div className="space-y-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Bạn có chắc chắn muốn xóa thành viên{' '}
            <strong className="text-neutral-900 dark:text-white">
              {memberToRemove?.name}
            </strong>{' '}
            ({memberToRemove?.email}) khỏi workspace không? Thao tác này sẽ thu hồi mọi quyền truy cập của họ.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMemberToRemove(null)}
              className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-700 py-2.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleConfirmRemove}
              className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white shadow-xs active:scale-[0.98] transition-transform"
            >
              Xác nhận xóa
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  )
}
