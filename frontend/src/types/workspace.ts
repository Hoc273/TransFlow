import type { Role } from '@/lib/permissions'

export type Workspace = {
  id: string
  name: string
  slug: string
  role?: Role
  myRole: Role
  ownerUserId?: string
}

export type CreateWorkspaceRequest = {
  name: string
}
