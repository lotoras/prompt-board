import type { StateCreator } from 'zustand'
import type { StoreState } from './index'

export type TerminalStatus = 'running' | 'exited'

export interface TerminalMeta {
  ptyId: string
  projectKey: string
  title: string
  status: TerminalStatus
  sessionId?: string
}

export interface TerminalsSlice {
  terminals: Record<string, TerminalMeta>
  activeTabByProject: Record<string, string>
  pendingCardLinks: Record<string, string>
  addTerminal: (meta: TerminalMeta) => void
  markExited: (ptyId: string) => void
  setSession: (ptyId: string, sessionId: string) => void
  closeTerminal: (ptyId: string) => void
  setActiveTab: (projectKey: string, ptyId: string) => void
  terminalsFor: (projectKey: string) => TerminalMeta[]
  setPendingCardLink: (ptyId: string, cardId: string) => void
  takePendingCardLink: (ptyId: string) => string | undefined
}

export const createTerminalsSlice: StateCreator<StoreState, [], [], TerminalsSlice> = (
  set,
  get
) => ({
  terminals: {},
  activeTabByProject: {},
  pendingCardLinks: {},
  addTerminal: (meta) =>
    set((state) => ({
      terminals: { ...state.terminals, [meta.ptyId]: meta },
      activeTabByProject: { ...state.activeTabByProject, [meta.projectKey]: meta.ptyId }
    })),
  markExited: (ptyId) =>
    set((state) => {
      const existing = state.terminals[ptyId]
      if (!existing) return state
      return {
        terminals: { ...state.terminals, [ptyId]: { ...existing, status: 'exited' } }
      }
    }),
  setSession: (ptyId, sessionId) =>
    set((state) => {
      const existing = state.terminals[ptyId]
      if (!existing) return state
      return {
        terminals: { ...state.terminals, [ptyId]: { ...existing, sessionId } }
      }
    }),
  closeTerminal: (ptyId) =>
    set((state) => {
      const { [ptyId]: _removed, ...rest } = state.terminals
      const projectKey = state.terminals[ptyId]?.projectKey
      const activeTabByProject = { ...state.activeTabByProject }
      if (projectKey && activeTabByProject[projectKey] === ptyId) {
        const remaining = Object.values(rest).filter((t) => t.projectKey === projectKey)
        if (remaining.length > 0) {
          activeTabByProject[projectKey] = remaining[remaining.length - 1].ptyId
        } else {
          delete activeTabByProject[projectKey]
        }
      }
      return { terminals: rest, activeTabByProject }
    }),
  setActiveTab: (projectKey, ptyId) =>
    set((state) => ({
      activeTabByProject: { ...state.activeTabByProject, [projectKey]: ptyId }
    })),
  terminalsFor: (projectKey) =>
    Object.values(get().terminals).filter((t) => t.projectKey === projectKey),
  setPendingCardLink: (ptyId, cardId) =>
    set((state) => ({ pendingCardLinks: { ...state.pendingCardLinks, [ptyId]: cardId } })),
  takePendingCardLink: (ptyId) => {
    const cardId = get().pendingCardLinks[ptyId]
    if (cardId === undefined) return undefined
    set((state) => {
      const { [ptyId]: _removed, ...rest } = state.pendingCardLinks
      return { pendingCardLinks: rest }
    })
    return cardId
  }
})
