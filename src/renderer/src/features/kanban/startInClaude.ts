import type { KanbanCard, Project } from '../../../../shared/types'
import { useStore } from '../../store'

export function buildQuery(card: Pick<KanbanCard, 'title' | 'body'>): string {
  const content = card.body?.trim() ? card.body : card.title
  return `/cc-enhance ${content}`
}

export function canStartInClaude(project: Project | undefined): boolean {
  return project !== undefined && project.basePath !== ''
}

export async function startInClaude(card: KanbanCard, project: Project): Promise<void> {
  await useStore.getState().createChat({
    projectKey: project.projectKey,
    draftText: buildQuery(card),
    cardId: card.id,
    title: card.title
  })
}

export async function resumeSession(card: KanbanCard, project: Project): Promise<void> {
  if (!card.link) return
  await useStore.getState().createChat({
    projectKey: project.projectKey,
    resumeSessionId: card.link.sessionId,
    title: card.title
  })
}
