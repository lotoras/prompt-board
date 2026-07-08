import type { StateCreator } from 'zustand'
import type { KanbanCard, KanbanMutation, KanbanState } from '../../../shared/types'
import { api } from '../lib/api'
import type { StoreState } from './index'

export interface BoardsSlice {
  boards: KanbanState
  loadBoards: () => Promise<void>
  cardsFor: (projectKey: string) => KanbanCard[]
  mutateBoard: (mutation: KanbanMutation) => Promise<void>
}

export const createBoardsSlice: StateCreator<StoreState, [], [], BoardsSlice> = (set, get) => ({
  boards: { boards: [], cards: [] },
  loadBoards: async () => {
    const boards = await api.kanban.getBoards()
    set({ boards })
  },
  cardsFor: (projectKey) => get().boards.cards.filter((c) => c.projectKey === projectKey),
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
