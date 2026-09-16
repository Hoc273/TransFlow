export type DocumentItem = {
  id: string
  projectId: string
  name: string
  sourceLang: string
  status: string
  origin: string
  createdAt: string
}

export type CreateDocumentBody = {
  name: string
  sourceLang?: string
  content: string
}

export type UploadDocumentParams = {
  file: File
  name?: string
  sourceLang?: string
}
