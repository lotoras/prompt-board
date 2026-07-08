import { memo } from 'react'
import type { ProjectView } from '../../../../shared/types'
import './projects.css'

interface ProjectRowProps {
  project: ProjectView
  active: boolean
  onSelect: () => void
  onEdit: () => void
}

function ProjectRowImpl({ project, active, onSelect, onEdit }: ProjectRowProps): React.JSX.Element {
  const liveCount = project.sessions.length

  return (
    <div className={`project-row${active ? ' project-row--active' : ''}`} onClick={onSelect}>
      {project.needsAttention && <span className="project-row__dot" title="needs attention" />}
      <span className="project-row__name" title={project.name}>
        {project.name}
      </span>
      {liveCount > 0 && <span className="project-row__count">{liveCount}</span>}
      <button
        type="button"
        className="project-row__edit"
        title={project.source === 'auto' ? 'Configure project' : 'Edit project'}
        onClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
      >
        ⋯
      </button>
    </div>
  )
}

export const ProjectRow = memo(ProjectRowImpl)
