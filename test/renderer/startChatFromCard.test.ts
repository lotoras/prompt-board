// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { caps: { pty: true }, pty: { spawn: vi.fn() }, chat: {} }
}))

import {
  buildQuery,
  resumeSession,
  startInClaude
} from '../../src/renderer/src/features/kanban/startInClaude'
import { useStore } from '../../src/renderer/src/store'
import type { KanbanCard, Project } from '../../src/shared/types'

const project = { projectKey: 'proj-1', name: 'P', basePath: 'C:\\work\\proj-1' } as Project

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'card-1',
    projectKey: 'proj-1',
    title: 'Fix the chime',
    body: 'Make the chime quieter',
    ...overrides
  } as KanbanCard
}

const createChat = vi.fn()
const original = useStore.getState().createChat

beforeEach(() => {
  createChat.mockResolvedValue(undefined)
  useStore.setState({ createChat } as never)
})

afterEach(() => {
  useStore.setState({ createChat: original } as never)
  createChat.mockReset()
})

describe('Kanban helpers start chats', () => {
  it('startInClaude creates a draft chat pre-filled with the card query', async () => {
    const card = makeCard()
    await startInClaude(card, project)
    expect(createChat).toHaveBeenCalledTimes(1)
    expect(createChat).toHaveBeenCalledWith({
      projectKey: 'proj-1',
      draftText: buildQuery(card),
      cardId: 'card-1',
      title: 'Fix the chime'
    })
  })

  it('startInClaude uses the title when the card has no body', async () => {
    await startInClaude(makeCard({ body: '' }), project)
    expect(createChat).toHaveBeenCalledWith(
      expect.objectContaining({ draftText: '/cc-enhance Fix the chime' })
    )
  })

  it('resumeSession opens the linked session as a chat', async () => {
    const card = makeCard({ link: { sessionId: 'sess-9', cwd: 'C:\\work\\proj-1' } } as never)
    await resumeSession(card, project)
    expect(createChat).toHaveBeenCalledTimes(1)
    expect(createChat).toHaveBeenCalledWith({
      projectKey: 'proj-1',
      resumeSessionId: 'sess-9',
      title: 'Fix the chime'
    })
  })

  it('resumeSession does nothing for a card without a link', async () => {
    await resumeSession(makeCard({ link: undefined }), project)
    expect(createChat).not.toHaveBeenCalled()
  })
})
