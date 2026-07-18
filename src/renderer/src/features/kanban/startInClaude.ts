import type { KanbanCard, Project } from '../../../../shared/types'
import { api } from '../../lib/api'

export function buildQuery(card: Pick<KanbanCard, 'title' | 'body'>): string {
  const content = card.body?.trim() ? card.body : card.title
  return `/cc-enhance ${content}`
}

export function canStartInClaude(project: Project | undefined): boolean {
  return api.caps.pty && project !== undefined && project.basePath !== ''
}

export interface StartInClaudeActions {
  setPendingCardLink: (ptyId: string, cardId: string) => void
  addTerminal: (meta: {
    ptyId: string
    projectKey: string
    title: string
    status: 'running' | 'exited'
  }) => void
  setActiveTab: (projectKey: string, ptyId: string) => void
  setView: (view: { kind: 'project'; projectKey: string; tab: 'terminals' }) => void
}

export async function startInClaude(
  card: KanbanCard,
  project: Project,
  actions: StartInClaudeActions
): Promise<void> {
  const query = buildQuery(card)
  const { ptyId } = await api.pty.spawn({ projectKey: project.projectKey, initialQuery: query })
  actions.setPendingCardLink(ptyId, card.id)
  actions.addTerminal({ ptyId, projectKey: project.projectKey, title: '', status: 'running' })
  actions.setActiveTab(project.projectKey, ptyId)
  actions.setView({ kind: 'project', projectKey: project.projectKey, tab: 'terminals' })
}

export async function resumeSession(
  card: KanbanCard,
  project: Project,
  actions: StartInClaudeActions
): Promise<void> {
  if (!card.link) return
  const { ptyId } = await api.pty.spawn({
    projectKey: project.projectKey,
    resumeSessionId: card.link.sessionId
  })
  actions.addTerminal({ ptyId, projectKey: project.projectKey, title: '', status: 'running' })
  actions.setActiveTab(project.projectKey, ptyId)
  actions.setView({ kind: 'project', projectKey: project.projectKey, tab: 'terminals' })
}
