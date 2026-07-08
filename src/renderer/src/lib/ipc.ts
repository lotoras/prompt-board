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

    api.sessions.list().then(setSnapshot)
    loadProjects()
    loadBoards()

    const unsubscribe = api.sessions.onChanged(setSnapshot)

    if (!api.caps.pty) return unsubscribe

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
      unsubExit()
      unsubSession()
    }
  }, [])
}
