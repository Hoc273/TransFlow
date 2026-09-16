import type { Role } from '@/lib/permissions'

export type Workspace = {
  id: string
  name: string
  slug: string
  myRole: Role
}

export type CreateWorkspaceRequest = {
  name: string
}
