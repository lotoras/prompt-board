import { app } from 'electron'
import { join } from 'path'
import {
  GLOBAL_BOARD_PROJECT_KEY,
  type Board,
  type KanbanCard,
  type KanbanMutation,
  type KanbanState
} from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'

function filePath(): string {
  return join(app.getPath('userData'), 'boards.json')
}

let cache: KanbanState | null = null

function defaultColumns(): Board['columns'] {
  return [
    { id: 'todo', title: 'Todo', order: 0 },
    { id: 'doing', title: 'Doing', order: 1 },
    { id: 'done', title: 'Done', order: 2 }
  ]
}

async function load(): Promise<KanbanState> {
  if (cache) return cache
  cache = await readJsonFile<KanbanState>(filePath(), { boards: [], cards: [] })
  ensureBoard(cache, GLOBAL_BOARD_PROJECT_KEY)
  return cache
}

async function persist(): Promise<void> {
  await writeJsonFile(filePath(), cache ?? { boards: [], cards: [] })
}

function ensureBoard(state: KanbanState, projectKey: string): Board {
  let board = state.boards.find((b) => b.projectKey === projectKey)
  if (!board) {
    board = { projectKey, columns: defaultColumns() }
    state.boards.push(board)
  }
  return board
}

export async function getBoards(): Promise<KanbanState> {
  const state = await load()
  await persist()
  return state
}

export async function mutateKanban(mutation: KanbanMutation): Promise<KanbanState> {
  const state = await load()

  switch (mutation.type) {
    case 'createCard': {
      ensureBoard(state, mutation.card.projectKey)
      const now = Date.now()
      const card: KanbanCard = {
        ...mutation.card,
        id: `card_${now}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now
      }
      state.cards.push(card)
      break
    }
    case 'updateCard': {
      const card = state.cards.find((c) => c.id === mutation.id)
      if (!card) throw new Error(`Card not found: ${mutation.id}`)
      Object.assign(card, mutation.patch, { updatedAt: Date.now() })
      break
    }
    case 'moveCard': {
      const card = state.cards.find((c) => c.id === mutation.id)
      if (!card) throw new Error(`Card not found: ${mutation.id}`)
      card.columnId = mutation.columnId
      card.order = mutation.order
      card.updatedAt = Date.now()
      break
    }
    case 'deleteCard': {
      state.cards = state.cards.filter((c) => c.id !== mutation.id)
      break
    }
    case 'upsertBoard': {
      const index = state.boards.findIndex((b) => b.projectKey === mutation.board.projectKey)
      if (index === -1) {
        state.boards.push(mutation.board)
      } else {
        state.boards[index] = mutation.board
      }
      break
    }
  }

  await persist()
  return state
}
