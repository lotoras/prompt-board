import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import { FOR_LATER_COLUMN_ID, GLOBAL_BOARD_PROJECT_KEY } from '../../src/shared/types'

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { current: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir.current }
}))

describe('kanban/store', () => {
  let tmpDir: string

  beforeEach(async () => {
    vi.resetModules()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'kanban-store-'))
    userDataDir.current = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function loadStore() {
    return import('../../src/main/kanban/store')
  }

  describe('happy path', () => {
    it('seeds the global board with default columns on first load', async () => {
      const { getBoards } = await loadStore()
      const state = await getBoards()
      const globalBoard = state.boards.find((b) => b.projectKey === GLOBAL_BOARD_PROJECT_KEY)
      expect(globalBoard).toBeDefined()
      expect(globalBoard?.columns).toEqual([
        { id: 'for-later', title: 'For Later', order: -1 },
        { id: 'todo', title: 'Todo', order: 0 },
        { id: 'start-coding', title: 'Start coding', order: 1 },
        { id: 'doing', title: 'Doing', order: 2 },
        { id: 'done', title: 'Done', order: 3 }
      ])
    })

    it('creates a card with generated id and timestamps, ensuring its board exists', async () => {
      const { mutateKanban } = await loadStore()
      const state = await mutateKanban({
        type: 'createCard',
        card: {
          projectKey: 'proj-1',
          columnId: 'todo',
          title: 'Task',
          body: '',
          tags: [],
          order: 'm'
        }
      })
      expect(state.cards).toHaveLength(1)
      const card = state.cards[0]
      expect(card.id).toBeTruthy()
      expect(card.createdAt).toBeGreaterThan(0)
      expect(card.updatedAt).toBeGreaterThan(0)
      expect(state.boards.some((b) => b.projectKey === 'proj-1')).toBe(true)
    })

    it('updates a card patch and bumps updatedAt without touching unrelated fields', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: { projectKey: 'proj-1', columnId: 'todo', title: 'Task', body: 'body', tags: [], order: 'm' }
      })
      const cardId = created.cards[0].id
      const updated = await mutateKanban({
        type: 'updateCard',
        id: cardId,
        patch: { title: 'New Title' }
      })
      const card = updated.cards.find((c) => c.id === cardId)!
      expect(card.title).toBe('New Title')
      expect(card.body).toBe('body')
      expect(card.updatedAt).toBeGreaterThanOrEqual(created.cards[0].updatedAt)
    })

    it('moves a card to a new column and order', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: { projectKey: 'proj-1', columnId: 'todo', title: 'Task', body: '', tags: [], order: 'm' }
      })
      const cardId = created.cards[0].id
      const moved = await mutateKanban({ type: 'moveCard', id: cardId, columnId: 'doing', order: 'z' })
      const card = moved.cards.find((c) => c.id === cardId)!
      expect(card.columnId).toBe('doing')
      expect(card.order).toBe('z')
    })

    it('deletes a card', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: { projectKey: 'proj-1', columnId: 'todo', title: 'Task', body: '', tags: [], order: 'm' }
      })
      const cardId = created.cards[0].id
      const deleted = await mutateKanban({ type: 'deleteCard', id: cardId })
      expect(deleted.cards).toEqual([])
    })

    it('upserts a board: inserts new, replaces existing by projectKey', async () => {
      const { mutateKanban } = await loadStore()
      const inserted = await mutateKanban({
        type: 'upsertBoard',
        board: { projectKey: 'proj-2', columns: [{ id: 'a', title: 'A', order: 0 }] }
      })
      expect(inserted.boards.some((b) => b.projectKey === 'proj-2')).toBe(true)

      const replaced = await mutateKanban({
        type: 'upsertBoard',
        board: { projectKey: 'proj-2', columns: [{ id: 'b', title: 'B', order: 0 }] }
      })
      const board = replaced.boards.find((b) => b.projectKey === 'proj-2')!
      expect(board.columns).toEqual([{ id: 'b', title: 'B', order: 0 }])
    })
  })

  describe('edge cases / failure', () => {
    it('rejects updateCard on a missing id', async () => {
      const { mutateKanban } = await loadStore()
      await expect(
        mutateKanban({ type: 'updateCard', id: 'missing', patch: { title: 'x' } })
      ).rejects.toThrow('Card not found')
    })

    it('rejects moveCard on a missing id', async () => {
      const { mutateKanban } = await loadStore()
      await expect(
        mutateKanban({ type: 'moveCard', id: 'missing', columnId: 'todo', order: 'm' })
      ).rejects.toThrow('Card not found')
    })

    it('reflects persisted boards.json after a fresh module load', async () => {
      const { mutateKanban } = await loadStore()
      await mutateKanban({
        type: 'createCard',
        card: { projectKey: 'proj-1', columnId: 'todo', title: 'Task', body: '', tags: [], order: 'm' }
      })

      vi.resetModules()
      const fresh = await loadStore()
      const state = await fresh.getBoards()
      expect(state.cards).toHaveLength(1)
      expect(state.cards[0].title).toBe('Task')
    })

    it('leaves no boards.json.tmp and valid JSON after a mutation', async () => {
      const { mutateKanban } = await loadStore()
      await mutateKanban({
        type: 'createCard',
        card: { projectKey: 'proj-1', columnId: 'todo', title: 'Task', body: '', tags: [], order: 'm' }
      })
      const file = join(tmpDir, 'boards.json')
      const raw = await fs.readFile(file, 'utf-8')
      expect(() => JSON.parse(raw)).not.toThrow()
      await expect(fs.access(`${file}.tmp`)).rejects.toThrow()
    })

    it('does not persist boards.json on a plain read with no existing file', async () => {
      const { getBoards } = await loadStore()
      const state = await getBoards()
      const globalBoard = state.boards.find((b) => b.projectKey === GLOBAL_BOARD_PROJECT_KEY)
      expect(globalBoard).toBeDefined()
      await expect(fs.access(join(tmpDir, 'boards.json'))).rejects.toThrow()
    })

    it('does not duplicate the global board on repeated getBoards calls', async () => {
      const { getBoards } = await loadStore()
      await getBoards()
      const state = await getBoards()
      const globalBoards = state.boards.filter((b) => b.projectKey === GLOBAL_BOARD_PROJECT_KEY)
      expect(globalBoards).toHaveLength(1)
    })

    it('migrates a persisted board without start-coding, inserting it between todo and doing on load', async () => {
      const file = join(tmpDir, 'boards.json')
      await fs.writeFile(
        file,
        JSON.stringify({
          boards: [
            {
              projectKey: 'proj-old',
              columns: [
                { id: 'todo', title: 'Todo', order: 0 },
                { id: 'doing', title: 'Doing', order: 1 },
                { id: 'done', title: 'Done', order: 2 }
              ]
            }
          ],
          cards: []
        })
      )

      const { getBoards } = await loadStore()
      const state = await getBoards()
      const board = state.boards.find((b) => b.projectKey === 'proj-old')!
      const todo = board.columns.find((c) => c.id === 'todo')!
      const startCoding = board.columns.find((c) => c.id === 'start-coding')!
      const doing = board.columns.find((c) => c.id === 'doing')!
      expect(startCoding).toBeDefined()
      expect(startCoding.order).toBeGreaterThan(todo.order)
      expect(startCoding.order).toBeLessThan(doing.order)

      const raw = await fs.readFile(file, 'utf-8')
      const persisted = JSON.parse(raw)
      const persistedBoard = persisted.boards.find((b: { projectKey: string }) => b.projectKey === 'proj-old')
      expect(persistedBoard.columns.some((c: { id: string }) => c.id === 'start-coding')).toBe(true)
    })
  })

  describe('for-later column migration', () => {
    it('seeds a fresh global board with for-later first and lowest order', async () => {
      const { getBoards } = await loadStore()
      const state = await getBoards()
      const globalBoard = state.boards.find((b) => b.projectKey === GLOBAL_BOARD_PROJECT_KEY)!
      expect(globalBoard.columns[0]).toEqual({ id: FOR_LATER_COLUMN_ID, title: 'For Later', order: -1 })
      const todo = globalBoard.columns.find((c) => c.id === 'todo')!
      expect(globalBoard.columns[0].order).toBeLessThan(todo.order)
    })

    it('migrates pre-seeded global and project boards missing for-later', async () => {
      const file = join(tmpDir, 'boards.json')
      const oldColumns = [
        { id: 'todo', title: 'Todo', order: 0 },
        { id: 'start-coding', title: 'Start coding', order: 1 },
        { id: 'doing', title: 'Doing', order: 2 },
        { id: 'done', title: 'Done', order: 3 }
      ]
      await fs.writeFile(
        file,
        JSON.stringify({
          boards: [
            { projectKey: GLOBAL_BOARD_PROJECT_KEY, columns: oldColumns.map((c) => ({ ...c })) },
            { projectKey: 'c--tmp-demo', columns: oldColumns.map((c) => ({ ...c })) }
          ],
          cards: []
        })
      )

      const { getBoards } = await loadStore()
      const state = await getBoards()
      for (const projectKey of [GLOBAL_BOARD_PROJECT_KEY, 'c--tmp-demo']) {
        const board = state.boards.find((b) => b.projectKey === projectKey)!
        expect(board.columns[0].id).toBe(FOR_LATER_COLUMN_ID)
        const lowestOrder = Math.min(...board.columns.map((c) => c.order))
        expect(board.columns[0].order).toBe(lowestOrder)
        expect(board.columns.slice(1)).toEqual(oldColumns)
      }
    })

    it('is idempotent when a board already has a for-later column', async () => {
      const file = join(tmpDir, 'boards.json')
      await fs.writeFile(
        file,
        JSON.stringify({
          boards: [
            {
              projectKey: 'proj-existing',
              columns: [
                { id: 'for-later', title: 'For Later', order: -5 },
                { id: 'todo', title: 'Todo', order: 0 },
                { id: 'doing', title: 'Doing', order: 1 },
                { id: 'done', title: 'Done', order: 2 }
              ]
            }
          ],
          cards: []
        })
      )

      const { getBoards } = await loadStore()
      const state = await getBoards()
      const board = state.boards.find((b) => b.projectKey === 'proj-existing')!
      const forLaterColumns = board.columns.filter((c) => c.id === FOR_LATER_COLUMN_ID)
      expect(forLaterColumns).toHaveLength(1)
      expect(forLaterColumns[0].order).toBe(-5)
    })

    it('persists the for-later migration to boards.json on disk', async () => {
      const file = join(tmpDir, 'boards.json')
      await fs.writeFile(
        file,
        JSON.stringify({
          boards: [
            {
              projectKey: 'proj-old',
              columns: [
                { id: 'todo', title: 'Todo', order: 0 },
                { id: 'doing', title: 'Doing', order: 1 },
                { id: 'done', title: 'Done', order: 2 }
              ]
            }
          ],
          cards: []
        })
      )

      const { getBoards } = await loadStore()
      await getBoards()

      const raw = await fs.readFile(file, 'utf-8')
      const persisted = JSON.parse(raw)
      const persistedBoard = persisted.boards.find((b: { projectKey: string }) => b.projectKey === 'proj-old')
      expect(persistedBoard.columns.some((c: { id: string }) => c.id === FOR_LATER_COLUMN_ID)).toBe(true)
    })
  })

  describe('due dates', () => {
    it('creates a card with a dueDate and persists it across a fresh module load', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: {
          projectKey: 'proj-1',
          columnId: 'todo',
          title: 'Task',
          body: '',
          tags: [],
          order: 'm',
          dueDate: '2026-08-20'
        }
      })
      expect(created.cards[0].dueDate).toBe('2026-08-20')

      vi.resetModules()
      const fresh = await loadStore()
      const state = await fresh.getBoards()
      expect(state.cards[0].dueDate).toBe('2026-08-20')
    })

    it('updateCard with patch.dueDate sets the date', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: { projectKey: 'proj-1', columnId: 'todo', title: 'Task', body: '', tags: [], order: 'm' }
      })
      const cardId = created.cards[0].id
      const updated = await mutateKanban({
        type: 'updateCard',
        id: cardId,
        patch: { dueDate: '2026-08-20' }
      })
      expect(updated.cards.find((c) => c.id === cardId)!.dueDate).toBe('2026-08-20')
    })

    it('updateCard with patch.dueDate: null deletes the date, on disk too', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: {
          projectKey: 'proj-1',
          columnId: 'todo',
          title: 'Task',
          body: '',
          tags: [],
          order: 'm',
          dueDate: '2026-08-20'
        }
      })
      const cardId = created.cards[0].id
      const updated = await mutateKanban({ type: 'updateCard', id: cardId, patch: { dueDate: null } })
      const card = updated.cards.find((c) => c.id === cardId)!
      expect('dueDate' in card).toBe(false)

      const raw = await fs.readFile(join(tmpDir, 'boards.json'), 'utf-8')
      const persisted = JSON.parse(raw)
      const persistedCard = persisted.cards.find((c: { id: string }) => c.id === cardId)
      expect('dueDate' in persistedCard).toBe(false)
    })

    it('updateCard with patch.dueDate: "" also deletes the date', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: {
          projectKey: 'proj-1',
          columnId: 'todo',
          title: 'Task',
          body: '',
          tags: [],
          order: 'm',
          dueDate: '2026-08-20'
        }
      })
      const cardId = created.cards[0].id
      const updated = await mutateKanban({ type: 'updateCard', id: cardId, patch: { dueDate: '' } })
      const card = updated.cards.find((c) => c.id === cardId)!
      expect('dueDate' in card).toBe(false)
    })

    it('updateCard patch omitting dueDate leaves an existing date untouched', async () => {
      const { mutateKanban } = await loadStore()
      const created = await mutateKanban({
        type: 'createCard',
        card: {
          projectKey: 'proj-1',
          columnId: 'todo',
          title: 'Task',
          body: '',
          tags: [],
          order: 'm',
          dueDate: '2026-08-20'
        }
      })
      const cardId = created.cards[0].id
      const updated = await mutateKanban({ type: 'updateCard', id: cardId, patch: { title: 'x' } })
      const card = updated.cards.find((c) => c.id === cardId)!
      expect(card.title).toBe('x')
      expect(card.dueDate).toBe('2026-08-20')
    })
  })
})
