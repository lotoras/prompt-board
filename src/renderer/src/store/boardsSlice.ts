import type { StateCreator } from 'zustand'
import { DONE_COLUMN_ID } from '../../../shared/types'
import type { KanbanCard, KanbanMutation, KanbanState } from '../../../shared/types'
import { api } from '../lib/api'
import { todayLocalISO } from '../lib/format'
import type { StoreState } from './index'

export interface BoardsSlice {
  boards: KanbanState
  setBoards: (boards: KanbanState) => void
  loadBoards: () => Promise<void>
  cardsFor: (projectKey: string) => KanbanCard[]
  dueCards: () => KanbanCard[]
  mutateBoard: (mutation: KanbanMutation) => Promise<void>
}

export const createBoardsSlice: StateCreator<StoreState, [], [], BoardsSlice> = (set, get) => ({
  boards: { boards: [], cards: [] },
  setBoards: (boards) => set({ boards }),
  loadBoards: async () => {
    const boards = await api.kanban.getBoards()
    set({ boards })
  },
  cardsFor: (projectKey) => get().boards.cards.filter((c) => c.projectKey === projectKey),
  dueCards: () => {
    const today = todayLocalISO()
    return get()
      .boards.cards.filter((c) => !!c.dueDate && c.columnId !== DONE_COLUMN_ID && c.dueDate <= today)
      .sort((a, b) =>
        a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : a.order < b.order ? -1 : 1
      )
  },
  mutateBoard: async (mutation) => {
    const previous = get().boards
    try {
      const boards = await api.kanban.mutate(mutation)
      set({ boards })
    } catch (err) {
      set({ boards: previous })
      throw err
    }
  }
})
