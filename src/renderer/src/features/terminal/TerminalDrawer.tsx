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
  const toggleDrawer = useStore((s) => s.toggleDrawer)
  const view = useStore((s) => s.view)
  const projects = useStore((s) => s.projects)
  const chats = useStore((s) => s.chats)
  const activeByProject = useStore((s) => s.activeByProject)

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
  const needsShell = open && targetKey !== undefined && !shellPty[targetKey]

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

  const activeShell = targetKey ? shellPty[targetKey] : undefined

  return (
    <section className={`drawer${open ? ' open' : ''}`} aria-label="Terminal">
      <div className="drawer-tabs">
        <span className="dt on">Shell</span>
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
            <XtermView key={ptyId} ptyId={ptyId} visible={open && key === targetKey} />
          ))}
        </TerminalErrorBoundary>
        {!activeShell && (
          <div className="drawer-note">
            {error ??
              (target
                ? 'Starting a shell...'
                : 'Select a project to open a shell in its folder.')}
          </div>
        )}
      </div>
    </section>
  )
}
