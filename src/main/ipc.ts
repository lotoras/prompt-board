import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { KanbanMutation, ProjectInput } from '../shared/types'
import { mutateKanban, getBoards } from './kanban/store'
import { createProject, deleteProject, listProjects, updateProject } from './projects/store'
import { buildSnapshot } from './sessions/snapshot'
import { triggerSnapshotRefresh } from './sessions/watcher'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.sessions.list, async () => {
    return buildSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.projects.list, async () => {
    return listProjects()
  })

  ipcMain.handle(IPC_CHANNELS.projects.create, async (_event, input: ProjectInput) => {
    const project = await createProject(input)
    triggerSnapshotRefresh(getWindow)
    return project
  })

  ipcMain.handle(
    IPC_CHANNELS.projects.update,
    async (_event, projectKey: string, patch: Partial<ProjectInput>) => {
      const project = await updateProject(projectKey, patch)
      triggerSnapshotRefresh(getWindow)
      return project
    }
  )

  ipcMain.handle(IPC_CHANNELS.projects.delete, async (_event, projectKey: string) => {
    await deleteProject(projectKey)
    triggerSnapshotRefresh(getWindow)
  })

  ipcMain.handle(IPC_CHANNELS.projects.pickDirectory, async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.kanban.getBoards, async () => {
    return getBoards()
  })

  ipcMain.handle(IPC_CHANNELS.kanban.mutate, async (_event, mutation: KanbanMutation) => {
    return mutateKanban(mutation)
  })

  ipcMain.handle(IPC_CHANNELS.pty.spawn, async () => {
    throw new Error('pty not available')
  })
  ipcMain.handle(IPC_CHANNELS.pty.write, async () => {
    throw new Error('pty not available')
  })
  ipcMain.handle(IPC_CHANNELS.pty.resize, async () => {
    throw new Error('pty not available')
  })
  ipcMain.handle(IPC_CHANNELS.pty.kill, async () => {
    throw new Error('pty not available')
  })
}
