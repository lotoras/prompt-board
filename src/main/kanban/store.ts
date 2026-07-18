import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import {
  GLOBAL_BOARD_PROJECT_KEY,
  IPC_CHANNELS,
  type Board,
  type KanbanCard,
  type KanbanMutation,
  type KanbanState
} from '../../shared/types'
import { readJsonFile, writeJsonFile } from '../lib/atomicWrite'
import { enqueueCard, isApplyingRemote, nextTimestamp } from '../sync/engine'

function filePath(): string {
  return join(app.getPath('userData'), 'boards.json')
}

let cache: KanbanState | null = null
let getWindowRef: (() => BrowserWindow | null) | null = null

export function setWindowGetter(getWindow: () => BrowserWindow | null): void {
  getWindowRef = getWindow
}

function broadcastChanged(state: KanbanState): void {
  const win = getWindowRef?.()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.kanban.changed, state)
  }
}

function defaultColumns(): Board['columns'] {
  return [
    { id: 'todo', title: 'Todo', order: 0 },
    { id: 'start-coding', title: 'Start coding', order: 1 },
    { id: 'doing', title: 'Doing', order: 2 },
    { id: 'done', title: 'Done', order: 3 }
  ]
}

function migrateBoard(board: Board): boolean {
  if (board.columns.some((c) => c.id === 'start-coding')) return false

  const todo = board.columns.find((c) => c.id === 'todo')
  const doing = board.columns.find((c) => c.id === 'doing')
  const done = board.columns.find((c) => c.id === 'done')

  let order: number
  let index: number
  if (todo && doing) {
    order = (todo.order + doing.order) / 2
    index = board.columns.indexOf(doing)
  } else if (doing) {
    order = doing.order - 1
    index = board.columns.indexOf(doing)
  } else if (done) {
    order = done.order - 1
    index = board.columns.indexOf(done)
  } else {
    const maxOrder = board.columns.reduce((max, c) => Math.max(max, c.order), -1)
    order = maxOrder + 1
    index = board.columns.length
  }

  board.columns.splice(index, 0, { id: 'start-coding', title: 'Start coding', order })
  return true
}

async function load(): Promise<KanbanState> {
  if (cache) return cache
  cache = await readJsonFile<KanbanState>(filePath(), { boards: [], cards: [] })
  ensureBoard(cache, GLOBAL_BOARD_PROJECT_KEY)
  const migrated = cache.boards.reduce((any, b) => migrateBoard(b) || any, false)
  if (migrated) await persist()
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
  return load()
}

export async function mutateKanban(mutation: KanbanMutation): Promise<KanbanState> {
  const state = await load()
  let affectedCard: KanbanCard | undefined
  let deletedAtMs: number | undefined

  switch (mutation.type) {
    case 'createCard': {
      ensureBoard(state, mutation.card.projectKey)
      const now = nextTimestamp()
      const card: KanbanCard = {
        ...mutation.card,
        id: `card_${now}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now
      }
      state.cards.push(card)
      affectedCard = card
      break
    }
    case 'updateCard': {
      const card = state.cards.find((c) => c.id === mutation.id)
      if (!card) throw new Error(`Card not found: ${mutation.id}`)
      Object.assign(card, mutation.patch, { updatedAt: nextTimestamp() })
      affectedCard = card
      break
    }
    case 'moveCard': {
      const card = state.cards.find((c) => c.id === mutation.id)
      if (!card) throw new Error(`Card not found: ${mutation.id}`)
      card.columnId = mutation.columnId
      card.order = mutation.order
      card.updatedAt = nextTimestamp()
      affectedCard = card
      break
    }
    case 'deleteCard': {
      const card = state.cards.find((c) => c.id === mutation.id)
      state.cards = state.cards.filter((c) => c.id !== mutation.id)
      if (card) {
        affectedCard = card
        deletedAtMs = nextTimestamp()
      }
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
  broadcastChanged(state)
  if (affectedCard && !isApplyingRemote()) {
    await enqueueCard(affectedCard, deletedAtMs)
  }
  return state
}

/** Applies a remote card row as-is (used by the sync engine's LWW merge; never enqueues). */
export async function applyRemoteCard(card: KanbanCard): Promise<void> {
  const state = await load()
  ensureBoard(state, card.projectKey)
  const index = state.cards.findIndex((c) => c.id === card.id)
  if (index === -1) state.cards.push(card)
  else state.cards[index] = card
  await persist()
  broadcastChanged(state)
}

/** Hard-deletes a card by id (used by the sync engine when applying a remote tombstone). */
export async function deleteCardById(id: string): Promise<void> {
  const state = await load()
  state.cards = state.cards.filter((c) => c.id !== id)
  await persist()
  broadcastChanged(state)
}
