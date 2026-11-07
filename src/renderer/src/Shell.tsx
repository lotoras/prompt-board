import { Calendar, SquareKanban } from 'lucide-react'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../shared/types'
import { useStore } from './store'
import { BOARD_TAB } from './store/chatsSlice'
import { useShortcuts } from './lib/shortcuts'
import { ProjectSidebar } from './features/projects/ProjectSidebar'
import { ProjectEditorModal } from './features/projects/ProjectEditorModal'
import { SyncSettingsModal } from './features/sync/SyncSettingsModal'
import { KanbanBoard } from './features/kanban/KanbanBoard'
import { AktuellesList } from './features/kanban/AktuellesList'
import { CardEditorModal } from './features/kanban/CardEditorModal'
import { ChatTabs, MenuButton } from './features/chat/ChatTabs'
import { ChatView } from './features/chat/ChatView'
import { Toast } from './features/chat/Toast'
import { TerminalDrawer } from './features/terminal/TerminalDrawer'

function GlobalTabs(): React.JSX.Element {
  const mode = useStore((s) => s.globalBoardMode)
  const Icon = mode === 'board' ? SquareKanban : Calendar
  return (
    <nav className="tabs" aria-label="Global">
      <MenuButton />
      <div className="tabs-scroll">
        <div className="tab on" style={{ cursor: 'default' }}>
          <Icon className="i" strokeWidth={1.8} />
          <span className="tab-title">{mode === 'board' ? 'Global board' : 'Aktuelles'}</span>
        </div>
      </div>
    </nav>
  )
}

function ProjectView({ projectKey }: { projectKey: string }): React.JSX.Element {
  const tab = useStore((s) => s.activeTabFor(projectKey))
  const chat = useStore((s) => (tab === BOARD_TAB ? undefined : s.chats.find((c) => c.chatId === tab)))
  if (!chat) return <KanbanBoard projectKey={projectKey} />
  return <ChatView key={chat.chatId} chat={chat} />
}

export function Shell(): React.JSX.Element {
  useShortcuts()
  const view = useStore((s) => s.view)
  const globalBoardMode = useStore((s) => s.globalBoardMode)
  const sideOpen = useStore((s) => s.sideOpen)
  const setSideOpen = useStore((s) => s.setSideOpen)

  return (
    <div className={`app${sideOpen ? ' side-open' : ''}`}>
      <ProjectSidebar />
      <div className="scrim" onClick={() => setSideOpen(false)} />
      <main className="main">
        {view.kind === 'project' ? <ChatTabs projectKey={view.projectKey} /> : <GlobalTabs />}
        <div className="view">
          {view.kind === 'global-board' &&
            (globalBoardMode === 'board' ? (
              <KanbanBoard projectKey={GLOBAL_BOARD_PROJECT_KEY} />
            ) : (
              <AktuellesList />
            ))}
          {view.kind === 'project' && <ProjectView projectKey={view.projectKey} />}
        </div>
        <TerminalDrawer />
      </main>
      <CardEditorModal />
      <ProjectEditorModal />
      <SyncSettingsModal />
      <Toast />
    </div>
  )
}
