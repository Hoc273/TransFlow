import { apiRequest, buildWorkspacePath } from '@/lib/api/client'
import type { Glossary, GlossaryTerm, ImportResult, TermBody } from '@/types/glossary'

function glossaryPath(workspaceId: string, projectId: string, suffix = '') {
  return buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary${suffix}`)
}

export function getProjectGlossaryApi(workspaceId: string, projectId: string) {
  return apiRequest<Glossary>(glossaryPath(workspaceId, projectId))
}

export function listTermsApi(workspaceId: string, projectId: string) {
  return apiRequest<GlossaryTerm[]>(glossaryPath(workspaceId, projectId, '/terms'))
}

export function addTermApi(workspaceId: string, projectId: string, body: TermBody) {
  return apiRequest<GlossaryTerm>(glossaryPath(workspaceId, projectId, '/terms'), {
    method: 'POST',
    body,
  })
}

export function updateTermApi(
  workspaceId: string,
  projectId: string,
  termId: string,
  body: TermBody,
) {
  return apiRequest<GlossaryTerm>(glossaryPath(workspaceId, projectId, `/terms/${termId}`), {
    method: 'PUT',
    body,
  })
}

export function deleteTermApi(workspaceId: string, projectId: string, termId: string) {
  return apiRequest<void>(glossaryPath(workspaceId, projectId, `/terms/${termId}`), {
    method: 'DELETE',
  })
}

export function importGlossaryCsvApi(workspaceId: string, projectId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<ImportResult>(glossaryPath(workspaceId, projectId, '/terms/import'), {
    method: 'POST',
    body: form,
    rawBody: true,
  })
}
