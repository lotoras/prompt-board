import { Menu, Monitor, Plus, SquareKanban, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { modelLabel } from '../../../../shared/chat'
import { DONE_COLUMN_ID, statusTone } from '../../../../shared/types'
import type { ChatMeta } from '../../../../shared/types'
import { BOARD_TAB } from '../../store/chatsSlice'
import { useStore } from '../../store'

const STATUS_LABEL: Record<string, string> = {
  busy: 'Working',
  waiting: 'Needs you',
  attention: 'Needs you',
  idle: 'Idle'
}

function dotTitle(tone: string): string {
  if (tone === 'attention') return 'Mark as seen'
  if (tone === 'idle') return 'Mark as unseen'
  return STATUS_LABEL[tone] ?? tone
}

export function MenuButton(): React.JSX.Element {
  const setSideOpen = useStore((s) => s.setSideOpen)
  return (
    <button type="button" className="menu-btn" aria-label="Open sidebar" onClick={() => setSideOpen(true)}>
      <Menu className="i" strokeWidth={1.8} />
    </button>
  )
}

function tabTitle(chat: ChatMeta): string {
  const where = `${chat.worktreePath ? `${chat.worktreePath} on ` : ''}${chat.branch ?? ''}`
  const ctxWindow = chat.contextWindow
  const pct =
    chat.contextTokens && ctxWindow ? Math.round((chat.contextTokens / ctxWindow) * 100) : undefined
  return [
    chat.title,
    `${modelLabel(chat.model)}, ${chat.effort} effort${pct !== undefined ? `, ${pct}% context` : ''}`,
    where
  ]
    .filter(Boolean)
    .join('\n')
}

export function ChatTabs({ projectKey }: { projectKey: string }): React.JSX.Element {
  const chats = useStore(useShallow((s) => s.chatsFor(projectKey)))
  const active = useStore((s) => s.activeTabFor(projectKey))
  const openCards = useStore(
    (s) => s.boards.cards.filter((c) => c.projectKey === projectKey && c.columnId !== DONE_COLUMN_ID).length
  )
  const setActiveTab = useStore((s) => s.setActiveTab)
  const closeChat = useStore((s) => s.closeChat)
  const createChat = useStore((s) => s.createChat)
  const toggleChatAck = useStore((s) => s.toggleChatAck)

  return (
    <nav className="tabs" aria-label="Chats">
      <MenuButton />
      <div className="tabs-scroll">
        <button
          type="button"
          className={`tab board${active === BOARD_TAB ? ' on' : ''}`}
          onClick={() => setActiveTab(projectKey, BOARD_TAB)}
        >
          <SquareKanban className="i" strokeWidth={1.8} />
          <span>Board</span>
          <span className="badge num">{openCards}</span>
        </button>
        {chats.map((chat) => {
          const tone = statusTone(chat)
          return (
            <div
              key={chat.chatId}
              className={`tab${active === chat.chatId ? ' on' : ''}`}
              role="button"
              tabIndex={0}
              title={tabTitle(chat)}
              onClick={() => setActiveTab(projectKey, chat.chatId)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  setActiveTab(projectKey, chat.chatId)
                }
              }}
            >
              <button
                type="button"
                className="dot-btn"
                title={dotTitle(tone)}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleChatAck(chat.chatId)
                }}
              >
                <span className={`dot ${tone}`} />
              </button>
              <span className="tab-title">{chat.title}</span>
              {chat.mode === 'external' && (
                <span className="ext" title="Running in another terminal">
                  <Monitor className="i sm" strokeWidth={1.8} />
                </span>
              )}
              <button
                type="button"
                className="x"
                aria-label="Close chat"
                onClick={(e) => {
                  e.stopPropagation()
                  void closeChat(chat.chatId)
                }}
              >
                <X className="i sm" strokeWidth={1.8} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="tab-add"
        title="New chat (Ctrl+N)"
        aria-label="New chat"
        onClick={() => void createChat({ projectKey })}
      >
        <Plus className="i" strokeWidth={1.8} />
      </button>
    </nav>
  )
}
