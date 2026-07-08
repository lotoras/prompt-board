import { useEffect } from 'react'
import { api } from './api'
import { useStore } from '../store'

/**
 * One-time bootstrap: loads initial state and subscribes to `sessions:changed`.
 * Call once near the app root.
 */
export function useIpcBootstrap(): void {
  useEffect(() => {
    const setSnapshot = useStore.getState().setSnapshot
    const loadProjects = useStore.getState().loadProjects
    const loadBoards = useStore.getState().loadBoards
    const setProjects = useStore.getState().setProjects
    const setBoards = useStore.getState().setBoards
    const setSyncStatus = useStore.getState().setSyncStatus

    api.sessions.list().then(setSnapshot)
    loadProjects()
    loadBoards()
    api.sync.getStatus().then(setSyncStatus)

    const unsubscribe = api.sessions.onChanged(setSnapshot)
    const unsubProjects = api.projects.onChanged(setProjects)
    const unsubBoards = api.kanban.onChanged(setBoards)
    const unsubSyncStatus = api.sync.onStatus(setSyncStatus)

    if (!api.caps.pty) {
      return () => {
        unsubscribe()
        unsubProjects()
        unsubBoards()
        unsubSyncStatus()
      }
    }

    const unsubExit = api.pty.onExit(({ ptyId }) => {
      useStore.getState().markExited(ptyId)
    })
    const unsubSession = api.pty.onSession(({ ptyId, sessionId }) => {
      const state = useStore.getState()
      state.setSession(ptyId, sessionId)

      const cardId = state.takePendingCardLink(ptyId)
      if (!cardId) return

      const terminal = state.terminals[ptyId]
      const project = state.projects.find((p) => p.projectKey === terminal?.projectKey)
      const cwd = project?.basePath ?? ''
      state.mutateBoard({ type: 'updateCard', id: cardId, patch: { link: { sessionId, cwd } } })
    })

    return () => {
      unsubscribe()
      unsubProjects()
      unsubBoards()
      unsubSyncStatus()
      unsubExit()
      unsubSession()
    }
  }, [])
}
