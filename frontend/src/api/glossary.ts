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

const glossaryIdToProjectId = new Map<string, string>()

async function resolveProjectIdForGlossary(
  workspaceId: string,
  glossaryId: string,
): Promise<string> {
  const cached = glossaryIdToProjectId.get(glossaryId)
  if (cached) return cached

  // Fetch projects and their glossaries to resolve mapping
  try {
    const projects = await apiRequest<any[]>(buildWorkspacePath(workspaceId, '/projects'))
    for (const p of projects || []) {
      try {
        const g = await apiRequest<any>(
          buildWorkspacePath(workspaceId, `/projects/${p.id}/glossary`),
        )
        if (g) {
          glossaryIdToProjectId.set(String(g.id), String(p.id))
          if (String(g.id) === glossaryId || String(p.id) === glossaryId) {
            return String(p.id)
          }
        }
      } catch {
        // Continue
      }
    }
    // If not matched, fallback to first project ID or glossaryId itself
    if (projects && projects.length > 0) {
      return String(projects[0].id)
    }
  } catch {
    // Fallback
  }
  return glossaryId
}

// ---------- Project-scoped Glossary APIs (transflow_mini canonical) ----------

export function getProjectGlossaryApi(workspaceId: string, projectId: string) {
  return apiRequest<Glossary>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary`),
  )
}

export async function listProjectTermsApi(
  workspaceId: string,
  projectId: string,
): Promise<GlossaryTerm[]> {
  const terms = await apiRequest<any[]>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary/terms`),
  )
  return (terms || []).map((t) => ({
    id: String(t.id),
    sourceTerm: t.sourceTerm,
    targetTerm: t.targetTerm,
    targetLang: t.targetLang,
    caseSensitive: false,
    partOfSpeech: null,
    note: null,
    updatedAt: new Date().toISOString(),
  }))
}

export function createProjectTermApi(
  workspaceId: string,
  projectId: string,
  body: TermBody & { targetLang?: string },
) {
  return apiRequest<GlossaryTerm>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary/terms`),
    {
      method: 'POST',
      body: {
        sourceTerm: body.sourceTerm,
        targetTerm: body.targetTerm,
        targetLang: (body as any).targetLang || 'vi',
      },
    },
  )
}

export function updateProjectTermApi(
  workspaceId: string,
  projectId: string,
  termId: string,
  body: TermBody & { targetLang?: string },
) {
  return apiRequest<GlossaryTerm>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary/terms/${termId}`),
    {
      method: 'PUT',
      body: {
        sourceTerm: body.sourceTerm,
        targetTerm: body.targetTerm,
        targetLang: (body as any).targetLang || 'vi',
      },
    },
  )
}

export function deleteProjectTermApi(workspaceId: string, projectId: string, termId: string) {
  return apiRequest<void>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary/terms/${termId}`),
    { method: 'DELETE' },
  )
}

export function importProjectGlossaryCsvApi(
  workspaceId: string,
  projectId: string,
  file: File,
) {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<ImportResult>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary/terms/import`),
    { method: 'POST', body: form, rawBody: true },
  )
}

// ---------- Backward-compatible UI Wrappers ----------

export async function listGlossariesApi(workspaceId: string): Promise<Glossary[]> {
  try {
    const projects = await apiRequest<any[]>(buildWorkspacePath(workspaceId, '/projects'))
    if (!projects || projects.length === 0) return []

    const glossaries = await Promise.all(
      projects.map(async (p) => {
        try {
          const g = await apiRequest<any>(
            buildWorkspacePath(workspaceId, `/projects/${p.id}/glossary`),
          )
          if (g) {
            glossaryIdToProjectId.set(String(g.id), String(p.id))
            return {
              id: String(g.id),
              name: g.name || `${p.name} Glossary`,
              description: `Project: ${p.name}`,
              termCount: Number(g.termCount ?? 0),
              updatedAt: g.updatedAt || g.createdAt || new Date().toISOString(),
            }
          }
        } catch {
          // Ignore failed lookup for single project
        }
        return null
      }),
    )
    return glossaries.filter(Boolean) as Glossary[]
  } catch {
    return []
  }
}

export async function createGlossaryApi(
  workspaceId: string,
  body: CreateGlossaryBody & { projectId?: string },
): Promise<Glossary> {
  const projects = await apiRequest<any[]>(buildWorkspacePath(workspaceId, '/projects'))
  const projectId = body.projectId || projects?.[0]?.id
  if (!projectId) {
    throw new Error('No project found in workspace to attach glossary')
  }
  const g = await apiRequest<any>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary`),
  )
  glossaryIdToProjectId.set(String(g.id), String(projectId))
  return {
    id: String(g.id),
    name: body.name || g.name,
    description: body.description || null,
    termCount: Number(g.termCount ?? 0),
    updatedAt: g.updatedAt || new Date().toISOString(),
  }
}

export async function getGlossaryApi(
  workspaceId: string,
  glossaryId: string,
): Promise<GlossaryDetail> {
  const projectId = await resolveProjectIdForGlossary(workspaceId, glossaryId)
  const g = await apiRequest<any>(
    buildWorkspacePath(workspaceId, `/projects/${projectId}/glossary`),
  )
  const terms = await listProjectTermsApi(workspaceId, projectId)
  return {
    id: String(g.id || glossaryId),
    name: g.name || 'Project Glossary',
    description: null,
    updatedAt: g.updatedAt || new Date().toISOString(),
    terms,
  }
}

export async function updateGlossaryApi(
  _workspaceId: string,
  glossaryId: string,
  body: UpdateGlossaryBody,
): Promise<Glossary> {
  return {
    id: glossaryId,
    name: body.name,
    description: body.description || null,
    termCount: 0,
    updatedAt: new Date().toISOString(),
  }
}

export async function deleteGlossaryApi(
  _workspaceId: string,
  _glossaryId: string,
): Promise<void> {
  // Project glossary is managed with the project lifecycle in transflow_mini
}

export async function listTermsApi(
  workspaceId: string,
  glossaryId: string,
): Promise<GlossaryTerm[]> {
  const projectId = await resolveProjectIdForGlossary(workspaceId, glossaryId)
  return listProjectTermsApi(workspaceId, projectId)
}

export async function addTermsApi(
  workspaceId: string,
  glossaryId: string,
  terms: TermBody[],
): Promise<ImportResult> {
  const projectId = await resolveProjectIdForGlossary(workspaceId, glossaryId)
  let added = 0
  const errors: string[] = []

  for (const term of terms) {
    try {
      await createProjectTermApi(workspaceId, projectId, term)
      added++
    } catch (err: any) {
      errors.push(err?.message || 'Failed to add term')
    }
  }

  return { added, skipped: 0, errors }
}

export async function updateTermApi(
  workspaceId: string,
  glossaryId: string,
  termId: string,
  body: TermBody,
): Promise<GlossaryTerm> {
  const projectId = await resolveProjectIdForGlossary(workspaceId, glossaryId)
  return updateProjectTermApi(workspaceId, projectId, termId, body)
}

export async function deleteTermApi(
  workspaceId: string,
  glossaryId: string,
  termId: string,
): Promise<void> {
  const projectId = await resolveProjectIdForGlossary(workspaceId, glossaryId)
  return deleteProjectTermApi(workspaceId, projectId, termId)
}

export async function importGlossaryCsvApi(
  workspaceId: string,
  glossaryId: string,
  file: File,
): Promise<ImportResult> {
  const projectId = await resolveProjectIdForGlossary(workspaceId, glossaryId)
  return importProjectGlossaryCsvApi(workspaceId, projectId, file)
}
