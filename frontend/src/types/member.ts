import type { Role } from '@/lib/permissions'

export type WorkspaceMember = {
  memberId: string
  userId: string
  email: string | null
  fullName: string | null
  role: Role
}

export type AddMemberRequest = {
  email: string
  role: Role
}

export type UpdateMemberRoleRequest = {
  role: Role
}
