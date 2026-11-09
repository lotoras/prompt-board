import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type {
  ChatCreateInput,
  ChatPatch,
  ChatRestartMode,
  ChatRewindInput,
  ChatSendInput,
  KanbanMutation,
  PermissionDecision,
  PlanDecision,
  PersistedTerminalsState,
  ProjectInput,
  PtySpawnInput,
  SyncConfigureInput
} from '../shared/types'
import { listAccounts } from './accounts'
import { describe, pick, saveImage } from './chat/attachments'
import { chatService } from './chat/service'
import { gitInfo, listBranches } from './git/git'
import { mutateKanban, getBoards } from './kanban/store'
import { createProject, deleteProject, listProjects, updateProject } from './projects/store'
import { attachPty, killPty, resizePty, spawnPty, writePty } from './pty/manager'
import { loadPersisted, savePersisted } from './pty/persistence'
import { listPtyBindings } from './pty/reconcile'
import { restoreLog } from './lib/restoreLog'
import { acknowledgeSession, unacknowledgeSession } from './sessions/acks'
import { buildCurrentSnapshot, refreshSnapshotNow, triggerSnapshotRefresh } from './sessions/watcher'
import { configure, getConfigView, getSyncStatus, signOut } from './sync/engine'
import { computeBottomInset } from './window/inset'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.sessions.list, async () => {
    try {
      return await buildCurrentSnapshot()
    } catch (err) {
      console.error('sessions:list failed', err)
      return { projects: [] }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.sessions.acknowledge,
    async (_event, sessionId: string, statusUpdatedAt: number) => {
      try {
        await acknowledgeSession(sessionId, statusUpdatedAt)
      } finally {
        void refreshSnapshotNow(getWindow)
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.sessions.unacknowledge, async (_event, sessionId: string) => {
    try {
      await unacknowledgeSession(sessionId)
    } finally {
      void refreshSnapshotNow(getWindow)
    }
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

  ipcMain.handle(IPC_CHANNELS.pty.spawn, async (_event, input: PtySpawnInput) => {
    try {
      return await spawnPty(getWindow, input)
    } catch (err) {
      restoreLog('spawn:error', {
        projectKey: input.projectKey,
        account: input.account,
        resumeSessionId: input.resumeSessionId,
        error: String(err)
      })
      throw err
    }
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
  ipcMain.handle(IPC_CHANNELS.pty.bindings, () => {
    const list = listPtyBindings()
    restoreLog('bindings:requested', { count: list.length })
    return list
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

  ipcMain.handle(IPC_CHANNELS.chat.list, () => chatService.list())
  ipcMain.handle(IPC_CHANNELS.chat.create, (_event, input: ChatCreateInput) =>
    chatService.create(input)
  )
  ipcMain.handle(IPC_CHANNELS.chat.update, (_event, chatId: string, patch: ChatPatch) =>
    chatService.update(chatId, patch)
  )
  ipcMain.handle(IPC_CHANNELS.chat.send, (_event, input: ChatSendInput) => chatService.send(input))
  ipcMain.handle(IPC_CHANNELS.chat.interrupt, (_event, chatId: string) =>
    chatService.interrupt(chatId)
  )
  ipcMain.handle(
    IPC_CHANNELS.chat.answer,
    (_event, chatId: string, toolUseId: string, answers: Record<string, string> | null) =>
      chatService.answer(chatId, toolUseId, answers)
  )
  ipcMain.handle(
    IPC_CHANNELS.chat.decidePlan,
    (_event, chatId: string, toolUseId: string, decision: PlanDecision) =>
      chatService.decidePlan(chatId, toolUseId, decision)
  )
  ipcMain.handle(
    IPC_CHANNELS.chat.decidePermission,
    (_event, chatId: string, toolUseId: string, decision: PermissionDecision) =>
      chatService.decidePermission(chatId, toolUseId, decision)
  )
  ipcMain.handle(IPC_CHANNELS.chat.rewind, (_event, input: ChatRewindInput) =>
    chatService.rewind(input)
  )
  ipcMain.handle(IPC_CHANNELS.chat.restart, (_event, chatId: string, mode: ChatRestartMode) =>
    chatService.restart(chatId, mode)
  )
  ipcMain.handle(
    IPC_CHANNELS.chat.listSessions,
    (_event, projectKey: string, opts?: { offset?: number }) =>
      chatService.listSessions(projectKey, opts)
  )
  ipcMain.handle(IPC_CHANNELS.chat.takeOver, (_event, chatId: string) =>
    chatService.takeOver(chatId)
  )
  ipcMain.handle(IPC_CHANNELS.chat.listCommands, (_event, chatId: string) =>
    chatService.listCommands(chatId)
  )
  ipcMain.handle(IPC_CHANNELS.rate.get, () => chatService.getRateLimits())
  ipcMain.handle(IPC_CHANNELS.accounts.list, () => listAccounts())
  ipcMain.handle(IPC_CHANNELS.chat.close, (_event, chatId: string) => chatService.close(chatId))
  ipcMain.handle(IPC_CHANNELS.chat.history, (_event, chatId: string) => chatService.history(chatId))
  ipcMain.handle(IPC_CHANNELS.chat.setActive, (_event, projectKey: string, tab: string) =>
    chatService.setActive(projectKey, tab)
  )
  ipcMain.handle(IPC_CHANNELS.chat.openInTui, (_event, chatId: string) =>
    chatService.openInTui(chatId)
  )

  ipcMain.handle(IPC_CHANNELS.git.info, (_event, cwd: string) => gitInfo(cwd))
  ipcMain.handle(IPC_CHANNELS.git.branches, async (_event, projectKey: string) => {
    const project = (await listProjects()).find((p) => p.projectKey === projectKey)
    return project?.basePath ? listBranches(project.basePath) : []
  })

  ipcMain.handle(IPC_CHANNELS.attachments.pick, () => pick(getWindow))
  ipcMain.handle(IPC_CHANNELS.attachments.describe, (_event, paths: string[]) => describe(paths))
  ipcMain.handle(
    IPC_CHANNELS.attachments.saveImage,
    (_event, dataUrl: string, name?: string) => saveImage(dataUrl, name)
  )
}
