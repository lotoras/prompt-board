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
    return unsubscribe
  }, [])
}
