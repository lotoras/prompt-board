import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type {
  KanbanMutation,
  PersistedTerminalsState,
  ProjectInput,
  PtySpawnInput,
  SyncConfigureInput
} from '../shared/types'
import { mutateKanban, getBoards } from './kanban/store'
import { createProject, deleteProject, listProjects, updateProject } from './projects/store'
import { attachPty, killPty, resizePty, spawnPty, writePty } from './pty/manager'
import { loadPersisted, savePersisted } from './pty/persistence'
import { acknowledgeSession } from './sessions/acks'
import { buildSnapshot } from './sessions/snapshot'
import { triggerSnapshotRefresh } from './sessions/watcher'
import { configure, getConfigView, getSyncStatus, signOut } from './sync/engine'
import { computeBottomInset } from './window/inset'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.sessions.list, async () => {
    try {
      return await buildSnapshot()
    } catch (err) {
      console.error('sessions:list failed', err)
      return { projects: [] }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.sessions.acknowledge,
    async (_event, sessionId: string, statusUpdatedAt: number) => {
      await acknowledgeSession(sessionId, statusUpdatedAt)
      triggerSnapshotRefresh(getWindow)
    }
  )

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

  ipcMain.handle(IPC_CHANNELS.pty.spawn, async (_event, input: PtySpawnInput) => {
    return spawnPty(getWindow, input)
  })
  ipcMain.handle(IPC_CHANNELS.pty.write, async (_event, ptyId: string, data: string) => {
    writePty(ptyId, data)
  })
  ipcMain.handle(
    IPC_CHANNELS.pty.resize,
    async (_event, ptyId: string, cols: number, rows: number) => {
      resizePty(ptyId, cols, rows)
    }
  )
  ipcMain.handle(IPC_CHANNELS.pty.kill, async (_event, ptyId: string) => {
    killPty(ptyId)
  })
  ipcMain.handle(IPC_CHANNELS.pty.attach, async (_event, ptyId: string) => {
    attachPty(getWindow, ptyId)
  })
  ipcMain.handle(IPC_CHANNELS.pty.loadPersisted, async () => {
    return loadPersisted()
  })
  ipcMain.handle(
    IPC_CHANNELS.pty.savePersisted,
    async (_event, state: PersistedTerminalsState) => {
      await savePersisted(state)
    }
  )

  ipcMain.handle(IPC_CHANNELS.clipboard.writeText, async (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle(IPC_CHANNELS.clipboard.readText, async () => clipboard.readText())

  ipcMain.handle(IPC_CHANNELS.sync.getStatus, async () => {
    return getSyncStatus()
  })
  ipcMain.handle(IPC_CHANNELS.sync.configure, async (_event, input: SyncConfigureInput) => {
    return configure(input, getWindow)
  })
  ipcMain.handle(IPC_CHANNELS.sync.signOut, async () => {
    await signOut()
  })
  ipcMain.handle(IPC_CHANNELS.sync.getConfig, async () => {
    return getConfigView()
  })

  ipcMain.handle(IPC_CHANNELS.window.getInset, () => {
    const w = getWindow()
    return w ? computeBottomInset(w) : 0
  })
}
