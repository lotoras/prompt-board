import { useEffect } from 'react'
import { api } from './api'
import { useStore } from '../store'
import { BOARD_TAB } from '../store/chatsSlice'
import { createAttentionChime } from '../features/sessions/attentionChime'
import { playCoinBlip } from './retroSound'

/**
 * One-time bootstrap: loads initial state and subscribes to the main-process events
 * (`sessions:changed`, `chat:changed`, `chat:items`, ...). Call once near the app root.
 */
export function useIpcBootstrap(): void {
  useEffect(() => {
    const store = useStore.getState()

    let pushed = false
    api.sessions
      .list()
      .then((snapshot) => {
        if (!pushed) store.setSnapshot(snapshot)
      })
      .catch((error) => {
        console.error(error)
        useStore.getState().setSessionsError("Couldn't load sessions — retrying…")
      })
    void store.loadProjects()
    void store.loadBoards()
    api.sync.getStatus().then(store.setSyncStatus)
    api.rate
      .get()
      .then((limits) => useStore.getState().setRateLimits(limits))
      .catch((error) => console.error(error))

    let chatsPushed = false
    api.chat
      .list()
      .then(({ chats, activeByProject }) => {
        if (chatsPushed) {
          useStore.getState().setActiveByProject({ ...activeByProject, ...useStore.getState().activeByProject })
          return
        }
        useStore.getState().setChats(chats)
        useStore.getState().setActiveByProject(activeByProject)
      })
      .catch((error) => console.error(error))

    const unsubscribe = api.sessions.onChanged((snapshot) => {
      pushed = true
      store.setSnapshot(snapshot)
    })
    const unsubProjects = api.projects.onChanged(store.setProjects)
    const unsubBoards = api.kanban.onChanged(store.setBoards)
    const unsubSyncStatus = api.sync.onStatus(store.setSyncStatus)
    const unsubChats = api.chat.onChanged((chats) => {
      chatsPushed = true
      useStore.getState().setChats(chats)
    })
    const unsubRate = api.rate.onChanged((limits) => useStore.getState().setRateLimits(limits))
    const unsubItems = api.chat.onItems((event) => useStore.getState().applyItems(event))

    const applyInset = (px: number): void =>
      document.documentElement.style.setProperty('--app-bottom-inset', `${px}px`)
    api.window.getInset().then(applyInset)
    const unsubInset = api.window.onInsetChanged(applyInset)

    const onSnapshot = createAttentionChime({
      play: playCoinBlip,
      isEnabled: () => useStore.getState().soundEnabled
    })
    const unsubChime = useStore.subscribe((s, p) => {
      if (s.snapshot !== p.snapshot) onSnapshot(p.snapshot, s.snapshot)
    })

    const historyRequested = new Set<string>()
    const ensureHistory = (): void => {
      const s = useStore.getState()
      if (s.view.kind !== 'project') return
      const tab = s.activeTabFor(s.view.projectKey)
      if (tab === BOARD_TAB || historyRequested.has(tab)) return
      const chat = s.chats.find((c) => c.chatId === tab)
      if (!chat || !chat.started) return
      historyRequested.add(tab)
      s.loadHistory(tab).catch((error) => {
        historyRequested.delete(tab)
        console.error(error)
      })
    }
    const unsubHistory = useStore.subscribe(ensureHistory)
    ensureHistory()

    return () => {
      unsubHistory()
      unsubChime()
      unsubscribe()
      unsubProjects()
      unsubBoards()
      unsubSyncStatus()
      unsubChats()
      unsubItems()
      unsubRate()
      unsubInset()
    }
  }, [])
}
