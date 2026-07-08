import { useStore } from '../../store'
import { ProjectRow } from './ProjectRow'
import { syncDotColor } from '../sync/syncStatus'
import '../sync/sync.css'
import './projects.css'

export function ProjectSidebar(): React.JSX.Element {
  const projects = useStore((s) => s.projectViews())
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const setProjectModal = useStore((s) => s.setProjectModal)
  const syncStatus = useStore((s) => s.syncStatus)
  const setSyncModalOpen = useStore((s) => s.setSyncModalOpen)

  const isGlobalActive = view.kind === 'global-board'

  return (
    <aside className="project-sidebar">
      <div
        className={`project-sidebar__global${isGlobalActive ? ' project-sidebar__global--active' : ''}`}
        onClick={() => setView({ kind: 'global-board' })}
      >
        Global Board
      </div>

      <div className="project-sidebar__list">
        {projects.map((project) => (
          <ProjectRow
            key={project.projectKey}
            project={project}
            active={view.kind === 'project' && view.projectKey === project.projectKey}
            onSelect={() =>
              setView({ kind: 'project', projectKey: project.projectKey, tab: 'sessions' })
            }
            onEdit={() =>
              setProjectModal(
                project.source === 'auto'
                  ? { mode: 'promote', projectKey: project.projectKey, suggestedName: project.name }
                  : { mode: 'edit', projectKey: project.projectKey }
              )
            }
          />
        ))}
      </div>

      <button
        type="button"
        className="project-sidebar__add"
        onClick={() => setProjectModal({ mode: 'create' })}
      >
        + New project
      </button>

      <div className="project-sidebar__footer" onClick={() => setSyncModalOpen(true)}>
        <span className={`sync-dot sync-dot--${syncDotColor(syncStatus)}`} />
        <span>Sync</span>
      </div>
    </aside>
  )
}
