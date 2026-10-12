import { appJson, asList, OverlayApiError } from './appApi'
import type {
  ConversationSummary,
  KnowledgeFile,
  NoteDoc,
  ProjectSummary,
  SkillSummary,
} from '@overlay/app-core'

// `/api/v1/projects` is not deployed on every backend — a 404 latches the
// endpoint as missing for the rest of the session so the screen stops
// refetching on every focus. Successful lists are cached for the session and
// invalidated by project mutations.
let cachedProjects: ProjectSummary[] | null = null
let projectsEndpointMissing = false

const PROJECTS_UNAVAILABLE_MESSAGE = 'Projects are not available on this server yet.'

export async function listProjects(options?: { force?: boolean }): Promise<ProjectSummary[]> {
  if (projectsEndpointMissing) {
    throw new Error(PROJECTS_UNAVAILABLE_MESSAGE)
  }
  if (!options?.force && cachedProjects) {
    return cachedProjects
  }
  try {
    const payload = await appJson<unknown>('/api/v1/projects')
    cachedProjects = asList<ProjectSummary>(payload)
    return cachedProjects
  } catch (error) {
    if (error instanceof OverlayApiError && error.status === 404) {
      projectsEndpointMissing = true
      throw new Error(PROJECTS_UNAVAILABLE_MESSAGE)
    }
    throw error
  }
}

function invalidateProjectsCache(): void {
  cachedProjects = null
}

export async function getProject(projectId: string): Promise<ProjectSummary> {
  return appJson<ProjectSummary>('/api/v1/projects', {
    query: { projectId },
  })
}

export async function createProject(input: {
  name: string
  instructions?: string
  parentId?: string | null
}): Promise<{ id: string; project: ProjectSummary }> {
  try {
    return await appJson<{ id: string; project: ProjectSummary }>('/api/v1/projects', {
      method: 'POST',
      json: input,
    })
  } finally {
    invalidateProjectsCache()
  }
}

export async function updateProject(
  projectId: string,
  patch: { name?: string; instructions?: string; parentId?: string | null },
): Promise<{ success: boolean; project?: ProjectSummary }> {
  try {
    return await appJson<{ success: boolean; project?: ProjectSummary }>('/api/v1/projects', {
      method: 'PATCH',
      json: { projectId, ...patch },
    })
  } finally {
    invalidateProjectsCache()
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    await appJson('/api/v1/projects', {
      method: 'DELETE',
      query: { projectId },
    })
  } finally {
    invalidateProjectsCache()
  }
}

export async function listProjectChats(projectId: string): Promise<ConversationSummary[]> {
  const payload = await appJson<unknown>('/api/v1/conversations', {
    query: { projectId },
  })
  return asList<ConversationSummary>(payload)
}

export async function listProjectNotes(projectId: string): Promise<NoteDoc[]> {
  const payload = await appJson<unknown>('/api/v1/notes', {
    query: { projectId },
  })
  return asList<NoteDoc>(payload)
}

export async function listProjectFiles(projectId: string): Promise<KnowledgeFile[]> {
  const payload = await appJson<unknown>('/api/v1/files', {
    query: { projectId },
  })
  return asList<KnowledgeFile>(payload)
}

export async function listProjectSkills(projectId: string): Promise<SkillSummary[]> {
  const payload = await appJson<unknown>('/api/v1/skills', {
    query: { projectId },
  })
  return asList<SkillSummary>(payload)
}

// ── Phase 5: export / duplicate / knowledge-base attachments / transfer ──

export interface ProjectExportPayload {
  project: unknown
  files?: unknown[]
  [key: string]: unknown
}

/** Portable JSON archive — GET /api/v1/projects/export?projectId=. */
export async function exportProject(projectId: string): Promise<ProjectExportPayload> {
  return appJson<ProjectExportPayload>('/api/v1/projects/export', {
    query: { projectId },
  })
}

/** Clones a project's configuration (never its working data). */
export async function duplicateProject(
  sourceProjectId: string,
  name: string,
): Promise<{ project?: ProjectSummary }> {
  try {
    return await appJson<{ project?: ProjectSummary }>('/api/v1/projects/duplicate', {
      method: 'POST',
      json: { sourceProjectId, name },
    })
  } finally {
    invalidateProjectsCache()
  }
}

export interface ProjectKnowledgeBaseLink {
  knowledgeBaseId: string
  projectId: string
  attachedBy?: string
  createdAt: number
}

export async function listProjectKnowledgeBases(
  projectId: string,
): Promise<ProjectKnowledgeBaseLink[]> {
  const data = await appJson<{ knowledgeBases: ProjectKnowledgeBaseLink[] }>(
    '/api/v1/projects/knowledge-bases',
    { query: { projectId } },
  )
  return data.knowledgeBases
}

export async function attachProjectKnowledgeBase(
  projectId: string,
  knowledgeBaseId: string,
): Promise<void> {
  await appJson('/api/v1/projects/knowledge-bases', {
    method: 'POST',
    json: { projectId, knowledgeBaseId },
  })
}

export async function detachProjectKnowledgeBase(
  projectId: string,
  knowledgeBaseId: string,
): Promise<void> {
  await appJson('/api/v1/projects/knowledge-bases', {
    method: 'DELETE',
    json: { projectId, knowledgeBaseId },
  })
}

/** Moves material between a project and a knowledge base. */
export async function transferProjectKnowledge(body: {
  projectId?: string
  knowledgeBaseId?: string
  direction: 'promote' | 'copy' | 'save-answer'
  fileId?: string
  sourceId?: string
  conversationId?: string
  messageId?: string
  content?: string
  title?: string
}): Promise<Record<string, unknown>> {
  return appJson<Record<string, unknown>>('/api/v1/projects/knowledge-transfer', {
    method: 'POST',
    json: body,
  })
}
