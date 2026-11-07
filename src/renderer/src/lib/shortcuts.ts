import { useEffect } from 'react'
import { startNewChat } from '../features/chat/newChat'
import { BOARD_TAB } from '../store/chatsSlice'
import { useStore } from '../store'
import { api } from './api'

function onKeyDown(e: KeyboardEvent): void {
  const s = useStore.getState()

  if (e.key === 'Escape') {
    if (s.popover) return s.setPopover(null)
    if (s.editingCardId) return s.setEditingCardId(null)
    if (s.projectModal) return s.setProjectModal(null)
    if (s.syncModalOpen) return s.setSyncModalOpen(false)
    if (s.sideOpen) return s.setSideOpen(false)
    if (s.view.kind !== 'project') return
    const tab = s.activeTabFor(s.view.projectKey)
    const chat = tab === BOARD_TAB ? undefined : s.chats.find((c) => c.chatId === tab)
    if (chat && chat.mode === 'sdk' && chat.status === 'busy' && !(s.drafts[chat.chatId]?.text ?? '').trim()) {
      void Promise.resolve(api.chat.interrupt(chat.chatId)).catch((err) => console.error(err))
    }
    return
  }

  if (!e.ctrlKey || e.altKey || e.metaKey) return
  const key = e.key.toLowerCase()

  if (key === 'n' && !e.shiftKey) {
    e.preventDefault()
    startNewChat()
    return
  }

  if (e.key === '`') {
    e.preventDefault()
    s.toggleDrawer()
    return
  }

  if (e.shiftKey && (key === 'm' || key === 'e')) {
    if (s.view.kind !== 'project') return
    const tab = s.activeTabFor(s.view.projectKey)
    const chat = s.chats.find((c) => c.chatId === tab)
    if (!chat || chat.mode === 'external') return
    e.preventDefault()
    const kind = key === 'm' ? 'model' : 'effort'
    s.setPopover(s.popover === kind ? null : kind)
    return
  }

  if (/^[1-9]$/.test(e.key) && !e.shiftKey && s.view.kind === 'project') {
    const ids = [BOARD_TAB, ...s.chatsFor(s.view.projectKey).map((c) => c.chatId)]
    const id = ids[Number(e.key) - 1]
    if (id) {
      e.preventDefault()
      s.setActiveTab(s.view.projectKey, id)
    }
  }
}

export function useShortcuts(): void {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
