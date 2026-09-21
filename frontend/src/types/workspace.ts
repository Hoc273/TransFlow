import type { Role } from '@/lib/permissions'

export type Workspace = {
  id: string
  name: string
  slug: string
  myRole: Role
  role?: Role
  ownerUserId?: string
}

export type CreateWorkspaceRequest = {
  name: string
  slug?: string
}
