import { useState } from 'react'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import type { ProjectModalState } from '../../store/uiSlice'
import type { Project } from '../../../../shared/types'
import './projects.css'

interface ProjectEditorFormProps {
  modal: ProjectModalState
  existing: Project | undefined
  onClose: () => void
}

function ProjectEditorForm({
  modal,
  existing,
  onClose
}: ProjectEditorFormProps): React.JSX.Element {
  const createProject = useStore((s) => s.createProject)
  const updateProject = useStore((s) => s.updateProject)
  const deleteProject = useStore((s) => s.deleteProject)

  const [name, setName] = useState(
    modal.mode === 'edit'
      ? (existing?.name ?? '')
      : modal.mode === 'promote'
        ? modal.suggestedName
        : ''
  )
  const [basePath, setBasePath] = useState(
    modal.mode === 'edit'
      ? (existing?.basePath ?? '')
      : modal.mode === 'promote'
        ? modal.projectKey
        : ''
  )

  const handleBrowse = async (): Promise<void> => {
    const picked = await api.projects.pickDirectory()
    if (picked) setBasePath(picked)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim() || !basePath.trim()) return

    if (modal.mode === 'edit') {
      await updateProject(modal.projectKey, { name, basePath })
    } else {
      await createProject({ name, basePath })
    }
    onClose()
  }

  const handleDelete = async (): Promise<void> => {
    if (modal.mode !== 'edit') return
    await deleteProject(modal.projectKey)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>
          {modal.mode === 'create' && 'New project'}
          {modal.mode === 'edit' && 'Edit project'}
          {modal.mode === 'promote' && 'Configure project'}
        </h2>

        <label className="modal__field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>

        <label className="modal__field">
          Base path
          <div className="modal__path-row">
            <input value={basePath} onChange={(e) => setBasePath(e.target.value)} />
            <button type="button" onClick={handleBrowse}>
              Browse…
            </button>
          </div>
        </label>

        <div className="modal__actions">
          {modal.mode === 'edit' && (
            <button type="button" className="modal__delete" onClick={handleDelete}>
              Delete
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  )
}

export function ProjectEditorModal(): React.JSX.Element | null {
  const modal = useStore((s) => s.projectModal)
  const setProjectModal = useStore((s) => s.setProjectModal)
  const projects = useStore((s) => s.projects)

  if (!modal) return null

  const existing =
    modal.mode === 'edit' ? projects.find((p) => p.projectKey === modal.projectKey) : undefined
  const key = modal.mode === 'create' ? 'create' : modal.projectKey

  return (
    <ProjectEditorForm
      key={key}
      modal={modal}
      existing={existing}
      onClose={() => setProjectModal(null)}
    />
  )
}
