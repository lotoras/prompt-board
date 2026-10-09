import { useEffect } from 'react'
import { api } from './api'
import { useStore } from '../store'
import { buildPersistedSnapshot } from '../features/terminal/persistedSnapshot'
import { reloadTerminal } from '../features/terminal/reloadTerminal'

// Restore runs exactly once per app launch, even if the bootstrap effect
// re-mounts (React StrictMode double-invokes effects in dev).
let restoreStarted = false
let restoreDone = false

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

    api.sessions.list().then(setSnapshot).catch((error) => {
      console.error(error)
      useStore.getState().setSessionsError("Couldn't load sessions — retrying…")
    })
    const loadProjectsPromise = loadProjects()
    loadBoards()
    api.sync.getStatus().then(setSyncStatus)

    const unsubscribe = api.sessions.onChanged(setSnapshot)
    const unsubProjects = api.projects.onChanged(setProjects)
    const unsubBoards = api.kanban.onChanged(setBoards)
    const unsubSyncStatus = api.sync.onStatus(setSyncStatus)

    const applyInset = (px: number): void =>
      document.documentElement.style.setProperty('--app-bottom-inset', `${px}px`)
    api.window.getInset().then(applyInset)
    const unsubInset = api.window.onInsetChanged(applyInset)

    if (!api.caps.pty) {
      return () => {
        unsubscribe()
        unsubProjects()
        unsubBoards()
        unsubSyncStatus()
        unsubInset()
      }
    }

    const unsubExit = api.pty.onExit(({ ptyId, resumeFailed }) => {
      useStore.getState().markExited(ptyId)
      const terminal = useStore.getState().terminals[ptyId]
      if (!resumeFailed || !terminal) return
      void reloadTerminal(
        terminal,
        'fresh',
        {
          addTerminal: useStore.getState().addTerminal,
          closeTerminal: useStore.getState().closeTerminal
        },
        { freshFallback: true }
      ).catch((error) => console.error(error))
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

    void api.pty
      .getBindings()
      .then((list) => list.forEach((b) => useStore.getState().setSession(b.ptyId, b.sessionId)))
      .catch(() => {})

    if (!restoreStarted) {
      restoreStarted = true
      void loadProjectsPromise
        .then(async () => {
          const { terminals: saved, activeSessionByProject } = await api.pty.loadPersisted()
          const newPtyIdBySessionId: Record<string, string> = {}
          for (const { projectKey, sessionId, title } of saved) {
            try {
              const { ptyId, resumed } = await api.pty.spawn({ projectKey, resumeSessionId: sessionId })
              useStore.getState().addTerminal({
                ptyId,
                projectKey,
                title,
                status: 'running',
                sessionId: resumed ? sessionId : undefined
              })
              newPtyIdBySessionId[sessionId] = ptyId
            } catch {
              // project gone / resume failed — skip this terminal
            }
          }
          for (const [projectKey, sessionId] of Object.entries(activeSessionByProject)) {
            const ptyId = newPtyIdBySessionId[sessionId]
            if (ptyId) useStore.getState().setActiveTab(projectKey, ptyId)
          }
        })
        .catch((error) => console.error(error))
        .finally(() => {
          restoreDone = true
        })
    }

    const unsubPersist = useStore.subscribe((state, prev) => {
      if (!restoreDone) return
      if (state.terminals === prev.terminals && state.activeTabByProject === prev.activeTabByProject) {
        return
      }
      api.pty.savePersisted(buildPersistedSnapshot(state.terminals, state.activeTabByProject))
    })

    return () => {
      unsubscribe()
      unsubProjects()
      unsubBoards()
      unsubSyncStatus()
      unsubInset()
      unsubExit()
      unsubSession()
      unsubPersist()
    }
  }, [])
}
