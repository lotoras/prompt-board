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
import { ChangesPanel } from './features/chat/ChangesPanel'
import { ChatView } from './features/chat/ChatView'
import { Toast } from './features/chat/Toast'
import { TerminalDrawer } from './features/terminal/TerminalDrawer'
import { TuiStage } from './features/terminal/TuiStage'

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

function ProjectView({ projectKey }: { projectKey: string }): React.JSX.Element | null {
  const tab = useStore((s) => s.activeTabFor(projectKey))
  const chat = useStore((s) => (tab === BOARD_TAB ? undefined : s.chats.find((c) => c.chatId === tab)))
  if (!chat) return <KanbanBoard projectKey={projectKey} />
  // TuiStage fills the view while the chat runs in the terminal.
  if (chat.mode === 'tui') return null
  return (
    <div className="chat-split">
      <div className="chat-col">
        <ChatView key={chat.chatId} chat={chat} />
      </div>
      <ChangesPanel key={chat.chatId} chat={chat} />
    </div>
  )
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
          <TuiStage />
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
