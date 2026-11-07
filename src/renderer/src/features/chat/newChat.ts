import { useStore } from '../../store'

/** Opens a new draft chat for the project in view (or the first project from the global view). */
export function startNewChat(): void {
  const s = useStore.getState()
  const projectKey =
    s.view.kind === 'project' ? s.view.projectKey : (s.projects[0]?.projectKey ?? s.snapshot.projects[0]?.projectKey)
  if (!projectKey) return
  void s.createChat({ projectKey }).catch((e) => console.error(e))
}
