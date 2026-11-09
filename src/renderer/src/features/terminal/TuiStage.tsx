import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { ChatMeta } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { BOARD_TAB } from '../../store/chatsSlice'
import { TerminalErrorBoundary } from './TerminalErrorBoundary'
import { XtermView } from './XtermView'
import './terminal.css'

function TuiHead({ chat }: { chat: ChatMeta }): React.JSX.Element {
  const backToChat = useStore((s) => s.backToChat)
  const [confirming, setConfirming] = useState(false)
  const leave = (): void => void backToChat(chat.chatId).catch((e) => console.error(e))

  return (
    <div className="chat-head">
      <span className="chat-title">{chat.title}</span>
      <span className="head-spacer" />
      {confirming ? (
        <>
          <span className="head-meta">Claude is working. Stop and go back?</span>
          <button type="button" className="btn quiet" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={leave}>
            Stop and go back
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ghost-btn"
          title="End the terminal and continue this conversation in the chat"
          onClick={() => (chat.status === 'busy' ? setConfirming(true) : leave())}
        >
          <ArrowLeft className="i sm" strokeWidth={1.8} />
          <span>Back to chat</span>
        </button>
      )}
    </div>
  )
}

/** Shows the Claude terminal in place of the chat. All terminals stay mounted to keep their scrollback. */
export function TuiStage(): React.JSX.Element {
  const chat = useStore((s) => {
    if (s.view.kind !== 'project') return undefined
    const tab = s.activeByProject[s.view.projectKey]
    return tab && tab !== BOARD_TAB ? s.chats.find((c) => c.chatId === tab) : undefined
  })
  const tuiPtyByChat = useStore((s) => s.tuiPtyByChat)
  const openInTui = useStore((s) => s.openInTui)
  const dropTuiPty = useStore((s) => s.dropTuiPty)

  const active = chat?.mode === 'tui' ? chat : undefined
  const chatId = active?.chatId
  const activePty = chatId ? tuiPtyByChat[chatId] : undefined

  useEffect(() => api.pty.onExit(({ ptyId }) => dropTuiPty(ptyId)), [dropTuiPty])

  // After a renderer reload main still runs the terminal: attach again. Never for a chat that
  // already had its terminal here, because that terminal has ended and this would start a new one.
  const attached = useRef(new Set<string>())
  useEffect(() => {
    if (!chatId) return
    if (activePty) attached.current.add(chatId)
    else if (!attached.current.has(chatId)) void openInTui(chatId).catch((e) => console.error(e))
  }, [chatId, activePty, openInTui])

  return (
    <section className={`tui-stage${active ? ' on' : ''}`} aria-label="Claude terminal">
      {active && <TuiHead key={active.chatId} chat={active} />}
      <div className="tui-body">
        <TerminalErrorBoundary>
          {Object.values(tuiPtyByChat).map((ptyId) => (
            <XtermView key={ptyId} ptyId={ptyId} visible={ptyId === activePty} />
          ))}
        </TerminalErrorBoundary>
      </div>
    </section>
  )
}
