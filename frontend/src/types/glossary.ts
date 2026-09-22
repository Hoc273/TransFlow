export type Glossary = {
  id: string
  projectId: string
  createdAt: string
}

export type GlossaryTerm = {
  id: string
  glossaryId: string
  sourceTerm: string
  targetTerm: string
  targetLang: string
}

export type TermBody = {
  sourceTerm: string
  targetTerm: string
  targetLang: string
}

export type ImportResult = {
  imported: number
  skipped: number
  errors: string[]
}
