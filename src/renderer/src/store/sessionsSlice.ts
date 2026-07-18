import type { StateCreator } from 'zustand'
import type { ProjectView, SessionsSnapshot } from '../../../shared/types'
import type { StoreState } from './index'

export interface SessionsSlice {
  snapshot: SessionsSnapshot
  sessionsError: string | null
  setSnapshot: (snapshot: SessionsSnapshot) => void
  setSessionsError: (error: string | null) => void
  projectViews: () => ProjectView[]
  projectView: (projectKey: string) => ProjectView | undefined
  projectHasWaiting: (projectKey: string) => boolean
}

export const createSessionsSlice: StateCreator<StoreState, [], [], SessionsSlice> = (set, get) => ({
  snapshot: { projects: [] },
  sessionsError: null,
  setSnapshot: (snapshot) => set({ snapshot, sessionsError: null }),
  setSessionsError: (error) => set({ sessionsError: error }),
  projectViews: () => get().snapshot.projects,
  projectView: (projectKey) => get().snapshot.projects.find((p) => p.projectKey === projectKey),
  projectHasWaiting: (projectKey) => get().projectView(projectKey)?.needsAttention ?? false
})
