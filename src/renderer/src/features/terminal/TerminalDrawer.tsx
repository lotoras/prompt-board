import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../lib/api'
import { withoutKey } from '../../lib/objects'
import { useStore } from '../../store'
import { BOARD_TAB } from '../../store/chatsSlice'
import { TerminalErrorBoundary } from './TerminalErrorBoundary'
import { XtermView } from './XtermView'
import './terminal.css'

interface ShellTarget {
  key: string
  projectKey: string
  cwd: string
}

export function TerminalDrawer(): React.JSX.Element {
  const open = useStore((s) => s.drawerOpen)
  const tab = useStore((s) => s.drawerTab)
  const setTab = useStore((s) => s.setDrawerTab)
  const toggleDrawer = useStore((s) => s.toggleDrawer)
  const view = useStore((s) => s.view)
  const projects = useStore((s) => s.projects)
  const chats = useStore((s) => s.chats)
  const activeByProject = useStore((s) => s.activeByProject)
  const tuiPtyByChat = useStore((s) => s.tuiPtyByChat)
  const openInTui = useStore((s) => s.openInTui)

  const [shellPty, setShellPty] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const projectKey = view.kind === 'project' ? view.projectKey : undefined
  const activeTab = projectKey ? activeByProject[projectKey] : undefined
  const chat = useMemo(
    () =>
      activeTab && activeTab !== BOARD_TAB ? chats.find((c) => c.chatId === activeTab) : undefined,
    [activeTab, chats]
  )
  const basePath = projects.find((p) => p.projectKey === projectKey)?.basePath

  const target: ShellTarget | undefined = useMemo(() => {
    if (!projectKey) return undefined
    if (chat) return { key: chat.chatId, projectKey, cwd: chat.cwd }
    if (basePath) return { key: `board:${projectKey}`, projectKey, cwd: basePath }
    return undefined
  }, [projectKey, chat, basePath])

  const targetKey = target?.key
  const targetCwd = target?.cwd
  const needsShell = open && tab === 'shell' && targetKey !== undefined && !shellPty[targetKey]

  useEffect(() => {
    if (!needsShell || !target) return
    let cancelled = false
    api.pty
      .spawn({ projectKey: target.projectKey, cwd: target.cwd, mode: 'shell' })
      .then(({ ptyId }) => {
        if (cancelled) {
          void api.pty.kill(ptyId)
          return
        }
        setError(null)
        setShellPty((prev) => ({ ...prev, [target.key]: ptyId }))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error)?.message ?? 'Failed to open a terminal')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsShell, targetKey, targetCwd])

  useEffect(
    () =>
      api.pty.onExit(({ ptyId }) => {
        setShellPty((prev) => {
          const entry = Object.entries(prev).find(([, id]) => id === ptyId)
          if (!entry) return prev
          return withoutKey(prev, entry[0])
        })
      }),
    []
  )

  const tuiPty = chat ? tuiPtyByChat[chat.chatId] : undefined
  const activeShell = targetKey ? shellPty[targetKey] : undefined

  // A chat already running in the TUI (e.g. after a renderer reload) re-attaches to its terminal;
  // openInTui is idempotent in main and returns the running pty.
  const chatId = chat?.chatId
  const reattach = open && tab === 'tui' && chat?.mode === 'tui' && !tuiPty
  useEffect(() => {
    if (reattach && chatId) void openInTui(chatId).catch((e) => console.error(e))
  }, [reattach, chatId, openInTui])

  return (
    <section className={`drawer${open ? ' open' : ''}`} aria-label="Terminal">
      <div className="drawer-tabs">
        <button
          type="button"
          className={`dt${tab === 'shell' ? ' on' : ''}`}
          onClick={() => setTab('shell')}
        >
          Shell
        </button>
        <button
          type="button"
          className={`dt${tab === 'tui' ? ' on' : ''}`}
          onClick={() => setTab('tui')}
        >
          Claude TUI
        </button>
        <span className="grow" />
        <button
          type="button"
          className="ctl icon"
          aria-label="Close terminal"
          onClick={() => toggleDrawer(false)}
        >
          <X className="i sm" strokeWidth={1.8} />
        </button>
      </div>
      <div className="drawer-body">
        <TerminalErrorBoundary>
          {Object.entries(shellPty).map(([key, ptyId]) => (
            <XtermView
              key={ptyId}
              ptyId={ptyId}
              visible={open && tab === 'shell' && key === targetKey}
            />
          ))}
          {Object.values(tuiPtyByChat).map((ptyId) => (
            <XtermView
              key={ptyId}
              ptyId={ptyId}
              visible={open && tab === 'tui' && ptyId === tuiPty}
            />
          ))}
        </TerminalErrorBoundary>
        {tab === 'shell' && !activeShell && (
          <div className="drawer-note">
            {error ??
              (target
                ? 'Starting a shell...'
                : 'Select a project to open a shell in its folder.')}
          </div>
        )}
        {tab === 'tui' && !tuiPty && (
          <div className="drawer-note">
            {chat ? (
              <>
                <b>Open in TUI</b> stops the chat here and continues the same session in the Claude Code
                terminal: <span className="mono">clauded --resume {chat.sessionId}</span>
                <br />
                Use it for things the chat view cannot do yet, like /config or /mcp. The chat picks up
                again here when you exit the terminal.
                <br />
                {chat.mode !== 'external' && (
                  <button
                    type="button"
                    className="btn outline"
                    style={{ marginTop: 10 }}
                    onClick={() => void openInTui(chat.chatId).catch((e) => console.error(e))}
                  >
                    Open in TUI
                  </button>
                )}
              </>
            ) : (
              'Open a chat to continue it in the Claude Code terminal.'
            )}
          </div>
        )}
      </div>
    </section>
  )
}
