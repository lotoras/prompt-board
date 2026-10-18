import type { StateCreator } from 'zustand'
import { sessionNeedsAttention, type ProjectView, type SessionsSnapshot } from '../../../shared/types'
import { api } from '../lib/api'
import type { StoreState } from './index'

export interface SessionsSlice {
  snapshot: SessionsSnapshot
  sessionsError: string | null
  setSnapshot: (snapshot: SessionsSnapshot) => void
  setSessionsError: (error: string | null) => void
  acknowledgeSession: (sessionId: string, statusUpdatedAt: number) => Promise<void>
  unacknowledgeSession: (sessionId: string) => Promise<void>
  projectViews: () => ProjectView[]
  projectView: (projectKey: string) => ProjectView | undefined
  projectHasWaiting: (projectKey: string) => boolean
}

function patchAcknowledged(
  snapshot: SessionsSnapshot,
  sessionId: string,
  acknowledged: boolean
): SessionsSnapshot {
  return {
    ...snapshot,
    projects: snapshot.projects.map((p) => {
      if (!p.sessions.some((s) => s.sessionId === sessionId)) return p
      const sessions = p.sessions.map((s) => (s.sessionId === sessionId ? { ...s, acknowledged } : s))
      return { ...p, sessions, needsAttention: sessions.some(sessionNeedsAttention) }
    })
  }
}

// Ack actions patch optimistically; main always re-emits the snapshot afterwards
// (even on failure), which corrects any optimistic state.
export const createSessionsSlice: StateCreator<StoreState, [], [], SessionsSlice> = (set, get) => ({
  snapshot: { projects: [] },
  sessionsError: null,
  setSnapshot: (snapshot) => set({ snapshot, sessionsError: null }),
  setSessionsError: (error) => set({ sessionsError: error }),
  acknowledgeSession: async (sessionId, statusUpdatedAt) => {
    set((state) => ({ snapshot: patchAcknowledged(state.snapshot, sessionId, true) }))
    try {
      await api.sessions.acknowledge(sessionId, statusUpdatedAt)
    } catch (error) {
      console.error(error)
    }
  },
  unacknowledgeSession: async (sessionId) => {
    set((state) => ({ snapshot: patchAcknowledged(state.snapshot, sessionId, false) }))
    try {
      await api.sessions.unacknowledge(sessionId)
    } catch (error) {
      console.error(error)
    }
  },
  projectViews: () => get().snapshot.projects,
  projectView: (projectKey) => get().snapshot.projects.find((p) => p.projectKey === projectKey),
  projectHasWaiting: (projectKey) => get().projectView(projectKey)?.needsAttention ?? false
})
