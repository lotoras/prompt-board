// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KanbanCard, Project } from '../../src/shared/types'

const { create, setActive, mutate } = vi.hoisted(() => ({
  create: vi.fn(),
  setActive: vi.fn(),
  mutate: vi.fn()
}))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { caps: { pty: true }, chat: { create, setActive }, kanban: { mutate } }
}))

import { useStore } from '../../src/renderer/src/store'
import { CardEditorModal } from '../../src/renderer/src/features/kanban/CardEditorModal'

const PROJECT_KEY = 'proj-1'

function makeProject(): Project {
  return {
    projectKey: PROJECT_KEY,
    name: 'Project One',
    basePath: 'C:/x',
    createdAt: 0,
    updatedAt: 0
  }
}

function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'card-1',
    projectKey: PROJECT_KEY,
    columnId: 'todo',
    title: 'Some card',
    body: '',
    tags: [],
    order: 'a0',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function seedStore(card: KanbanCard, options?: { chats?: Array<Record<string, unknown>> }): void {
  useStore.setState((state) => ({
    ...state,
    boards: { boards: [], cards: [card] },
    projects: [makeProject()],
    chats: (options?.chats ?? []) as typeof state.chats,
    activeByProject: {},
    editingCardId: card.id
  }))
}

describe('CardEditorModal — Resume session button', () => {
  beforeEach(() => {
    create.mockReset()
    setActive.mockReset()
    setActive.mockResolvedValue(undefined)
    create.mockResolvedValue({
      chat: { chatId: 'c1', projectKey: PROJECT_KEY, sessionId: 'sess-1', toggles: { codex: 'off', fanOut: false, think: false }, started: true }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the Resume session button for a linked card', () => {
    const card = makeCard({ link: { sessionId: 'sess-1', cwd: 'C:/x' } })
    seedStore(card)

    render(<CardEditorModal />)

    expect(screen.queryByText('Resume session')).not.toBeNull()
  })

  it('hides the Resume session button for an unlinked card', () => {
    const card = makeCard({ link: undefined })
    seedStore(card)

    render(<CardEditorModal />)

    expect(screen.queryByText('Resume session')).toBeNull()
  })

  it('opens the linked session as a chat when there is no live matching chat', async () => {
    const card = makeCard({ link: { sessionId: 'sess-1', cwd: 'C:/x' } })
    seedStore(card, { chats: [] })

    render(<CardEditorModal />)

    fireEvent.click(screen.getByText('Resume session'))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      projectKey: PROJECT_KEY,
      resumeSessionId: 'sess-1',
      title: 'Some card'
    })
  })

  it('focuses an existing chat of the session instead of creating one', async () => {
    const card = makeCard({ link: { sessionId: 'sess-1', cwd: 'C:/x' } })
    seedStore(card, {
      chats: [{ chatId: 'c9', projectKey: PROJECT_KEY, sessionId: 'sess-1', title: 'Live' }]
    })

    render(<CardEditorModal />)

    fireEvent.click(screen.getByText('Resume session'))

    await waitFor(() => expect(useStore.getState().activeByProject[PROJECT_KEY]).toBe('c9'))
    expect(create).not.toHaveBeenCalled()
  })
})

describe('CardEditorModal — due date field', () => {
  beforeEach(() => {
    mutate.mockReset()
    mutate.mockResolvedValue({ boards: [], cards: [] })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the due date input with the card\'s existing date', () => {
    const card = makeCard({ dueDate: '2026-08-20' })
    seedStore(card)

    render(<CardEditorModal />)

    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-08-20')
  })

  it('renders an empty due date input when the card has no date', () => {
    const card = makeCard({ dueDate: undefined })
    seedStore(card)

    render(<CardEditorModal />)

    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('')
  })

  it('sends the changed due date in the updateCard patch on save', async () => {
    const card = makeCard({ dueDate: '2026-08-20' })
    seedStore(card)

    render(<CardEditorModal />)

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-25' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'updateCard',
        id: card.id,
        patch: expect.objectContaining({ dueDate: '2026-08-25' })
      })
    )
  })

  it('sends dueDate: null when the date input is cleared', async () => {
    const card = makeCard({ dueDate: '2026-08-20' })
    seedStore(card)

    render(<CardEditorModal />)

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ dueDate: null }) })
    )
  })
})
