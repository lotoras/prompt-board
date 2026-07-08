import type { StateCreator } from 'zustand'
import type { ProjectView, SessionsSnapshot } from '../../../shared/types'
import type { StoreState } from './index'

export interface SessionsSlice {
  snapshot: SessionsSnapshot
  setSnapshot: (snapshot: SessionsSnapshot) => void
  projectViews: () => ProjectView[]
  projectView: (projectKey: string) => ProjectView | undefined
  projectHasWaiting: (projectKey: string) => boolean
}

export const createSessionsSlice: StateCreator<StoreState, [], [], SessionsSlice> = (set, get) => ({
  snapshot: { projects: [] },
  setSnapshot: (snapshot) => set({ snapshot }),
  projectViews: () => get().snapshot.projects,
  projectView: (projectKey) => get().snapshot.projects.find((p) => p.projectKey === projectKey),
  projectHasWaiting: (projectKey) => get().projectView(projectKey)?.needsAttention ?? false
})
