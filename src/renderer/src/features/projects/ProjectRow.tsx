import { memo } from 'react'
import { Ellipsis } from 'lucide-react'
import type { ProjectView } from '../../../../shared/types'

export type ProjectDot = 'none' | 'busy' | 'attention' | 'idle'

interface ProjectRowProps {
  project: ProjectView
  active: boolean
  dot: ProjectDot
  chatCount: number
  onSelect: () => void
  onEdit: () => void
}

function ProjectRowImpl({
  project,
  active,
  dot,
  chatCount,
  onSelect,
  onEdit
}: ProjectRowProps): React.JSX.Element {
  return (
    <div
      className={`proj${active ? ' on' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <span className={`dot ${dot}`} title={dot === 'attention' ? 'needs attention' : undefined} />
      <span className="proj-name" title={project.name}>
        {project.name}
      </span>
      <span className="meta num">{chatCount || ''}</span>
      <button
        type="button"
        className="edit"
        title={project.source === 'auto' ? 'Configure project' : 'Edit project'}
        aria-label={project.source === 'auto' ? 'Configure project' : 'Edit project'}
        onClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
      >
        <Ellipsis className="i sm" strokeWidth={1.8} />
      </button>
    </div>
  )
}

export const ProjectRow = memo(ProjectRowImpl)
