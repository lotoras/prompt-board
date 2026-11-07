import { useEffect, useMemo, useRef, useState } from 'react'
import { History, Menu, Monitor, Plus, SquareKanban, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { modelLabel } from '../../../../shared/chat'
import { DONE_COLUMN_ID, statusTone } from '../../../../shared/types'
import type { ChatMeta, PastSession } from '../../../../shared/types'
import { api } from '../../lib/api'
import { formatRelativeTime } from '../../lib/format'
import { BOARD_TAB } from '../../store/chatsSlice'
import { useStore } from '../../store'
import { Popover } from './popovers/Popover'

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

interface TabMenuState {
  chatId: string
  x: number
  y: number
}

function TabMenu({ menu, onClose }: { menu: TabMenuState; onClose: () => void }): React.JSX.Element | null {
  const chat = useStore((s) => s.chats.find((c) => c.chatId === menu.chatId))
  const closeChat = useStore((s) => s.closeChat)
  const openInTui = useStore((s) => s.openInTui)
  const clearChat = useStore((s) => s.clearChat)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!chat) return null
  const run = (action: () => unknown): void => {
    onClose()
    try {
      void Promise.resolve(action()).catch((e) => console.error(e))
    } catch (e) {
      console.error(e)
    }
  }
  const external = chat.mode === 'external'

  return (
    <div ref={ref} className="pop tab-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      {!external && (
        <>
          <button
            type="button"
            role="menuitem"
            className="pop-item"
            onClick={() => run(() => api.chat.restart(chat.chatId, 'resume'))}
          >
            Reload session
          </button>
          <button
            type="button"
            role="menuitem"
            className="pop-item"
            onClick={() =>
              run(async () => {
                await api.chat.restart(chat.chatId, 'fresh')
                clearChat(chat.chatId)
              })
            }
          >
            Start fresh in this tab
          </button>
          <button
            type="button"
            role="menuitem"
            className="pop-item"
            onClick={() => run(() => openInTui(chat.chatId))}
          >
            Open in TUI
          </button>
        </>
      )}
      <button type="button" role="menuitem" className="pop-item" onClick={() => run(() => closeChat(chat.chatId))}>
        Close tab
      </button>
    </div>
  )
}

function ResumePicker({ projectKey }: { projectKey: string }): React.JSX.Element {
  const createChat = useStore((s) => s.createChat)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [sessions, setSessions] = useState<PastSession[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.chat
      .listSessions(projectKey)
      .then((list) => {
        if (!cancelled) setSessions(list)
      })
      .catch((e) => {
        console.error(e)
        if (!cancelled) setSessions([])
      })
    return () => {
      cancelled = true
    }
  }, [open, projectKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!sessions) return []
    return q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q) || s.firstPrompt.toLowerCase().includes(q))
      : sessions
  }, [sessions, query])

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="tab-add"
        title="Resume a session"
        aria-label="Resume a session"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <History className="i" strokeWidth={1.8} />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={close}>
          <div className="resume-pop">
            <input
              autoFocus
              placeholder="Search sessions"
              aria-label="Search sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="resume-list">
              {sessions && sessions.length === 0 && (
                <div className="resume-empty">No past sessions for this project yet.</div>
              )}
              {filtered.map((s) => (
                <button
                  key={s.sessionId}
                  type="button"
                  role="menuitem"
                  className="pop-item"
                  onClick={() => {
                    close()
                    void createChat({ projectKey, resumeSessionId: s.sessionId, title: s.title })
                  }}
                >
                  <span className="pi-main">
                    <div className="pi-title">
                      <span>{s.title}</span>
                      {s.worktreeRel && <span className="badge-sm">worktree</span>}
                      {s.openChatId && <span className="badge-sm">open</span>}
                    </div>
                    <div className="pi-desc">{s.firstPrompt}</div>
                    <div className="pi-meta">
                      {formatRelativeTime(s.lastActivity)}
                      {s.model ? ` · ${modelLabel(s.model)}` : ''}
                    </div>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  )
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
  const [menu, setMenu] = useState<TabMenuState | null>(null)

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
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ chatId: chat.chatId, x: e.clientX, y: e.clientY })
              }}
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
      <ResumePicker projectKey={projectKey} />
      {menu && <TabMenu menu={menu} onClose={() => setMenu(null)} />}
    </nav>
  )
}
