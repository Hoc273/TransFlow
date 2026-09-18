import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type {
  CreateGlossaryBody,
  Glossary,
  GlossaryDetail,
  GlossaryTerm,
  ImportResult,
  TermBody,
  UpdateGlossaryBody,
} from '@/types/glossary'

export function listGlossariesApi(workspaceId: string) {
  return apiRequest<Glossary[]>(buildWorkspacePath(workspaceId, '/glossaries'))
}

export function createGlossaryApi(workspaceId: string, body: CreateGlossaryBody) {
  return apiRequest<Glossary>(buildWorkspacePath(workspaceId, '/glossaries'), {
    method: 'POST',
    body,
  })
}

export function getGlossaryApi(workspaceId: string, glossaryId: string) {
  return apiRequest<GlossaryDetail>(
    buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}`),
  )
}

export function updateGlossaryApi(
  workspaceId: string,
  glossaryId: string,
  body: UpdateGlossaryBody,
) {
  return apiRequest<Glossary>(
    buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}`),
    { method: 'PUT', body },
  )
}

export function deleteGlossaryApi(workspaceId: string, glossaryId: string) {
  return apiRequest<void>(buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}`), {
    method: 'DELETE',
  })
}

export function listTermsApi(workspaceId: string, glossaryId: string) {
  return apiRequest<GlossaryTerm[]>(
    buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}/terms`),
  )
}

export function addTermsApi(workspaceId: string, glossaryId: string, terms: TermBody[]) {
  return apiRequest<ImportResult>(
    buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}/terms`),
    { method: 'POST', body: { terms } },
  )
}

export function updateTermApi(
  workspaceId: string,
  glossaryId: string,
  termId: string,
  body: TermBody,
) {
  return apiRequest<GlossaryTerm>(
    buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}/terms/${termId}`),
    { method: 'PUT', body },
  )
}

export function deleteTermApi(workspaceId: string, glossaryId: string, termId: string) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}/terms/${termId}`),
    { method: 'DELETE' },
  )
}

export function importGlossaryCsvApi(
  workspaceId: string,
  glossaryId: string,
  file: File,
) {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<ImportResult>(
    buildWorkspacePath(workspaceId, `/glossaries/${glossaryId}/import`),
    { method: 'POST', body: form, rawBody: true },
  )
}
