export type Project = {
  id: string
  workspaceId?: string
  name: string
  sourceLang: string
  defaultGlossaryId?: string | null
  tmEnabled?: boolean
  domain?: string | null
  tone?: string | null
  documentCount?: number
  mediaCount?: number
  progressPercent?: number
  createdAt?: string
  updatedAt?: string
}

export type CreateProjectBody = {
  name: string
  sourceLang: string
  defaultGlossaryId?: string | null
  tmEnabled?: boolean
  domain?: string | null
  tone?: string | null
}
