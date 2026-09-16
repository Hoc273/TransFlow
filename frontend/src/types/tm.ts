export type TmEntry = {
  id: string
  sourceLang: string
  targetLang: string
  sourceText: string
  targetText: string
  domain: string | null
  origin: string
  quality: number | null
  updatedAt: string
}

export type TmMatchView = {
  sourceText: string
  targetText: string
  score: number
  exact: boolean
}

export type TmLookup = {
  exact: TmMatchView | null
  fuzzy: TmMatchView[]
}

export type TmQueryResponse = {
  lookup: TmLookup | null
  entries: TmEntry[]
  total: number
}

export type TmQueryParams = {
  source?: string
  sl: string
  tl: string
}
