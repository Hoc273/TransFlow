export type Project = {
  id: string
  name: string
  sourceLang: string
  defaultGlossaryId: string | null
  domain: string | null
  tone: string | null
  mediaCount?: number
  progressPercent?: number
}

export type CreateProjectBody = {
  name: string
  sourceLang: string
  defaultGlossaryId?: string | null
  domain?: string | null
  tone?: string | null
}

export type ProjectMember = {
  id?: string
  projectId: string
  userId: string
  email: string
  fullName: string
  role: string
  addedBy?: string
  createdAt?: string
  assignedAt?: string
}

export type AssignProjectMemberBody = {
  userId: string
}
