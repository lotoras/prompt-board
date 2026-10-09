// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KanbanCard, Project } from '../../src/shared/types'

const { spawn, mutate } = vi.hoisted(() => ({ spawn: vi.fn(), mutate: vi.fn() }))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { caps: { pty: true }, pty: { spawn }, kanban: { mutate } }
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

function seedStore(card: KanbanCard, options?: { terminals?: Record<string, unknown> }): void {
  useStore.setState((state) => ({
    ...state,
    boards: { boards: [], cards: [card] },
    projects: [makeProject()],
    terminals: (options?.terminals ?? {}) as typeof state.terminals,
    activeTabByProject: {},
    pendingCardLinks: {},
    editingCardId: card.id
  }))
}

describe('CardEditorModal — Resume session button', () => {
  beforeEach(() => {
    spawn.mockReset()
    spawn.mockResolvedValue({ ptyId: 'p1' })
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

  it('spawns a resumed terminal when there is no live matching terminal', async () => {
    const card = makeCard({ link: { sessionId: 'sess-1', cwd: 'C:/x' } })
    seedStore(card, { terminals: {} })

    render(<CardEditorModal />)

    fireEvent.click(screen.getByText('Resume session'))

    await waitFor(() => expect(spawn).toHaveBeenCalledTimes(1))
    expect(spawn).toHaveBeenCalledWith({
      projectKey: PROJECT_KEY,
      resumeSessionId: 'sess-1'
    })
  })

  it('focuses an existing live terminal instead of spawning', async () => {
    const card = makeCard({ link: { sessionId: 'sess-1', cwd: 'C:/x' } })
    seedStore(card, {
      terminals: {
        p9: {
          ptyId: 'p9',
          projectKey: PROJECT_KEY,
          title: '',
          status: 'running',
          sessionId: 'sess-1'
        }
      }
    })

    render(<CardEditorModal />)

    fireEvent.click(screen.getByText('Resume session'))

    await waitFor(() => expect(useStore.getState().activeTabByProject[PROJECT_KEY]).toBe('p9'))
    expect(spawn).not.toHaveBeenCalled()
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
