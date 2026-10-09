// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Board, KanbanCard, Project } from '../../src/shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../src/shared/types'

const { spawn, mutate } = vi.hoisted(() => ({ spawn: vi.fn(), mutate: vi.fn() }))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { caps: { pty: true }, pty: { spawn }, kanban: { mutate } }
}))

import { useStore } from '../../src/renderer/src/store'
import { AktuellesList } from '../../src/renderer/src/features/kanban/AktuellesList'

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

const GLOBAL_BOARD: Board = {
  projectKey: GLOBAL_BOARD_PROJECT_KEY,
  columns: [
    { id: 'for-later', title: 'For Later', order: -1 },
    { id: 'todo', title: 'Todo', order: 0 },
    { id: 'start-coding', title: 'Start coding', order: 1 },
    { id: 'doing', title: 'Doing', order: 2 },
    { id: 'done', title: 'Done', order: 3 }
  ]
}

let idCounter = 0
function makeCard(overrides: Partial<KanbanCard> = {}): KanbanCard {
  idCounter += 1
  return {
    id: `card-${idCounter}`,
    projectKey: PROJECT_KEY,
    columnId: 'todo',
    title: `Card ${idCounter}`,
    body: '',
    tags: [],
    order: 'a0',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function seedStore(cards: KanbanCard[]): void {
  useStore.setState((state) => ({
    ...state,
    boards: { boards: [GLOBAL_BOARD], cards },
    projects: [makeProject()],
    terminals: {},
    activeTabByProject: {},
    pendingCardLinks: {},
    editingCardId: null
  }))
}

describe('AktuellesList', () => {
  beforeEach(() => {
    mutate.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 20))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('excludes a Done-column card with a past due date', () => {
    const card = makeCard({ title: 'Done card', columnId: 'done', dueDate: '2026-08-15' })
    seedStore([card])

    render(<AktuellesList />)

    expect(screen.queryByText('Done card')).toBeNull()
    expect(screen.getByText('Nothing due.')).not.toBeNull()
  })

  it('includes a For Later card with a past due date', () => {
    const card = makeCard({ title: 'For later card', columnId: 'for-later', dueDate: '2026-08-16' })
    seedStore([card])

    render(<AktuellesList />)

    expect(screen.getByText('For later card')).not.toBeNull()
  })

  it('excludes a card with no due date', () => {
    const card = makeCard({ title: 'No date card', dueDate: undefined })
    seedStore([card])

    render(<AktuellesList />)

    expect(screen.queryByText('No date card')).toBeNull()
    expect(screen.getByText('Nothing due.')).not.toBeNull()
  })

  it('excludes a future-dated card', () => {
    const card = makeCard({ title: 'Future card', dueDate: '2026-08-25' })
    seedStore([card])

    render(<AktuellesList />)

    expect(screen.queryByText('Future card')).toBeNull()
    expect(screen.getByText('Nothing due.')).not.toBeNull()
  })

  it('orders overdue cards oldest-first, and shows OVERDUE before TODAY', () => {
    const older = makeCard({ title: 'Older overdue', dueDate: '2026-08-10' })
    const newer = makeCard({ title: 'Newer overdue', dueDate: '2026-08-18' })
    const dueToday = makeCard({ title: 'Due today', dueDate: '2026-08-20' })
    seedStore([newer, dueToday, older])

    const { container } = render(<AktuellesList />)

    const nodes = Array.from(
      container.querySelectorAll('.aktuelles__section-header, .aktuelles-row__title')
    ).map((el) => el.textContent)

    expect(nodes).toEqual(['OVERDUE', 'Older overdue', 'Newer overdue', 'TODAY', 'Due today'])
  })

  it('renders the empty state when nothing is due', () => {
    seedStore([])

    render(<AktuellesList />)

    expect(screen.getByText('Nothing due.')).not.toBeNull()
  })
})
