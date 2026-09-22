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

export function listTermsApi(workspaceId: string, projectIdOrGlossaryId: string) {
  return apiRequest<GlossaryTerm[]>(
    buildWorkspacePath(workspaceId, `/projects/${projectIdOrGlossaryId}/glossary/terms`),
  ).catch(() =>
    apiRequest<GlossaryTerm[]>(
      buildWorkspacePath(workspaceId, `/glossaries/${projectIdOrGlossaryId}/terms`),
    ),
  )
}

export function addTermsApi(workspaceId: string, projectIdOrGlossaryId: string, terms: TermBody[]) {
  // Support single term creation for Spring Boot backend if 1 term
  if (terms.length === 1) {
    const single = terms[0]
    return apiRequest<any>(
      buildWorkspacePath(workspaceId, `/projects/${projectIdOrGlossaryId}/glossary/terms`),
      {
        method: 'POST',
        body: {
          sourceTerm: single.sourceTerm,
          targetTerm: single.targetTerm,
          targetLang: single.targetLang || 'all',
        },
      },
    ).catch(() =>
      apiRequest<ImportResult>(
        buildWorkspacePath(workspaceId, `/glossaries/${projectIdOrGlossaryId}/terms`),
        { method: 'POST', body: { terms } },
      ),
    )
  }

  return apiRequest<ImportResult>(
    buildWorkspacePath(workspaceId, `/glossaries/${projectIdOrGlossaryId}/terms`),
    { method: 'POST', body: { terms } },
  )
}

export function updateTermApi(
  workspaceId: string,
  projectIdOrGlossaryId: string,
  termId: string,
  body: TermBody,
) {
  return apiRequest<GlossaryTerm>(
    buildWorkspacePath(workspaceId, `/projects/${projectIdOrGlossaryId}/glossary/terms/${termId}`),
    {
      method: 'PUT',
      body: {
        sourceTerm: body.sourceTerm,
        targetTerm: body.targetTerm,
        targetLang: body.targetLang || 'all',
      },
    },
  ).catch(() =>
    apiRequest<GlossaryTerm>(
      buildWorkspacePath(workspaceId, `/glossaries/${projectIdOrGlossaryId}/terms/${termId}`),
      { method: 'PUT', body },
    ),
  )
}

export function deleteTermApi(workspaceId: string, projectIdOrGlossaryId: string, termId: string) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/projects/${projectIdOrGlossaryId}/glossary/terms/${termId}`),
    { method: 'DELETE' },
  ).catch(() =>
    apiRequest<void>(
      buildWorkspacePath(workspaceId, `/glossaries/${projectIdOrGlossaryId}/terms/${termId}`),
      { method: 'DELETE' },
    ),
  )
}

export function importGlossaryCsvApi(
  workspaceId: string,
  projectIdOrGlossaryId: string,
  file: File,
) {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<ImportResult>(
    buildWorkspacePath(workspaceId, `/projects/${projectIdOrGlossaryId}/glossary/terms/import`),
    { method: 'POST', body: form, rawBody: true },
  ).catch(() =>
    apiRequest<ImportResult>(
      buildWorkspacePath(workspaceId, `/glossaries/${projectIdOrGlossaryId}/import`),
      { method: 'POST', body: form, rawBody: true },
    ),
  )
}
