export type Glossary = {
  id: string
  name: string
  description: string | null
  termCount: number
  updatedAt: string
}

export type GlossaryDetail = {
  id: string
  name: string
  description: string | null
  updatedAt: string
  terms: GlossaryTerm[]
}

export type GlossaryTerm = {
  id: string
  sourceTerm: string
  targetTerm: string
  caseSensitive: boolean
  partOfSpeech: string | null
  note: string | null
  updatedAt: string
}

export type CreateGlossaryBody = {
  name: string
  description?: string
}

export type UpdateGlossaryBody = {
  name: string
  description?: string
}

export type TermBody = {
  sourceTerm: string
  targetTerm: string
  caseSensitive?: boolean
  partOfSpeech?: string
  note?: string
}

export type ImportResult = {
  added: number
  skipped: number
  errors: string[]
}
