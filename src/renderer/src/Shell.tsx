import { useStore } from './store'
import { api } from './lib/api'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../shared/types'
import { ProjectSidebar } from './features/projects/ProjectSidebar'
import { ProjectEditorModal } from './features/projects/ProjectEditorModal'
import { SessionBoard } from './features/sessions/SessionBoard'
import { KanbanBoard } from './features/kanban/KanbanBoard'
import type { ProjectTab } from './store/uiSlice'
import './shell.css'

const TABS: { id: ProjectTab; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'board', label: 'Board' },
  { id: 'terminals', label: 'Terminals' }
]

export function Shell(): React.JSX.Element {
  const view = useStore((s) => s.view)
  const setProjectTab = useStore((s) => s.setProjectTab)
  const projectView = useStore((s) =>
    view.kind === 'project' ? s.projectView(view.projectKey) : undefined
  )

  return (
    <div className="shell">
      <ProjectSidebar />
      <main className="shell__main">
        {view.kind === 'global-board' && (
          <>
            <div className="shell__header">Global Board</div>
            <KanbanBoard projectKey={GLOBAL_BOARD_PROJECT_KEY} />
          </>
        )}

        {view.kind === 'project' && (
          <>
            <div className="shell__header">{projectView?.name ?? view.projectKey}</div>
            <div className="shell__tabs">
              {TABS.filter((tab) => tab.id !== 'terminals' || api.caps.pty).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`shell__tab${view.tab === tab.id ? ' shell__tab--active' : ''}`}
                  onClick={() => setProjectTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {view.tab === 'sessions' && <SessionBoard projectKey={view.projectKey} />}
            {view.tab === 'board' && <KanbanBoard projectKey={view.projectKey} />}
            {view.tab === 'terminals' && api.caps.pty && (
              <div className="shell__placeholder">Terminals arrive in Phase 2.</div>
            )}
          </>
        )}
      </main>
      <ProjectEditorModal />
    </div>
  )
}
