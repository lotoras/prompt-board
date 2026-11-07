import { useMemo } from 'react'
import { Calendar, Plus, SquarePen, SquareKanban, Volume2, VolumeX, X } from 'lucide-react'
import { DONE_COLUMN_ID, FOR_LATER_COLUMN_ID, statusTone } from '../../../../shared/types'
import { useStore } from '../../store'
import { formatRelativeTime, todayLocalISO } from '../../lib/format'
import { playCoinBlip } from '../../lib/retroSound'
import { startNewChat } from '../chat/newChat'
import { syncDotColor } from '../sync/syncStatus'
import { ProjectRow } from './ProjectRow'
import type { ProjectDot } from './ProjectRow'

export function ProjectSidebar(): React.JSX.Element {
  const projects = useStore((s) => s.snapshot.projects)
  const chats = useStore((s) => s.chats)
  const cards = useStore((s) => s.boards.cards)
  const view = useStore((s) => s.view)
  const globalBoardMode = useStore((s) => s.globalBoardMode)
  const setView = useStore((s) => s.setView)
  const setGlobalBoardMode = useStore((s) => s.setGlobalBoardMode)
  const setProjectModal = useStore((s) => s.setProjectModal)
  const setSideOpen = useStore((s) => s.setSideOpen)
  const syncStatus = useStore((s) => s.syncStatus)
  const setSyncModalOpen = useStore((s) => s.setSyncModalOpen)
  const soundEnabled = useStore((s) => s.soundEnabled)
  const setSoundEnabled = useStore((s) => s.setSoundEnabled)

  const { openCount, dueCount, overdue } = useMemo(() => {
    const today = todayLocalISO()
    const open = cards.filter((c) => c.columnId !== DONE_COLUMN_ID)
    const due = open.filter((c) => c.dueDate && c.dueDate <= today)
    return {
      openCount: open.filter((c) => c.columnId !== FOR_LATER_COLUMN_ID).length,
      dueCount: due.length,
      overdue: due.some((c) => c.dueDate! < today)
    }
  }, [cards])

  const byProject = useMemo(() => {
    const map = new Map<string, { count: number; dot: ProjectDot }>()
    for (const chat of chats) {
      const entry = map.get(chat.projectKey) ?? { count: 0, dot: 'none' as ProjectDot }
      const tone = statusTone(chat)
      entry.count += 1
      if (tone === 'attention') entry.dot = 'attention'
      else if (tone === 'busy' && entry.dot !== 'attention') entry.dot = 'busy'
      map.set(chat.projectKey, entry)
    }
    return map
  }, [chats])

  const syncLabel =
    syncStatus.state === 'disabled'
      ? 'Sync off'
      : syncStatus.pendingOps > 0
        ? `${syncStatus.pendingOps} pending`
        : syncStatus.state === 'online'
          ? syncStatus.lastSyncAt
            ? `Synced ${formatRelativeTime(syncStatus.lastSyncAt)}`
            : 'Synced'
          : syncStatus.state

  const showGlobal = (mode: 'board' | 'aktuelles'): void => {
    setGlobalBoardMode(mode)
    setView({ kind: 'global-board' })
  }

  return (
    <aside className="sidebar" aria-label="Projects">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">prompt-board</span>
        <button
          type="button"
          className="close-side"
          aria-label="Close sidebar"
          onClick={() => setSideOpen(false)}
        >
          <X className="i" strokeWidth={1.8} />
        </button>
      </div>
      <div className="side-scroll">
        <button
          type="button"
          className="new-chat"
          onClick={() => {
            setSideOpen(false)
            startNewChat()
          }}
        >
          <SquarePen className="i" strokeWidth={1.8} />
          <span>New chat</span>
          <span className="kbd">Ctrl N</span>
        </button>
        <button
          type="button"
          className={`nav-item${view.kind === 'global-board' && globalBoardMode === 'board' ? ' on' : ''}`}
          onClick={() => showGlobal('board')}
        >
          <SquareKanban className="i" strokeWidth={1.8} />
          <span>Global board</span>
          <span className="count num">{openCount}</span>
        </button>
        <button
          type="button"
          className={`nav-item${view.kind === 'global-board' && globalBoardMode === 'aktuelles' ? ' on' : ''}`}
          onClick={() => showGlobal('aktuelles')}
        >
          <Calendar className="i" strokeWidth={1.8} />
          <span>Aktuelles</span>
          <span className={`count num${overdue ? ' hot' : ''}`}>{dueCount}</span>
        </button>
        <div className="side-label">
          <span>Projects</span>
          <button type="button" aria-label="New project" onClick={() => setProjectModal({ mode: 'create' })}>
            <Plus className="i sm" strokeWidth={1.8} />
          </button>
        </div>
        {projects.map((project) => {
          const entry = byProject.get(project.projectKey)
          const dot: ProjectDot =
            entry?.dot === 'attention' || project.needsAttention
              ? 'attention'
              : (entry?.dot ?? 'none')
          return (
            <ProjectRow
              key={project.projectKey}
              project={project}
              active={view.kind === 'project' && view.projectKey === project.projectKey}
              dot={dot}
              chatCount={entry?.count ?? 0}
              onSelect={() => setView({ kind: 'project', projectKey: project.projectKey })}
              onEdit={() =>
                setProjectModal(
                  project.source === 'auto'
                    ? { mode: 'promote', projectKey: project.projectKey, suggestedName: project.name }
                    : { mode: 'edit', projectKey: project.projectKey }
                )
              }
            />
          )
        })}
      </div>
      <div className="side-foot">
        <button
          type="button"
          className="foot-btn"
          aria-pressed={soundEnabled}
          title={soundEnabled ? 'Mute attention chime' : 'Unmute attention chime'}
          onClick={() => {
            const next = !soundEnabled
            setSoundEnabled(next)
            if (next) playCoinBlip()
          }}
        >
          {soundEnabled ? (
            <Volume2 className="i" strokeWidth={1.8} />
          ) : (
            <VolumeX className="i" strokeWidth={1.8} />
          )}
          <span>{soundEnabled ? 'Sound on' : 'Sound off'}</span>
        </button>
        <span className="spacer" />
        <button type="button" className="foot-btn" title="Supabase sync" onClick={() => setSyncModalOpen(true)}>
          <span className={`ok ${syncDotColor(syncStatus)}`} />
          <span>{syncLabel}</span>
        </button>
      </div>
    </aside>
  )
}
